import { Injectable, computed, inject, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteField,
  writeBatch,
  DocumentData,
} from 'firebase/firestore';
import { AuthService } from './auth.service';
import { putDeviceKey, getDeviceKey, deleteDeviceKey } from '../utils/device-key-store';

export interface EncryptedDocument {
  __encrypted: true;
  encryptedPayload: string;
  iv: string;
  encryptionVersion: number;
  createdAt?: number;
  updatedAt?: number;
  date?: string;
  nextDueDate?: string;
}

interface EncryptionMeta {
  salt: string;
  verifier: string;
  verifierIv: string;
  version: number;
  createdAt: number;
  // PBKDF2 iteration count used to derive the master key from the passphrase.
  // Absent on vaults created before this field existed — those fall back to
  // LEGACY_KDF_ITERATIONS so they keep unlocking with the exact key they always
  // have. New vaults get CURRENT_KDF_ITERATIONS. The two coexisting is safe
  // because the derived key IS the encryption key (no separate wrapped master
  // key) — changing iterations for an existing vault would change its key and
  // require re-encrypting everything, which belongs to the planned passphrase
  // rotation feature, not a silent bump here.
  kdfIterations?: number;
}

// Per-user RSA keypair for zero-knowledge envelope encryption. The public key is
// stored in plaintext so the server can encrypt *to* it during background sync;
// the private key is wrapped under the master (symmetric) key so only an unlocked
// client can use it. Stored at `users/{uid}/meta/keys`.
interface KeyMeta {
  publicKey: string; // base64 SPKI DER
  wrappedPrivateKey: string; // base64 — PKCS8 private key encrypted under the master key
  wrappedPrivateKeyIv: string; // base64
  version: number;
  createdAt: number;
  recovery?: RecoveryRecord; // master key wrapped under a recovery-code-derived key
}

// A recovery code wraps the master key so a forgotten passphrase isn't data loss.
interface RecoveryRecord {
  wrappedMasterKey: string; // base64
  iv: string; // base64
  salt: string; // base64 — PBKDF2 salt for deriving the KEK from the code
  createdAt: number;
  iterations?: number; // absent on older records — falls back to RECOVERY_ITERATIONS
}

const RECOVERY_ITERATIONS = 200_000;

// PBKDF2-HMAC-SHA256 iteration counts. 600k matches OWASP's 2023 baseline for
// browser contexts (WebCrypto has no native Argon2id/scrypt/bcrypt, so PBKDF2
// is the right primitive; 600k is the recommended floor). 250k is what every
// vault created before this change already uses — kept only as the fallback
// for those, never used for anything new.
const CURRENT_KDF_ITERATIONS = 600_000;
const LEGACY_KDF_ITERATIONS = 250_000;

const ENCRYPTION_VERSION = 1;
const VERIFIER_TEXT = 'trackr-encryption-verifier-v1';
const COLLECTIONS = ['accounts', 'categories', 'transactions', 'transactionTemplates', 'bills', 'budgets'];

@Injectable({ providedIn: 'root' })
export class EncryptionService {
  private db = inject(Firestore);
  private auth = inject(AuthService);

  unlocked = signal(false);
  busy = signal(false);
  booting = signal(true); // initial profile check + device auto-unlock in progress
  error = signal<string | null>(null);
  hasProfile = signal<boolean | null>(null);
  deviceRemembered = signal(false); // this device holds the key locally (auto-unlock)
  hasRecoveryCode = signal(false);  // a recovery code is set for this account
  userReady = computed(() => !!this.auth.user() && this.unlocked());

  private key: CryptoKey | null = null;
  private salt: Uint8Array | null = null;
  // Raw master-key bytes, held while unlocked via passphrase so a recovery code can
  // wrap them. Null when unlocked from a stored device key (which is non-extractable).
  private masterKeyRaw: Uint8Array | null = null;
  // RSA private key (decrypt-only) for reading server-written envelope docs.
  private privateKey: CryptoKey | null = null;

  async refreshProfileState() {
    const user = this.auth.user();
    this.hasProfile.set(null);
    this.error.set(null);
    if (!user) {
      this.lock();
      return;
    }
    try {
      const snap = await getDoc(doc(this.db, `users/${user.uid}/meta/encryption`));
      this.hasProfile.set(snap.exists());
      this.deviceRemembered.set(!!(await getDeviceKey(user.uid)));
      const keysSnap = await getDoc(doc(this.db, `users/${user.uid}/meta/keys`));
      this.hasRecoveryCode.set(!!(keysSnap.data() as KeyMeta | undefined)?.recovery);
    } catch (err: any) {
      const message = this.friendlyEncryptionError(err);
      this.error.set(message);
      this.hasProfile.set(null);
      throw new Error(message);
    }
  }

  async unlock(passphrase: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    if (!passphrase || passphrase.length < 8) {
      throw new Error('Use at least 8 characters for your encryption passphrase.');
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const metaRef = doc(this.db, `users/${user.uid}/meta/encryption`);
      const metaSnap = await getDoc(metaRef);

      if (!metaSnap.exists()) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const { key, raw } = await this.deriveMasterKey(passphrase, salt, CURRENT_KDF_ITERATIONS);
        const verifier = await this.encryptStringWithKey(VERIFIER_TEXT, key);
        const meta: EncryptionMeta = {
          salt: this.bytesToBase64(salt),
          verifier: verifier.ciphertext,
          verifierIv: verifier.iv,
          version: ENCRYPTION_VERSION,
          createdAt: Date.now(),
          kdfIterations: CURRENT_KDF_ITERATIONS,
        };
        await setDoc(metaRef, meta);
        this.salt = salt;
        this.key = key;
        this.masterKeyRaw = raw;
        this.hasProfile.set(true);
        await this.ensureKeypair();
        this.unlocked.set(true);
        return;
      }

      const meta = metaSnap.data() as EncryptionMeta;
      const salt = this.base64ToBytes(meta.salt);
      const { key, raw } = await this.deriveMasterKey(passphrase, salt, meta.kdfIterations ?? LEGACY_KDF_ITERATIONS);
      const verifier = await this.decryptStringWithKey(meta.verifier, meta.verifierIv, key);
      if (verifier !== VERIFIER_TEXT) {
        throw new Error('Encryption passphrase is incorrect.');
      }
      this.salt = salt;
      this.key = key;
      this.masterKeyRaw = raw;
      this.hasProfile.set(true);
      await this.ensureKeypair();
      this.unlocked.set(true);
    } catch (err: any) {
      this.lock();
      const message = this.friendlyEncryptionError(err);
      this.error.set(message);
      throw new Error(message);
    } finally {
      this.busy.set(false);
    }
  }

  lock() {
    this.key = null;
    this.salt = null;
    this.masterKeyRaw = null;
    this.privateKey = null;
    this.unlocked.set(false);
    this.error.set(null);
    // deviceRemembered reflects stored state, not session state — leave it.
  }

  /**
   * Create (or replace) a recovery code: generate a high-entropy code, wrap the master
   * key under a key derived from it, and store the wrapped key. Returns the code to show
   * ONCE — it isn't stored, so it can't be shown again. Requires a passphrase-unlocked
   * session (needs the raw master key).
   */
  async createRecoveryCode(): Promise<string> {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    if (!this.masterKeyRaw) {
      throw new Error('Unlock with your passphrase (not a remembered device) to create a recovery code.');
    }
    const code = this.generateRecoveryCode();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await this.deriveKekFromCode(code, salt, RECOVERY_ITERATIONS);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, this.masterKeyRaw as BufferSource);
    const record: RecoveryRecord = {
      wrappedMasterKey: this.bytesToBase64(new Uint8Array(wrapped)),
      iv: this.bytesToBase64(iv),
      salt: this.bytesToBase64(salt),
      createdAt: Date.now(),
      iterations: RECOVERY_ITERATIONS,
    };
    await setDoc(doc(this.db, `users/${user.uid}/meta/keys`), { recovery: record }, { merge: true });
    this.hasRecoveryCode.set(true);
    return code;
  }

  /** Remove the recovery code. Passphrase unlock is unaffected. */
  async removeRecoveryCode() {
    const user = this.auth.user();
    if (!user) return;
    await updateDoc(doc(this.db, `users/${user.uid}/meta/keys`), { recovery: deleteField() });
    this.hasRecoveryCode.set(false);
  }

  /** Unlock with the recovery code (for a forgotten passphrase). */
  async unlockWithRecoveryCode(code: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    this.busy.set(true);
    this.error.set(null);
    try {
      const keysSnap = await getDoc(doc(this.db, `users/${user.uid}/meta/keys`));
      const record = (keysSnap.data() as KeyMeta | undefined)?.recovery;
      if (!record) throw new Error('No recovery code is set for this account.');
      const kek = await this.deriveKekFromCode(
        this.normalizeCode(code),
        this.base64ToBytes(record.salt),
        record.iterations ?? RECOVERY_ITERATIONS,
      );
      let raw: ArrayBuffer;
      try {
        raw = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: this.base64ToBytes(record.iv) as BufferSource },
          kek,
          this.base64ToBytes(record.wrappedMasterKey) as BufferSource,
        );
      } catch {
        throw new Error('That recovery code is not correct.');
      }
      await this.unlockWithMasterKey(new Uint8Array(raw));
    } catch (err: any) {
      this.lock();
      const message = err?.message || 'Recovery failed.';
      this.error.set(message);
      throw new Error(message);
    } finally {
      this.busy.set(false);
    }
  }

  /** Open the vault from raw master-key bytes, verifying against the stored verifier. */
  private async unlockWithMasterKey(raw: Uint8Array) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const metaSnap = await getDoc(doc(this.db, `users/${user.uid}/meta/encryption`));
    if (!metaSnap.exists()) throw new Error('No encrypted vault found.');
    const meta = metaSnap.data() as EncryptionMeta;
    const key = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const verifier = await this.decryptStringWithKey(meta.verifier, meta.verifierIv, key);
    if (verifier !== VERIFIER_TEXT) throw new Error('Recovered key does not match this vault.');
    this.salt = this.base64ToBytes(meta.salt);
    this.key = key;
    this.masterKeyRaw = raw;
    this.hasProfile.set(true);
    await this.ensureKeypair();
    this.unlocked.set(true);
  }

  /**
   * "Remember this device": store the master key locally (non-extractable) so this
   * device can auto-unlock without the passphrase. Only call while unlocked.
   */
  async rememberDevice() {
    const user = this.auth.user();
    if (!user || !this.key) throw new Error('Unlock first to remember this device.');
    await putDeviceKey(user.uid, this.key);
    this.deviceRemembered.set(true);
  }

  /** Forget this device — clears the locally stored key. Passphrase unlock still works. */
  async forgetDevice() {
    const user = this.auth.user();
    if (!user) return;
    await deleteDeviceKey(user.uid);
    this.deviceRemembered.set(false);
  }

  /**
   * Auto-unlock from a locally remembered key, if present. Returns whether it unlocked.
   * A stale/invalid stored key (e.g. after a passphrase change) is cleared and we fall
   * back to the passphrase.
   */
  async tryUnlockFromDevice(): Promise<boolean> {
    const user = this.auth.user();
    if (!user || this.unlocked()) return false;
    try {
      const key = await getDeviceKey(user.uid);
      if (!key) return false;
      await this.unlockWithKey(key);
      return true;
    } catch (err) {
      console.warn('Device auto-unlock failed; clearing remembered key.', err);
      await this.forgetDevice();
      return false;
    }
  }

  /** Open the vault from a stored CryptoKey, verifying it against the stored verifier. */
  private async unlockWithKey(key: CryptoKey) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const metaSnap = await getDoc(doc(this.db, `users/${user.uid}/meta/encryption`));
    if (!metaSnap.exists()) throw new Error('No encrypted vault found.');
    const meta = metaSnap.data() as EncryptionMeta;
    const verifier = await this.decryptStringWithKey(meta.verifier, meta.verifierIv, key);
    if (verifier !== VERIFIER_TEXT) throw new Error('Stored device key no longer matches this vault.');
    this.salt = this.base64ToBytes(meta.salt);
    this.key = key;
    this.hasProfile.set(true);
    await this.ensureKeypair();
    this.unlocked.set(true);
  }

  async encryptForWrite<T extends Record<string, any>>(data: T): Promise<EncryptedDocument> {
    if (!this.key) throw new Error('Encrypted data is locked.');
    const payload = await this.encryptStringWithKey(JSON.stringify(data), this.key);
    return {
      __encrypted: true,
      encryptedPayload: payload.ciphertext,
      iv: payload.iv,
      encryptionVersion: ENCRYPTION_VERSION,
      ...this.sortableMetadata(data),
    };
  }

  async decryptDoc<T>(data: DocumentData): Promise<T> {
    // Server-written envelope docs (background Plaid sync): unwrap the per-record
    // AES key with our RSA private key, then AES-GCM decrypt the payload.
    if (data?.['__envelope']) {
      if (!this.privateKey) throw new Error('Encrypted data is locked.');
      const dekBytes = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'RSA-OAEP' },
          this.privateKey,
          this.base64ToBytes(data['encryptedDEK']) as BufferSource,
        ),
      );
      const dek = await crypto.subtle.importKey('raw', dekBytes as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']);
      // WebCrypto AES-GCM expects ciphertext || tag concatenated.
      const ciphertext = this.base64ToBytes(data['encryptedPayload']);
      const tag = this.base64ToBytes(data['tag']);
      const combined = new Uint8Array(ciphertext.length + tag.length);
      combined.set(ciphertext);
      combined.set(tag, ciphertext.length);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: this.base64ToBytes(data['iv']) as BufferSource },
        dek,
        combined as BufferSource,
      );
      return JSON.parse(new TextDecoder().decode(decrypted)) as T;
    }

    if (!data?.['__encrypted']) return data as T;
    if (!this.key) throw new Error('Encrypted data is locked.');
    const json = await this.decryptStringWithKey(data['encryptedPayload'], data['iv'], this.key);
    return JSON.parse(json) as T;
  }

  /**
   * Ensure the user has an RSA keypair for envelope encryption. First unlock
   * (new or existing user) generates one and stores the public key in plaintext
   * plus the private key wrapped under the master key; later unlocks unwrap the
   * stored private key. Never blocks unlock of existing symmetric data — a
   * keypair hiccup is logged, not fatal.
   */
  private async ensureKeypair() {
    const user = this.auth.user();
    if (!user || !this.key) return;
    try {
      const keysRef = doc(this.db, `users/${user.uid}/meta/keys`);
      const snap = await getDoc(keysRef);

      if (snap.exists()) {
        const meta = snap.data() as KeyMeta;
        const pkcs8Base64 = await this.decryptStringWithKey(meta.wrappedPrivateKey, meta.wrappedPrivateKeyIv, this.key);
        this.privateKey = await crypto.subtle.importKey(
          'pkcs8',
          this.base64ToBytes(pkcs8Base64) as BufferSource,
          { name: 'RSA-OAEP', hash: 'SHA-256' },
          false,
          ['decrypt'],
        );
        return;
      }

      const pair = await crypto.subtle.generateKey(
        { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['encrypt', 'decrypt'],
      );
      const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
      const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
      const wrapped = await this.encryptStringWithKey(this.bytesToBase64(pkcs8), this.key);

      const meta: KeyMeta = {
        publicKey: this.bytesToBase64(spki),
        wrappedPrivateKey: wrapped.ciphertext,
        wrappedPrivateKeyIv: wrapped.iv,
        version: ENCRYPTION_VERSION,
        createdAt: Date.now(),
      };
      await setDoc(keysRef, meta);
      // Keep a decrypt-only handle for this session.
      this.privateKey = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8 as BufferSource,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt'],
      );
    } catch (err) {
      // Non-fatal: existing symmetric data still unlocks; only envelope docs need this.
      console.error('Envelope keypair setup failed:', err);
    }
  }

  async migrateUserData() {
    const user = this.auth.user();
    if (!user || !this.key) return;

    for (const collectionName of COLLECTIONS) {
      const snap = await getDocs(collection(this.db, `users/${user.uid}/${collectionName}`));
      let batch = writeBatch(this.db);
      let count = 0;

      for (const item of snap.docs) {
        const data = item.data();
        // Already encrypted (symmetric) OR a server-written envelope doc — leave it.
        if (data['__encrypted'] || data['__envelope']) continue;
        const encrypted = await this.encryptForWrite(data);
        batch.set(item.ref, encrypted);
        count++;

        if (count === 400) {
          await batch.commit();
          batch = writeBatch(this.db);
          count = 0;
        }
      }

      if (count > 0) await batch.commit();
    }
  }

  /**
   * One-time repair for transactions that an earlier `migrateUserData` double-wrapped:
   * an envelope (`__envelope`) doc that got symmetrically re-encrypted so it now
   * decrypts to the envelope wrapper instead of the transaction. We unwrap the outer
   * symmetric layer and restore the inner envelope doc (no data loss). Gated by a
   * sentinel so it runs once. Manual (`__encrypted`) transactions decrypt to a normal
   * transaction (no `__envelope` marker) and are left untouched.
   */
  async repairEnvelopeDocs() {
    const user = this.auth.user();
    if (!user || !this.key) return;

    const sentinelRef = doc(this.db, `users/${user.uid}/meta/envelopeRepair`);
    if ((await getDoc(sentinelRef)).exists()) return;

    const snap = await getDocs(collection(this.db, `users/${user.uid}/transactions`));
    let batch = writeBatch(this.db);
    let pending = 0;
    let repaired = 0;

    for (const item of snap.docs) {
      const data = item.data();
      if (!data['__encrypted']) continue; // envelope/plaintext docs weren't double-wrapped
      let inner: any;
      try {
        inner = JSON.parse(await this.decryptStringWithKey(data['encryptedPayload'], data['iv'], this.key));
      } catch {
        continue; // can't decrypt with this key — not ours to touch
      }
      if (inner && inner['__envelope'] === true) {
        batch.set(item.ref, inner); // restore the proper envelope doc
        pending++;
        repaired++;
        if (pending === 400) {
          await batch.commit();
          batch = writeBatch(this.db);
          pending = 0;
        }
      }
    }

    if (pending > 0) await batch.commit();
    await setDoc(sentinelRef, { repairedAt: Date.now(), count: repaired });
  }

  private sortableMetadata(data: Record<string, any>) {
    const metadata: Partial<EncryptedDocument> = {};
    if (typeof data['createdAt'] === 'number') metadata.createdAt = data['createdAt'];
    if (typeof data['updatedAt'] === 'number') metadata.updatedAt = data['updatedAt'];
    if (typeof data['date'] === 'string') metadata.date = data['date'];
    if (typeof data['nextDueDate'] === 'string') metadata.nextDueDate = data['nextDueDate'];
    return metadata;
  }

  // Derive the master key from the passphrase, returning both the AES-GCM CryptoKey
  // and the raw bytes (kept so a recovery code can wrap them). The iteration count
  // is per-vault (see EncryptionMeta.kdfIterations) — callers must pass the value
  // that matches how this vault's verifier/data were actually encrypted.
  private async deriveMasterKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<{ key: CryptoKey; raw: Uint8Array }> {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
      material,
      256
    );
    const raw = new Uint8Array(bits);
    const key = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return { key, raw };
  }

  // --- Recovery code helpers ---

  /** A 24-char code from 15 random bytes, grouped for readability (Crockford-ish base32). */
  private generateRecoveryCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(15));
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (32 chars, no I/L/O/U)
    let bitBuffer = 0, bits = 0, out = '';
    for (const b of bytes) {
      bitBuffer = (bitBuffer << 8) | b;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        out += alphabet[(bitBuffer >> bits) & 31];
      }
    }
    return (out.match(/.{1,4}/g) || [out]).join('-'); // XXXX-XXXX-...
  }

  /** Strip formatting/case so a re-typed code matches. */
  private normalizeCode(code: string): string {
    return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
  }

  /** PBKDF2 a recovery code into an AES-GCM key-encryption-key. */
  private async deriveKekFromCode(code: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.normalizeCode(code)),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private async encryptStringWithKey(plain: string, key: CryptoKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plain)
    );
    return {
      ciphertext: this.bytesToBase64(new Uint8Array(encrypted)),
      iv: this.bytesToBase64(iv),
    };
  }

  private async decryptStringWithKey(ciphertext: string, iv: string, key: CryptoKey) {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.base64ToBytes(iv) as BufferSource },
      key,
      this.base64ToBytes(ciphertext) as BufferSource
    );
    return new TextDecoder().decode(decrypted);
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary);
  }

  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  private friendlyEncryptionError(err: any): string {
    const code = err?.code || '';
    const message = err?.message || '';

    if (code === 'permission-denied' || message.includes('Missing or insufficient permissions')) {
      return 'Firestore rules are blocking encrypted data setup. Deploy firestore.rules, then sign in again.';
    }

    if (err?.name === 'OperationError' || message.includes('operation failed')) {
      return 'Encryption passphrase is incorrect.';
    }

    return message || 'Could not unlock encrypted data.';
  }
}

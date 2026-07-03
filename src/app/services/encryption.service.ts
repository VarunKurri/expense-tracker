import { Injectable, computed, inject, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  DocumentData,
} from 'firebase/firestore';
import { AuthService } from './auth.service';

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
}

const ENCRYPTION_VERSION = 1;
const VERIFIER_TEXT = 'trackr-encryption-verifier-v1';
const COLLECTIONS = ['accounts', 'categories', 'transactions', 'transactionTemplates', 'bills', 'budgets'];

@Injectable({ providedIn: 'root' })
export class EncryptionService {
  private db = inject(Firestore);
  private auth = inject(AuthService);

  unlocked = signal(false);
  busy = signal(false);
  error = signal<string | null>(null);
  hasProfile = signal<boolean | null>(null);
  userReady = computed(() => !!this.auth.user() && this.unlocked());

  private key: CryptoKey | null = null;
  private salt: Uint8Array | null = null;
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
        const key = await this.deriveKey(passphrase, salt);
        const verifier = await this.encryptStringWithKey(VERIFIER_TEXT, key);
        const meta: EncryptionMeta = {
          salt: this.bytesToBase64(salt),
          verifier: verifier.ciphertext,
          verifierIv: verifier.iv,
          version: ENCRYPTION_VERSION,
          createdAt: Date.now(),
        };
        await setDoc(metaRef, meta);
        this.salt = salt;
        this.key = key;
        this.hasProfile.set(true);
        await this.ensureKeypair();
        this.unlocked.set(true);
        return;
      }

      const meta = metaSnap.data() as EncryptionMeta;
      const salt = this.base64ToBytes(meta.salt);
      const key = await this.deriveKey(passphrase, salt);
      const verifier = await this.decryptStringWithKey(meta.verifier, meta.verifierIv, key);
      if (verifier !== VERIFIER_TEXT) {
        throw new Error('Encryption passphrase is incorrect.');
      }
      this.salt = salt;
      this.key = key;
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
    this.privateKey = null;
    this.unlocked.set(false);
    this.error.set(null);
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
        if (data['__encrypted']) continue;
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

  private sortableMetadata(data: Record<string, any>) {
    const metadata: Partial<EncryptedDocument> = {};
    if (typeof data['createdAt'] === 'number') metadata.createdAt = data['createdAt'];
    if (typeof data['updatedAt'] === 'number') metadata.updatedAt = data['updatedAt'];
    if (typeof data['date'] === 'string') metadata.date = data['date'];
    if (typeof data['nextDueDate'] === 'string') metadata.nextDueDate = data['nextDueDate'];
    return metadata;
  }

  private async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: 250000, hash: 'SHA-256' },
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

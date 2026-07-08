import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';

// Export all vault data as an encrypted, portable backup file, and restore it. The file
// is encrypted with a user-chosen backup password (independent of the passphrase), so it
// can be restored even to a fresh account. Document ids are preserved so references
// (transaction -> account/category, budget -> category) stay intact on restore.

const COLLECTIONS = ['accounts', 'categories', 'transactions', 'transactionTemplates', 'bills', 'budgets'];
const BACKUP_ITERATIONS = 250_000;

interface BackupFile {
  format: 'trackr-backup';
  version: number;
  createdAt: string;
  salt: string; // base64
  iv: string;   // base64
  data: string; // base64 — AES-GCM(JSON bundle)
}

@Injectable({ providedIn: 'root' })
export class BackupService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);

  /** Decrypt every collection and return an encrypted backup Blob. */
  async exportVault(password: string): Promise<Blob> {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    if (!this.encryption.unlocked()) throw new Error('Unlock your data first.');
    if (password.length < 8) throw new Error('Use at least 8 characters for the backup password.');

    const bundle: Record<string, unknown[]> = {};
    for (const col of COLLECTIONS) {
      const snap = await getDocs(collection(this.db, `users/${user.uid}/${col}`));
      const items: unknown[] = [];
      for (const d of snap.docs) {
        items.push({ id: d.id, ...(await this.encryption.decryptDoc<Record<string, unknown>>(d.data())) });
      }
      bundle[col] = items;
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt);
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(bundle))),
    );

    const file: BackupFile = {
      format: 'trackr-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      salt: this.b64(salt),
      iv: this.b64(iv),
      data: this.b64(cipher),
    };
    return new Blob([JSON.stringify(file)], { type: 'application/json' });
  }

  /** Decrypt a backup file and write its documents into the current vault (by id). */
  async importVault(fileText: string, password: string): Promise<Record<string, number>> {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    if (!this.encryption.unlocked()) throw new Error('Unlock your data first.');

    let file: BackupFile;
    try {
      file = JSON.parse(fileText);
    } catch {
      throw new Error('That file is not a valid backup.');
    }
    if (file?.format !== 'trackr-backup') throw new Error('That file is not a Trackr backup.');

    const key = await this.deriveKey(password, this.unb64(file.salt));
    let bundle: Record<string, any[]>;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: this.unb64(file.iv) as BufferSource },
        key,
        this.unb64(file.data) as BufferSource,
      );
      bundle = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new Error('Wrong backup password, or the file is corrupted.');
    }

    const counts: Record<string, number> = {};
    for (const col of COLLECTIONS) {
      const items = bundle[col] || [];
      let batch = writeBatch(this.db);
      let pending = 0;
      for (const item of items) {
        const { id, ...data } = item;
        const ref = id
          ? doc(this.db, `users/${user.uid}/${col}/${id}`)
          : doc(collection(this.db, `users/${user.uid}/${col}`));
        batch.set(ref, await this.encryption.encryptForWrite(data));
        pending++;
        if (pending === 400) {
          await batch.commit();
          batch = writeBatch(this.db);
          pending = 0;
        }
      }
      if (pending > 0) await batch.commit();
      counts[col] = items.length;
    }
    return counts;
  }

  private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: BACKUP_ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private b64(bytes: Uint8Array): string {
    let s = '';
    bytes.forEach(b => (s += String.fromCharCode(b)));
    return btoa(s);
  }

  private unb64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
}

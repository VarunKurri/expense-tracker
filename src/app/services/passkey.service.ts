import { Injectable } from '@angular/core';

/**
 * Passkey-based unlock via WebAuthn's PRF extension.
 *
 * A passkey can deterministically produce a per-credential secret (PRF output) that
 * only that authenticator can reproduce. We derive a key-encryption-key (KEK) from it
 * and use it to wrap the vault's master key — so unlocking needs the passkey, nothing
 * leaves the device, and the server sees nothing. Passphrase remains the fallback.
 *
 * Requires a browser + authenticator that support the WebAuthn PRF / hmac-secret
 * extension; if unavailable, register() throws and the app keeps using the passphrase.
 */

export interface PasskeyRecord {
  credentialId: string;    // base64url of the credential raw id
  wrappedMasterKey: string; // base64 — master key encrypted under the PRF-derived KEK
  iv: string;              // base64
  createdAt: number;
}

// Fixed per-app salt for the PRF evaluation; the PRF output is deterministic per
// (credential, salt). Changing this invalidates existing passkeys (re-register needed).
const PRF_SALT = new TextEncoder().encode('trackr-passkey-prf-v1');
const KEK_INFO = new TextEncoder().encode('trackr-passkey-kek-v1');

@Injectable({ providedIn: 'root' })
export class PasskeyService {
  /** Coarse capability check (full PRF support is only known after a real ceremony). */
  isSupported(): boolean {
    return typeof window !== 'undefined'
      && !!window.PublicKeyCredential
      && !!navigator.credentials;
  }

  /** Register a passkey and wrap the master key under its PRF-derived KEK. */
  async register(userId: string, userName: string, masterKey: Uint8Array): Promise<PasskeyRecord> {
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Trackr', id: window.location.hostname },
        user: {
          id: new TextEncoder().encode(userId),
          name: userName,
          displayName: userName,
        },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        timeout: 60_000,
        extensions: { prf: { eval: { first: PRF_SALT } } } as any,
      },
    }) as PublicKeyCredential | null;

    if (!cred) throw new Error('Passkey setup was cancelled.');

    const ext = cred.getClientExtensionResults() as any;
    if (!ext?.prf?.enabled) {
      throw new Error('This device or browser does not support passkey encryption (WebAuthn PRF). Keep using your passphrase.');
    }

    // Some authenticators return the PRF output on create(); others need one get().
    let prfOutput: ArrayBuffer | undefined = ext?.prf?.results?.first;
    if (!prfOutput) {
      prfOutput = await this.evaluatePrf(cred.rawId);
    }

    const kek = await this.deriveKek(prfOutput);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, masterKey as BufferSource);

    return {
      credentialId: this.toBase64(new Uint8Array(cred.rawId)),
      wrappedMasterKey: this.toBase64(new Uint8Array(wrapped)),
      iv: this.toBase64(iv),
      createdAt: Date.now(),
    };
  }

  /** Unlock: authenticate with the passkey and unwrap the master key. */
  async unlock(record: PasskeyRecord): Promise<Uint8Array> {
    const prfOutput = await this.evaluatePrf(this.fromBase64(record.credentialId).buffer as ArrayBuffer);
    const kek = await this.deriveKek(prfOutput);
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.fromBase64(record.iv) as BufferSource },
      kek,
      this.fromBase64(record.wrappedMasterKey) as BufferSource,
    );
    return new Uint8Array(raw);
  }

  /** Run a WebAuthn assertion that evaluates the PRF for a given credential. */
  private async evaluatePrf(credentialRawId: ArrayBuffer): Promise<ArrayBuffer> {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: credentialRawId }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: PRF_SALT } } } as any,
      },
    }) as PublicKeyCredential | null;

    const out: ArrayBuffer | undefined = (assertion?.getClientExtensionResults() as any)?.prf?.results?.first;
    if (!out) throw new Error('Could not derive the passkey secret (PRF unavailable).');
    return out;
  }

  /** HKDF-SHA256 the PRF output into an AES-256-GCM key-encryption-key. */
  private async deriveKek(prfOutput: ArrayBuffer): Promise<CryptoKey> {
    const hkdf = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: KEK_INFO },
      hkdf,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private toBase64(bytes: Uint8Array): string {
    let s = '';
    bytes.forEach(b => (s += String.fromCharCode(b)));
    return btoa(s);
  }

  private fromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
}

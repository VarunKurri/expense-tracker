import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM: authenticated encryption. The key is a 32-byte value provided
// (base64-encoded) via the TOKEN_ENC_KEY secret. GCM produces a 16-byte auth
// tag we store alongside the ciphertext and verify on decrypt.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the recommended size for GCM

export interface EncryptedValue {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

function loadKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENC_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

/** Encrypt a secret string (e.g. a Plaid access token) for storage at rest. */
export function encryptToken(plaintext: string, keyBase64: string): EncryptedValue {
  const key = loadKey(keyBase64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/** Reverse of encryptToken. Throws if the key is wrong or data was tampered with. */
export function decryptToken(value: EncryptedValue, keyBase64: string): string {
  const key = loadKey(keyBase64);
  const iv = Buffer.from(value.iv, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

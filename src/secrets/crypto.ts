/**
 * AES-256-GCM encryption/decryption for secret values.
 * Uses Node.js built-in `crypto` module — no external dependencies.
 *
 * Master key is sourced from SECRETS_ENCRYPTION_KEY env var (must be 64 hex chars = 32 bytes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit tag

/**
 * Retrieve the master encryption key from env.
 * Throws at startup if SECRETS_ENCRYPTION_KEY is missing or malformed.
 */
export function getMasterKey(): Buffer {
  const hex = process.env['SECRETS_ENCRYPTION_KEY'];
  if (!hex) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY environment variable is required for the secrets store. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (hex.length !== 64) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${hex.length.toString()} characters.`,
    );
  }
  return Buffer.from(hex, 'hex');
}

export interface EncryptedPayload {
  encryptedValue: string; // hex
  iv: string; // hex
  authTag: string; // hex
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns hex-encoded ciphertext, IV, and auth tag.
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypt a hex-encoded AES-256-GCM ciphertext.
 * Throws if the auth tag is invalid (tampered or wrong key).
 */
export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const encryptedBuffer = Buffer.from(payload.encryptedValue, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
  return decrypted.toString('utf8');
}

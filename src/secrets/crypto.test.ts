/**
 * Tests for AES-256-GCM encrypt/decrypt functions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { getMasterKey, encrypt, decrypt } from './crypto.js';

// ─── getMasterKey tests ──────────────────────────────────────────

describe('getMasterKey', () => {
  const originalEnv = process.env['SECRETS_ENCRYPTION_KEY'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['SECRETS_ENCRYPTION_KEY'];
    } else {
      process.env['SECRETS_ENCRYPTION_KEY'] = originalEnv;
    }
  });

  it('returns a 32-byte Buffer when SECRETS_ENCRYPTION_KEY is valid 64 hex chars', () => {
    const key = randomBytes(32).toString('hex');
    process.env['SECRETS_ENCRYPTION_KEY'] = key;
    const result = getMasterKey();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
    expect(result.toString('hex')).toBe(key);
  });

  it('throws when SECRETS_ENCRYPTION_KEY is missing', () => {
    delete process.env['SECRETS_ENCRYPTION_KEY'];
    expect(() => getMasterKey()).toThrow('SECRETS_ENCRYPTION_KEY environment variable is required');
  });

  it('throws when SECRETS_ENCRYPTION_KEY is wrong length', () => {
    process.env['SECRETS_ENCRYPTION_KEY'] = 'abc123';
    expect(() => getMasterKey()).toThrow('must be exactly 64 hex characters');
  });
});

// ─── encrypt / decrypt roundtrip ────────────────────────────────

describe('encrypt / decrypt', () => {
  let key: Buffer;

  beforeEach(() => {
    key = randomBytes(32);
  });

  it('roundtrips a simple string', () => {
    const plaintext = 'hello world';
    const payload = encrypt(plaintext, key);
    const result = decrypt(payload, key);
    expect(result).toBe(plaintext);
  });

  it('roundtrips a long string', () => {
    const plaintext = 'a'.repeat(10_000);
    const payload = encrypt(plaintext, key);
    expect(decrypt(payload, key)).toBe(plaintext);
  });

  it('roundtrips unicode + special characters', () => {
    const plaintext = '🔑 ¡Héllo wörld! \n\t"quoted"';
    const payload = encrypt(plaintext, key);
    expect(decrypt(payload, key)).toBe(plaintext);
  });

  it('returns different ciphertext each call (IV randomness)', () => {
    const plaintext = 'same input';
    const p1 = encrypt(plaintext, key);
    const p2 = encrypt(plaintext, key);
    expect(p1.iv).not.toBe(p2.iv);
    expect(p1.encryptedValue).not.toBe(p2.encryptedValue);
    // But both decrypt to same value
    expect(decrypt(p1, key)).toBe(plaintext);
    expect(decrypt(p2, key)).toBe(plaintext);
  });

  it('produces hex-encoded strings for encryptedValue, iv, authTag', () => {
    const payload = encrypt('test', key);
    expect(payload.encryptedValue).toMatch(/^[0-9a-f]+$/);
    expect(payload.iv).toMatch(/^[0-9a-f]+$/);
    expect(payload.authTag).toMatch(/^[0-9a-f]+$/);
  });

  it('throws when decrypting with wrong key (auth tag mismatch)', () => {
    const payload = encrypt('secret', key);
    const wrongKey = randomBytes(32);
    expect(() => decrypt(payload, wrongKey)).toThrow();
  });

  it('throws when decrypting tampered ciphertext', () => {
    const payload = encrypt('secret', key);
    // Flip a byte in the encrypted value
    const tampered = {
      ...payload,
      encryptedValue: payload.encryptedValue.slice(0, -2) + '00',
    };
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('throws when decrypting with tampered auth tag', () => {
    const payload = encrypt('secret', key);
    const tampered = {
      ...payload,
      authTag: 'deadbeef'.repeat(4), // wrong 128-bit tag
    };
    expect(() => decrypt(tampered, key)).toThrow();
  });
});

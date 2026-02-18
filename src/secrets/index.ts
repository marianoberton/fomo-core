/**
 * Secrets module — encrypted per-project credential store.
 * @module secrets
 */
export type { SecretMetadata, SecretRecord, SecretRepository, SecretService } from './types.js';
export { createSecretService } from './secret-service.js';
export { getMasterKey, encrypt, decrypt } from './crypto.js';
export type { EncryptedPayload } from './crypto.js';

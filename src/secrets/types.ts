/**
 * Types for the encrypted secrets store.
 * Secrets are AES-256-GCM encrypted per-project credentials stored in the DB.
 * The plaintext value is NEVER returned by the repository — only by the service layer
 * after decryption, and NEVER surfaced to API responses.
 */

// ─── Domain Types ────────────────────────────────────────────────

/** Metadata about a stored secret (no value, no encrypted bytes). */
export interface SecretMetadata {
  id: string;
  projectId: string;
  key: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Raw encrypted record as stored in DB (no plaintext). */
export interface SecretRecord {
  id: string;
  projectId: string;
  key: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Repository Interface ────────────────────────────────────────

export interface SecretRepository {
  /** Store or overwrite an encrypted secret for a project. */
  upsert(input: {
    projectId: string;
    key: string;
    encryptedValue: string;
    iv: string;
    authTag: string;
    description?: string;
  }): Promise<SecretMetadata>;

  /** Find the encrypted record for a project+key. Returns null if not found. */
  findEncrypted(projectId: string, key: string): Promise<SecretRecord | null>;

  /** List secret metadata for a project (no values). */
  listMetadata(projectId: string): Promise<SecretMetadata[]>;

  /** Delete a secret. Returns true if deleted, false if not found. */
  delete(projectId: string, key: string): Promise<boolean>;

  /** Check if a secret key exists for a project. */
  exists(projectId: string, key: string): Promise<boolean>;
}

// ─── Service Interface ───────────────────────────────────────────

export interface SecretService {
  /** Encrypt and store a secret value. Overwrites if key already exists. */
  set(projectId: string, key: string, value: string, description?: string): Promise<SecretMetadata>;

  /** Retrieve and decrypt a secret value. Throws SecretNotFoundError if absent. */
  get(projectId: string, key: string): Promise<string>;

  /** List secret metadata for a project (keys + descriptions, no values). */
  list(projectId: string): Promise<SecretMetadata[]>;

  /** Delete a secret. Returns true if deleted, false if not found. */
  delete(projectId: string, key: string): Promise<boolean>;

  /** Check if a secret key exists for a project. */
  exists(projectId: string, key: string): Promise<boolean>;
}

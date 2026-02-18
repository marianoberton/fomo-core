/**
 * SecretService — business logic for encrypted project secrets.
 * Wraps the repository with encrypt/decrypt logic using the master key.
 */
import { SecretNotFoundError } from '@/core/errors.js';
import { encrypt, decrypt, getMasterKey } from './crypto.js';
import type { SecretRepository, SecretService, SecretMetadata } from './types.js';

interface SecretServiceDeps {
  secretRepository: SecretRepository;
}

/**
 * Create a SecretService backed by the given repository.
 * The master key is resolved from SECRETS_ENCRYPTION_KEY at first use.
 */
export function createSecretService(deps: SecretServiceDeps): SecretService {
  const { secretRepository } = deps;

  // Lazy-load master key so tests can set the env var before calling service methods
  let masterKey: Buffer | null = null;
  function getKey(): Buffer {
    masterKey ??= getMasterKey();
    return masterKey;
  }

  return {
    async set(
      projectId: string,
      key: string,
      value: string,
      description?: string,
    ): Promise<SecretMetadata> {
      const payload = encrypt(value, getKey());
      return secretRepository.upsert({
        projectId,
        key,
        encryptedValue: payload.encryptedValue,
        iv: payload.iv,
        authTag: payload.authTag,
        description,
      });
    },

    async get(projectId: string, key: string): Promise<string> {
      const record = await secretRepository.findEncrypted(projectId, key);
      if (!record) {
        throw new SecretNotFoundError(projectId, key);
      }
      return decrypt(
        { encryptedValue: record.encryptedValue, iv: record.iv, authTag: record.authTag },
        getKey(),
      );
    },

    async list(projectId: string): Promise<SecretMetadata[]> {
      return secretRepository.listMetadata(projectId);
    },

    async delete(projectId: string, key: string): Promise<boolean> {
      return secretRepository.delete(projectId, key);
    },

    async exists(projectId: string, key: string): Promise<boolean> {
      return secretRepository.exists(projectId, key);
    },
  };
}

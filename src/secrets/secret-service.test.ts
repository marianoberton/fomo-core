/**
 * Tests for SecretService — encrypt/decrypt lifecycle via mocked repository.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createSecretService } from './secret-service.js';
import { SecretNotFoundError } from '@/core/errors.js';
import type { SecretRepository, SecretMetadata, SecretRecord } from './types.js';

// ─── Setup ──────────────────────────────────────────────────────

const ENCRYPTION_KEY = randomBytes(32).toString('hex');

// Set env before service is used (lazy getMasterKey)
vi.stubEnv('SECRETS_ENCRYPTION_KEY', ENCRYPTION_KEY);

function makeMetadata(projectId: string, key: string): SecretMetadata {
  return {
    id: 'sec_test',
    projectId,
    key,
    description: undefined,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('SecretService', () => {
  let mockRepo: SecretRepository;
  let storedRecord: SecretRecord | null;

  beforeEach(() => {
    storedRecord = null;

    mockRepo = {
      upsert: vi.fn((input: Parameters<SecretRepository['upsert']>[0]) => {
        storedRecord = {
          id: 'sec_test',
          projectId: input.projectId,
          key: input.key,
          encryptedValue: input.encryptedValue,
          iv: input.iv,
          authTag: input.authTag,
          description: input.description,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return Promise.resolve(makeMetadata(input.projectId, input.key));
      }),
      findEncrypted: vi.fn(() => Promise.resolve(storedRecord)),
      listMetadata: vi.fn(() => Promise.resolve<SecretMetadata[]>([])),
      delete: vi.fn(() => Promise.resolve(true)),
      exists: vi.fn(() => Promise.resolve(storedRecord !== null)),
    };
  });

  it('set() encrypts and stores the value (plaintext not stored)', async () => {
    const service = createSecretService({ secretRepository: mockRepo });
    await service.set('proj1', 'TAVILY_API_KEY', 'secret-value-123');

    expect(mockRepo.upsert).toHaveBeenCalledOnce();

    // The stored record should NOT contain the plaintext
    expect(storedRecord?.encryptedValue).not.toContain('secret-value-123');
    expect(storedRecord?.iv).toBeTruthy();
    expect(storedRecord?.authTag).toBeTruthy();
  });

  it('get() decrypts and returns the original value', async () => {
    const service = createSecretService({ secretRepository: mockRepo });
    await service.set('proj1', 'MY_KEY', 'plaintext-secret');
    const retrieved = await service.get('proj1', 'MY_KEY');
    expect(retrieved).toBe('plaintext-secret');
  });

  it('get() throws SecretNotFoundError when key does not exist', async () => {
    const service = createSecretService({ secretRepository: mockRepo });
    // findEncrypted returns null (storedRecord is null)
    await expect(service.get('proj1', 'MISSING_KEY')).rejects.toThrow(SecretNotFoundError);
  });

  it('set() passes description to repository', async () => {
    const service = createSecretService({ secretRepository: mockRepo });
    await service.set('proj1', 'API_KEY', 'value', 'My API key description');

    expect(mockRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'My API key description' }),
    );
  });

  it('list() delegates to repository.listMetadata', async () => {
    const service = createSecretService({ secretRepository: mockRepo });
    const result = await service.list('proj1');

    expect(mockRepo.listMetadata).toHaveBeenCalledWith('proj1');
    expect(result).toEqual([]);
  });

  it('delete() delegates to repository.delete', async () => {
    const service = createSecretService({ secretRepository: mockRepo });
    const result = await service.delete('proj1', 'OLD_KEY');

    expect(mockRepo.delete).toHaveBeenCalledWith('proj1', 'OLD_KEY');
    expect(result).toBe(true);
  });

  it('exists() delegates to repository.exists', async () => {
    const service = createSecretService({ secretRepository: mockRepo });
    const result = await service.exists('proj1', 'SOME_KEY');

    expect(mockRepo.exists).toHaveBeenCalledWith('proj1', 'SOME_KEY');
    expect(typeof result).toBe('boolean');
  });

  it('two set() calls with same key produce different ciphertexts (IV randomness)', async () => {
    const service = createSecretService({ secretRepository: mockRepo });
    await service.set('proj1', 'KEY', 'same-value');
    const first = storedRecord ? { ...storedRecord } : null;

    storedRecord = null;
    await service.set('proj1', 'KEY', 'same-value');
    const second = storedRecord as SecretRecord | null;

    expect(first?.iv).not.toBe(second?.iv);
    expect(first?.encryptedValue).not.toBe(second?.encryptedValue);
  });

  it('set() returns SecretMetadata (no encrypted fields)', async () => {
    const service = createSecretService({ secretRepository: mockRepo });
    const meta = await service.set('proj1', 'KEY', 'value');

    expect(meta).toHaveProperty('id');
    expect(meta).toHaveProperty('projectId');
    expect(meta).toHaveProperty('key');
    expect(meta).not.toHaveProperty('encryptedValue');
    expect(meta).not.toHaveProperty('iv');
    expect(meta).not.toHaveProperty('authTag');
  });
});

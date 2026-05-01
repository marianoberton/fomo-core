import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  storeChatwootSecrets,
  getChatwootApiToken,
} from './chatwoot-secrets.js';
import type { SecretService, SecretMetadata } from './types.js';
import type { ProjectId } from '@/core/types.js';

function makeMetadata(key: string, projectId: string): SecretMetadata {
  return {
    id: `sec_${key}`,
    projectId,
    key,
    description: 'test',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockSecretService(): SecretService & {
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  exists: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  const set = vi.fn((projectId: string, key: string, value: string) => {
    store.set(`${projectId}:${key}`, value);
    return Promise.resolve(makeMetadata(key, projectId));
  });
  const get = vi.fn((projectId: string, key: string) => {
    const v = store.get(`${projectId}:${key}`);
    if (!v) return Promise.reject(new Error('not found'));
    return Promise.resolve(v);
  });
  const exists = vi.fn((projectId: string, key: string) => Promise.resolve(store.has(`${projectId}:${key}`)));
  const del = vi.fn((projectId: string, key: string) => Promise.resolve(store.delete(`${projectId}:${key}`)));
  const list = vi.fn(() => Promise.resolve([] as SecretMetadata[]));
  return { set, get, list, delete: del, exists };
}

describe('chatwoot-secrets', () => {
  const projectId = 'proj_fomo' as ProjectId;
  let svc: ReturnType<typeof createMockSecretService>;

  beforeEach(() => {
    svc = createMockSecretService();
  });

  it('stores the api token under the default key', async () => {
    const result = await storeChatwootSecrets(svc, {
      projectId,
      apiToken: 'cw_token_abc',
    });

    expect(result.apiTokenKey).toBe('CHATWOOT_API_TOKEN');
    expect(svc.set).toHaveBeenCalledTimes(1);
    await expect(getChatwootApiToken(svc, projectId)).resolves.toBe('cw_token_abc');
  });

  it('respects a custom api token key name', async () => {
    const result = await storeChatwootSecrets(svc, {
      projectId,
      apiToken: 'token',
      apiTokenKey: 'CHATWOOT_API_TOKEN_FOMO',
    });

    expect(result.apiTokenKey).toBe('CHATWOOT_API_TOKEN_FOMO');
    await expect(getChatwootApiToken(svc, projectId, 'CHATWOOT_API_TOKEN_FOMO')).resolves.toBe('token');
  });

  it('round-trips through set/get', async () => {
    await storeChatwootSecrets(svc, {
      projectId,
      apiToken: 'rt_token',
    });

    const token = await getChatwootApiToken(svc, projectId);
    expect(token).toBe('rt_token');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  storeChatwootSecrets,
  getChatwootApiToken,
  getChatwootWebhookSecret,
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

  it('stores api token + webhook secret under default keys', async () => {
    const result = await storeChatwootSecrets(svc, {
      projectId,
      apiToken: 'cw_token_abc',
      webhookSecret: 'cw_whsec_xyz',
    });

    expect(result.apiTokenKey).toBe('CHATWOOT_API_TOKEN');
    expect(result.webhookSecretKey).toBe('CHATWOOT_WEBHOOK_SECRET');
    expect(svc.set).toHaveBeenCalledTimes(2);
    await expect(getChatwootApiToken(svc, projectId)).resolves.toBe('cw_token_abc');
    await expect(getChatwootWebhookSecret(svc, projectId)).resolves.toBe('cw_whsec_xyz');
  });

  it('respects custom key names', async () => {
    const result = await storeChatwootSecrets(svc, {
      projectId,
      apiToken: 'token',
      webhookSecret: 'whsec',
      apiTokenKey: 'CHATWOOT_API_TOKEN_FOMO',
      webhookSecretKey: 'CHATWOOT_WEBHOOK_SECRET_FOMO',
    });

    expect(result.apiTokenKey).toBe('CHATWOOT_API_TOKEN_FOMO');
    expect(result.webhookSecretKey).toBe('CHATWOOT_WEBHOOK_SECRET_FOMO');
    await expect(getChatwootApiToken(svc, projectId, 'CHATWOOT_API_TOKEN_FOMO')).resolves.toBe('token');
  });

  it('round-trips through set/get', async () => {
    await storeChatwootSecrets(svc, {
      projectId,
      apiToken: 'rt_token',
      webhookSecret: 'rt_whsec',
    });

    const token = await getChatwootApiToken(svc, projectId);
    const whsec = await getChatwootWebhookSecret(svc, projectId);
    expect(token).toBe('rt_token');
    expect(whsec).toBe('rt_whsec');
  });
});

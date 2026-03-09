import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { createApiKeyService } from './api-key-service.js';
import type { Logger } from '@/observability/logger.js';

describe('api-key-service', () => {
  let mockPrisma: PrismaClient;
  let mockLogger: Logger;
  let service: ReturnType<typeof createApiKeyService>;

  beforeEach(() => {
    mockPrisma = {
      apiKey: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
    } as unknown as PrismaClient;

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    service = createApiKeyService({ prisma: mockPrisma, logger: mockLogger });
  });

  describe('generateApiKey', () => {
    it('returns a plaintext token starting with nx_', async () => {
      const mockMeta = {
        id: 'key-1',
        prefix: 'nx_abcd',
        name: 'Test Key',
        projectId: 'proj-1',
        scopes: ['*'],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.apiKey.create).mockResolvedValue(
        mockMeta as unknown as Awaited<ReturnType<PrismaClient['apiKey']['create']>>,
      );

      const result = await service.generateApiKey({
        projectId: 'proj-1',
        scopes: ['*'],
        name: 'Test Key',
      });

      expect(result.plaintext).toMatch(/^nx_/);
      expect(result.plaintext.length).toBe(67); // nx_ + 64 hex chars
    });

    it('stores a hash, not the plaintext', async () => {
      const mockMeta = {
        id: 'key-1',
        prefix: 'nx_abcd',
        name: 'Test Key',
        projectId: null,
        scopes: ['*'],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.apiKey.create).mockResolvedValue(
        mockMeta as unknown as Awaited<ReturnType<PrismaClient['apiKey']['create']>>,
      );

      const result = await service.generateApiKey({
        scopes: ['*'],
        name: 'Master Key',
      });

      const createCall = vi.mocked(mockPrisma.apiKey.create).mock.calls[0]!;
      const passedKey = createCall[0].data.key;

      // The stored key should be a SHA-256 hash (64 hex chars)
      expect(passedKey).toMatch(/^[a-f0-9]{64}$/);
      expect(passedKey).not.toBe(result.plaintext);
    });

    it('sets prefix to first 8 chars of plaintext', async () => {
      const mockMeta = {
        id: 'key-1',
        prefix: 'nx_abc12', // Will be overwritten by actual call
        name: 'Test Key',
        projectId: 'proj-1',
        scopes: ['*'],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.apiKey.create).mockResolvedValue(
        mockMeta as unknown as Awaited<ReturnType<PrismaClient['apiKey']['create']>>,
      );

      const result = await service.generateApiKey({
        projectId: 'proj-1',
        scopes: ['*'],
        name: 'Test Key',
      });

      const createCall = vi.mocked(mockPrisma.apiKey.create).mock.calls[0]!;
      const passedPrefix = createCall[0].data.prefix;

      expect(passedPrefix).toBe(result.plaintext.slice(0, 8));
    });

    it('propagates projectId correctly', async () => {
      const mockMeta = {
        id: 'key-1',
        prefix: 'nx_abc',
        name: 'Test Key',
        projectId: 'proj-123',
        scopes: ['*'],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.apiKey.create).mockResolvedValue(
        mockMeta as unknown as Awaited<ReturnType<PrismaClient['apiKey']['create']>>,
      );

      const result = await service.generateApiKey({
        projectId: 'proj-123',
        scopes: ['*'],
        name: 'Project Key',
      });

      expect(result.meta.projectId).toBe('proj-123');
    });

    it('creates master key when projectId is undefined', async () => {
      const mockMeta = {
        id: 'master-key',
        prefix: 'nx_xyz',
        name: 'Master',
        projectId: null,
        scopes: ['*'],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.apiKey.create).mockResolvedValue(
        mockMeta as unknown as Awaited<ReturnType<PrismaClient['apiKey']['create']>>,
      );

      const result = await service.generateApiKey({
        scopes: ['*'],
        name: 'Master',
      });

      expect(result.meta.projectId).toBeNull();
    });
  });

  describe('validateApiKey', () => {
    it('returns valid: true for a freshly generated key', async () => {
      const record = {
        id: 'key-1',
        key: 'hash',
        prefix: 'nx_abc',
        name: 'Test',
        projectId: 'proj-1',
        scopes: ['*'],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.apiKey.findUnique).mockResolvedValue(
        record as unknown as Awaited<ReturnType<PrismaClient['apiKey']['findUnique']>>,
      );
      vi.mocked(mockPrisma.apiKey.update).mockResolvedValue(
        record as unknown as Awaited<ReturnType<PrismaClient['apiKey']['update']>>,
      );

      // For this test, we'll use a raw key that when hashed matches what findUnique will find
      // In reality, the service hashes the input, so we need to match the hash
      const result = await service.validateApiKey('some-raw-key');

      expect(result.valid).toBe(true);
      expect(result.projectId).toBe('proj-1');
      expect(result.scopes).toEqual(['*']);
    });

    it('returns valid: false for unknown key', async () => {
      vi.mocked(mockPrisma.apiKey.findUnique).mockResolvedValue(null);

      const result = await service.validateApiKey('unknown-key');

      expect(result.valid).toBe(false);
      expect(result.projectId).toBeNull();
      expect(result.scopes).toEqual([]);
    });

    it('returns valid: false for revoked key', async () => {
      const record = {
        id: 'key-1',
        key: 'hash',
        prefix: 'nx_abc',
        name: 'Test',
        projectId: 'proj-1',
        scopes: ['*'],
        expiresAt: null,
        revokedAt: new Date('2025-01-01'),
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.apiKey.findUnique).mockResolvedValue(
        record as unknown as Awaited<ReturnType<PrismaClient['apiKey']['findUnique']>>,
      );

      const result = await service.validateApiKey('revoked-key');

      expect(result.valid).toBe(false);
    });

    it('returns valid: false for expired key', async () => {
      const record = {
        id: 'key-1',
        key: 'hash',
        prefix: 'nx_abc',
        name: 'Test',
        projectId: 'proj-1',
        scopes: ['*'],
        expiresAt: new Date('2020-01-01'), // past date
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.apiKey.findUnique).mockResolvedValue(
        record as unknown as Awaited<ReturnType<PrismaClient['apiKey']['findUnique']>>,
      );

      const result = await service.validateApiKey('expired-key');

      expect(result.valid).toBe(false);
    });

    it('updates lastUsedAt on successful validation', async () => {
      const record = {
        id: 'key-1',
        key: 'hash',
        prefix: 'nx_abc',
        name: 'Test',
        projectId: 'proj-1',
        scopes: ['*'],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.apiKey.findUnique).mockResolvedValue(
        record as unknown as Awaited<ReturnType<PrismaClient['apiKey']['findUnique']>>,
      );
      vi.mocked(mockPrisma.apiKey.update).mockResolvedValue(
        record as unknown as Awaited<ReturnType<PrismaClient['apiKey']['update']>>,
      );

      await service.validateApiKey('valid-key');

      // Check that update was called (eventually, even if fire-and-forget)
      expect(mockPrisma.apiKey.update).toHaveBeenCalled();
    });
  });

  describe('revokeApiKey', () => {
    it('returns true on successful revocation', async () => {
      const record = {
        id: 'key-1',
        key: 'hash',
        prefix: 'nx_abc',
        name: 'Test',
        projectId: 'proj-1',
        scopes: ['*'],
        expiresAt: null,
        revokedAt: new Date(),
        lastUsedAt: null,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.apiKey.update).mockResolvedValue(
        record as unknown as Awaited<ReturnType<PrismaClient['apiKey']['update']>>,
      );

      const result = await service.revokeApiKey('key-1');

      expect(result).toBe(true);
    });

    it('returns false when key not found (P2025)', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Record not found',
        { code: 'P2025', clientVersion: '1.0' },
      );

      vi.mocked(mockPrisma.apiKey.update).mockRejectedValue(prismaError);

      const result = await service.revokeApiKey('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('listApiKeys', () => {
    it('lists all keys for a project', async () => {
      const records = [
        {
          id: 'key-1',
          key: 'hash1',
          prefix: 'nx_abc',
          name: 'Key 1',
          projectId: 'proj-1',
          scopes: ['*'],
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
        },
        {
          id: 'key-2',
          key: 'hash2',
          prefix: 'nx_def',
          name: 'Key 2',
          projectId: 'proj-1',
          scopes: ['chat'],
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
        },
      ];

      vi.mocked(mockPrisma.apiKey.findMany).mockResolvedValue(
        records as unknown as Awaited<ReturnType<PrismaClient['apiKey']['findMany']>>,
      );

      const result = await service.listApiKeys('proj-1');

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('Key 1');
      expect(result[1]?.name).toBe('Key 2');
    });

    it('lists all keys when no projectId filter', async () => {
      const records = [
        {
          id: 'master-1',
          key: 'hash-master',
          prefix: 'nx_mst',
          name: 'Master',
          projectId: null,
          scopes: ['*'],
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
        },
      ];

      vi.mocked(mockPrisma.apiKey.findMany).mockResolvedValue(
        records as unknown as Awaited<ReturnType<PrismaClient['apiKey']['findMany']>>,
      );

      const result = await service.listApiKeys();

      expect(result).toHaveLength(1);
      expect(result[0]?.projectId).toBeNull();
    });
  });
});

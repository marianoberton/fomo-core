import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';

/**
 * Metadata about an API key (never includes the hash).
 */
export interface ApiKeyMeta {
  id: string;
  prefix: string;
  name: string;
  projectId: string | null;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/**
 * Result of validating an API key.
 */
export interface ApiKeyValidationResult {
  valid: boolean;
  projectId: string | null;
  scopes: string[];
}

/**
 * Service for generating, validating, and managing API keys.
 */
export interface ApiKeyService {
  /**
   * Generate a new API key for a project (or a master key if projectId is undefined).
   * Returns the plaintext token (only time it's ever exposed).
   */
  generateApiKey(params: {
    projectId?: string;
    scopes: string[];
    name: string;
    expiresAt?: Date;
  }): Promise<{ plaintext: string; meta: ApiKeyMeta }>;

  /**
   * Validate an API key by its raw plaintext value.
   * Updates lastUsedAt on success.
   */
  validateApiKey(rawKey: string): Promise<ApiKeyValidationResult>;

  /**
   * Revoke an API key by ID.
   * Returns true if revoked, false if not found.
   */
  revokeApiKey(id: string): Promise<boolean>;

  /**
   * List all API keys (optionally filtered by projectId).
   * Does NOT return the hash; only metadata.
   */
  listApiKeys(projectId?: string): Promise<ApiKeyMeta[]>;
}

/**
 * Create an API key service backed by Prisma.
 */
export function createApiKeyService(params: {
  prisma: PrismaClient;
  logger: Logger;
}): ApiKeyService {
  const { prisma, logger } = params;

  /**
   * Hash a raw key string with SHA-256.
   */
  function hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  /**
   * Map a Prisma ApiKey record to ApiKeyMeta (excluding the hash).
   */
  function toMeta(record: {
    id: string;
    prefix: string;
    name: string;
    projectId: string | null;
    scopes: string[];
    expiresAt: Date | null;
    revokedAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
  }): ApiKeyMeta {
    return {
      id: record.id,
      prefix: record.prefix,
      name: record.name,
      projectId: record.projectId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      lastUsedAt: record.lastUsedAt,
      createdAt: record.createdAt,
    };
  }

  return {
    async generateApiKey(params) {
      // Generate token: nx_ + 32 random bytes as hex = 67 chars total
      const randomPart = randomBytes(32).toString('hex');
      const plaintext = `nx_${randomPart}`;
      const prefix = plaintext.slice(0, 8);
      const hash = hashKey(plaintext);

      const record = await prisma.apiKey.create({
        data: {
          key: hash,
          prefix,
          name: params.name,
          projectId: params.projectId,
          scopes: params.scopes,
          expiresAt: params.expiresAt,
        },
      });

      logger.info('API key generated', {
        component: 'api-key-service',
        projectId: params.projectId,
        name: params.name,
      });

      return {
        plaintext,
        meta: toMeta(record),
      };
    },

    async validateApiKey(rawKey) {
      const hash = hashKey(rawKey);
      const record = await prisma.apiKey.findUnique({
        where: { key: hash },
      });

      if (!record) {
        return { valid: false, projectId: null, scopes: [] };
      }

      // Check if revoked
      if (record.revokedAt) {
        return { valid: false, projectId: null, scopes: [] };
      }

      // Check if expired
      if (record.expiresAt && record.expiresAt < new Date()) {
        return { valid: false, projectId: null, scopes: [] };
      }

      // Update lastUsedAt (fire-and-forget with error handling)
      prisma.apiKey
        .update({
          where: { id: record.id },
          data: { lastUsedAt: new Date() },
        })
        .catch((err: unknown) => {
          logger.warn('Failed to update API key lastUsedAt', {
            component: 'api-key-service',
            error: err instanceof Error ? err.message : String(err),
          });
        });

      return {
        valid: true,
        projectId: record.projectId,
        scopes: record.scopes,
      };
    },

    async revokeApiKey(id) {
      try {
        await prisma.apiKey.update({
          where: { id },
          data: { revokedAt: new Date() },
        });
        logger.info('API key revoked', {
          component: 'api-key-service',
          apiKeyId: id,
        });
        return true;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2025'
        ) {
          return false;
        }
        throw err;
      }
    },

    async listApiKeys(projectId) {
      const records = await prisma.apiKey.findMany({
        where: projectId ? { projectId } : undefined,
        orderBy: { createdAt: 'desc' },
      });

      return records.map(toMeta);
    },
  };
}

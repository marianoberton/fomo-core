/**
 * Secret repository — Prisma-backed CRUD for the secrets table.
 * Values are always stored encrypted; this repository never handles plaintext.
 */
import type { PrismaClient } from '@prisma/client';
import type { SecretRepository, SecretMetadata, SecretRecord } from '@/secrets/types.js';

/** Map a Prisma secret record to SecretMetadata (no encrypted bytes). */
function toMetadata(record: {
  id: string;
  projectId: string;
  key: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SecretMetadata {
  return {
    id: record.id,
    projectId: record.projectId,
    key: record.key,
    description: record.description ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Map a Prisma secret record to SecretRecord (includes encrypted bytes for decryption). */
function toRecord(record: {
  id: string;
  projectId: string;
  key: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SecretRecord {
  return {
    id: record.id,
    projectId: record.projectId,
    key: record.key,
    encryptedValue: record.encryptedValue,
    iv: record.iv,
    authTag: record.authTag,
    description: record.description ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Create a SecretRepository backed by Prisma.
 */
export function createSecretRepository(prisma: PrismaClient): SecretRepository {
  return {
    async upsert(input): Promise<SecretMetadata> {
      const record = await prisma.secret.upsert({
        where: { projectId_key: { projectId: input.projectId, key: input.key } },
        create: {
          projectId: input.projectId,
          key: input.key,
          encryptedValue: input.encryptedValue,
          iv: input.iv,
          authTag: input.authTag,
          description: input.description ?? null,
        },
        update: {
          encryptedValue: input.encryptedValue,
          iv: input.iv,
          authTag: input.authTag,
          description: input.description,
        },
      });
      return toMetadata(record);
    },

    async findEncrypted(projectId: string, key: string): Promise<SecretRecord | null> {
      const record = await prisma.secret.findUnique({
        where: { projectId_key: { projectId, key } },
      });
      if (!record) return null;
      return toRecord(record);
    },

    async listMetadata(projectId: string): Promise<SecretMetadata[]> {
      const records = await prisma.secret.findMany({
        where: { projectId },
        orderBy: { key: 'asc' },
        select: {
          id: true,
          projectId: true,
          key: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return records.map(toMetadata);
    },

    async delete(projectId: string, key: string): Promise<boolean> {
      try {
        await prisma.secret.delete({
          where: { projectId_key: { projectId, key } },
        });
        return true;
      } catch {
        return false;
      }
    },

    async exists(projectId: string, key: string): Promise<boolean> {
      const count = await prisma.secret.count({
        where: { projectId, key },
      });
      return count > 0;
    },
  };
}

/**
 * File repository — CRUD for file metadata.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import type {
  StoredFile,
  FileId,
  FileRepository,
  StorageProvider,
} from '@/files/types.js';

// ─── Mapper ─────────────────────────────────────────────────────

function toFileModel(record: {
  id: string;
  projectId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  storagePath: string;
  publicUrl: string | null;
  uploadedBy: string | null;
  uploadedAt: Date;
  expiresAt: Date | null;
  metadata: unknown;
}): StoredFile {
  return {
    id: record.id as FileId,
    projectId: record.projectId as ProjectId,
    filename: record.filename,
    originalFilename: record.originalFilename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    storageProvider: record.storageProvider as StorageProvider,
    storagePath: record.storagePath,
    publicUrl: record.publicUrl ?? undefined,
    uploadedBy: record.uploadedBy ?? undefined,
    uploadedAt: record.uploadedAt,
    expiresAt: record.expiresAt ?? undefined,
    metadata: (record.metadata as Record<string, unknown> | null) ?? undefined,
  };
}

// ─── Repository Factory ─────────────────────────────────────────

/**
 * Create a FileRepository backed by Prisma.
 */
export function createFileRepository(prisma: PrismaClient): FileRepository {
  return {
    async create(file: Omit<StoredFile, 'id' | 'uploadedAt'>): Promise<StoredFile> {
      const record = await prisma.file.create({
        data: {
          projectId: file.projectId,
          filename: file.filename,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storageProvider: file.storageProvider,
          storagePath: file.storagePath,
          publicUrl: file.publicUrl ?? null,
          uploadedBy: file.uploadedBy ?? null,
          expiresAt: file.expiresAt ?? null,
          metadata: (file.metadata as Prisma.InputJsonValue) ?? undefined,
        },
      });
      return toFileModel(record);
    },

    async findById(id: FileId): Promise<StoredFile | null> {
      const record = await prisma.file.findUnique({ where: { id } });
      if (!record) return null;
      return toFileModel(record);
    },

    async findByProject(
      projectId: ProjectId,
      options?: { limit?: number; offset?: number },
    ): Promise<StoredFile[]> {
      const records = await prisma.file.findMany({
        where: { projectId },
        orderBy: { uploadedAt: 'desc' },
        take: options?.limit,
        skip: options?.offset,
      });
      return records.map(toFileModel);
    },

    async delete(id: FileId): Promise<void> {
      await prisma.file.delete({ where: { id } });
    },

    async updateMetadata(id: FileId, metadata: Record<string, unknown>): Promise<StoredFile> {
      const record = await prisma.file.update({
        where: { id },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
      return toFileModel(record);
    },
  };
}

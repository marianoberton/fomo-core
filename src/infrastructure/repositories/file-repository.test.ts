import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import { createFileRepository } from './file-repository.js';

const PROJECT_ID = 'proj_test' as ProjectId;

function makeFileRecord(overrides?: Record<string, unknown>) {
  return {
    id: 'file_abc',
    projectId: PROJECT_ID,
    filename: 'a1b2c3d4.pdf',
    originalFilename: 'document.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 12345,
    storageProvider: 'local',
    storagePath: 'proj_test/2025/01/01/a1b2c3d4.pdf',
    publicUrl: null,
    uploadedBy: 'user_123',
    uploadedAt: new Date('2025-01-01'),
    expiresAt: null,
    metadata: { source: 'upload' },
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    file: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe('FileRepository', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates a file record', async () => {
      vi.mocked(mockPrisma.file.create).mockResolvedValue(makeFileRecord() as never);

      const repo = createFileRepository(mockPrisma);
      const file = await repo.create({
        projectId: PROJECT_ID,
        filename: 'a1b2c3d4.pdf',
        originalFilename: 'document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12345,
        storageProvider: 'local',
        storagePath: 'proj_test/2025/01/01/a1b2c3d4.pdf',
      });

      expect(file.id).toBe('file_abc');
      expect(file.originalFilename).toBe('document.pdf');
      expect(file.sizeBytes).toBe(12345);
      expect(mockPrisma.file.create).toHaveBeenCalledOnce();
    });

    it('creates a file with optional fields', async () => {
      vi.mocked(mockPrisma.file.create).mockResolvedValue(
        makeFileRecord({ publicUrl: 'https://example.com/file.pdf' }) as never
      );

      const repo = createFileRepository(mockPrisma);
      const file = await repo.create({
        projectId: PROJECT_ID,
        filename: 'test.pdf',
        originalFilename: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        storageProvider: 'local',
        storagePath: 'path/to/file',
        publicUrl: 'https://example.com/file.pdf',
        uploadedBy: 'user_123',
        metadata: { key: 'value' },
      });

      expect(file.publicUrl).toBe('https://example.com/file.pdf');
    });
  });

  describe('findById', () => {
    it('returns file when found', async () => {
      vi.mocked(mockPrisma.file.findUnique).mockResolvedValue(makeFileRecord() as never);

      const repo = createFileRepository(mockPrisma);
      const file = await repo.findById('file_abc');

      expect(file?.id).toBe('file_abc');
      expect(file?.originalFilename).toBe('document.pdf');
    });

    it('returns null when not found', async () => {
      vi.mocked(mockPrisma.file.findUnique).mockResolvedValue(null as never);

      const repo = createFileRepository(mockPrisma);
      const file = await repo.findById('nonexistent');

      expect(file).toBeNull();
    });
  });

  describe('findByProject', () => {
    it('lists files by project', async () => {
      vi.mocked(mockPrisma.file.findMany).mockResolvedValue([
        makeFileRecord(),
        makeFileRecord({ id: 'file_def', originalFilename: 'image.png' }),
      ] as never);

      const repo = createFileRepository(mockPrisma);
      const files = await repo.findByProject(PROJECT_ID);

      expect(files).toHaveLength(2);
      expect(files[0].originalFilename).toBe('document.pdf');
    });

    it('respects limit and offset', async () => {
      vi.mocked(mockPrisma.file.findMany).mockResolvedValue([makeFileRecord()] as never);

      const repo = createFileRepository(mockPrisma);
      await repo.findByProject(PROJECT_ID, { limit: 10, offset: 5 });

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID },
        orderBy: { uploadedAt: 'desc' },
        take: 10,
        skip: 5,
      });
    });
  });

  describe('delete', () => {
    it('deletes a file record', async () => {
      vi.mocked(mockPrisma.file.delete).mockResolvedValue(makeFileRecord() as never);

      const repo = createFileRepository(mockPrisma);
      await repo.delete('file_abc');

      expect(mockPrisma.file.delete).toHaveBeenCalledWith({
        where: { id: 'file_abc' },
      });
    });
  });

  describe('updateMetadata', () => {
    it('updates file metadata', async () => {
      vi.mocked(mockPrisma.file.update).mockResolvedValue(
        makeFileRecord({ metadata: { updated: true } }) as never
      );

      const repo = createFileRepository(mockPrisma);
      const file = await repo.updateMetadata('file_abc', { updated: true });

      expect(file.metadata).toEqual({ updated: true });
      expect(mockPrisma.file.update).toHaveBeenCalledWith({
        where: { id: 'file_abc' },
        data: { metadata: { updated: true } },
      });
    });
  });
});

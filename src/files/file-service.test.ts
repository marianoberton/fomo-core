import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@/observability/logger.js';
import type { ProjectId } from '@/core/types.js';
import type { FileRepository, FileStorage, StoredFile } from './types.js';
import { createFileService } from './file-service.js';

const PROJECT_ID = 'proj_test' as ProjectId;

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createMockStorage(): FileStorage {
  return {
    provider: 'local',
    upload: vi.fn().mockResolvedValue({
      storagePath: 'proj_test/2025/01/01/uuid.pdf',
      publicUrl: 'https://cdn.example.com/uuid.pdf',
    }),
    download: vi.fn().mockResolvedValue(Buffer.from('file content')),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    getSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com'),
  };
}

function createMockRepository(): FileRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByProject: vi.fn(),
    delete: vi.fn(),
    updateMetadata: vi.fn(),
  };
}

function createMockStoredFile(overrides?: Partial<StoredFile>): StoredFile {
  return {
    id: 'file_abc',
    projectId: PROJECT_ID,
    filename: 'uuid.pdf',
    originalFilename: 'document.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 12345,
    storageProvider: 'local',
    storagePath: 'proj_test/2025/01/01/uuid.pdf',
    uploadedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

describe('FileService', () => {
  let logger: Logger;
  let storage: FileStorage;
  let repository: FileRepository;

  beforeEach(() => {
    logger = createMockLogger();
    storage = createMockStorage();
    repository = createMockRepository();
    vi.clearAllMocks();
  });

  describe('upload', () => {
    it('uploads file to storage and creates DB record', async () => {
      const storedFile = createMockStoredFile();
      vi.mocked(repository.create).mockResolvedValue(storedFile);

      const service = createFileService({ storage, repository, logger });
      const result = await service.upload({
        projectId: PROJECT_ID,
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('file content'),
      });

       
      expect(storage.upload).toHaveBeenCalled();
       
      expect(repository.create).toHaveBeenCalled();
      expect(result.id).toBe('file_abc');
       
      expect(logger.info).toHaveBeenCalledTimes(2); // Starting + completed
    });

    it('passes optional fields to repository', async () => {
      const storedFile = createMockStoredFile({ uploadedBy: 'user_123' });
      vi.mocked(repository.create).mockResolvedValue(storedFile);

      const service = createFileService({ storage, repository, logger });
      await service.upload({
        projectId: PROJECT_ID,
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('data'),
        uploadedBy: 'user_123',
        metadata: { source: 'api' },
      });

       
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadedBy: 'user_123',
          metadata: { source: 'api' },
        })
      );
    });
  });

  describe('download', () => {
    it('downloads file from storage', async () => {
      const storedFile = createMockStoredFile();
      vi.mocked(repository.findById).mockResolvedValue(storedFile);
      vi.mocked(storage.download).mockResolvedValue(Buffer.from('file content'));

      const service = createFileService({ storage, repository, logger });
      const { file, content } = await service.download('file_abc');

      expect(file.id).toBe('file_abc');
      expect(content.toString()).toBe('file content');
       
      expect(storage.download).toHaveBeenCalledWith('proj_test/2025/01/01/uuid.pdf');
    });

    it('throws when file not found', async () => {
      vi.mocked(repository.findById).mockResolvedValue(null);

      const service = createFileService({ storage, repository, logger });

      await expect(service.download('nonexistent')).rejects.toThrow('File not found');
    });
  });

  describe('getById', () => {
    it('returns file metadata', async () => {
      const storedFile = createMockStoredFile();
      vi.mocked(repository.findById).mockResolvedValue(storedFile);

      const service = createFileService({ storage, repository, logger });
      const file = await service.getById('file_abc');

      expect(file?.id).toBe('file_abc');
    });

    it('returns null when not found', async () => {
      vi.mocked(repository.findById).mockResolvedValue(null);

      const service = createFileService({ storage, repository, logger });
      const file = await service.getById('nonexistent');

      expect(file).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes from storage and repository', async () => {
      const storedFile = createMockStoredFile();
      vi.mocked(repository.findById).mockResolvedValue(storedFile);

      const service = createFileService({ storage, repository, logger });
      await service.delete('file_abc');

       
      expect(storage.delete).toHaveBeenCalledWith('proj_test/2025/01/01/uuid.pdf');
       
      expect(repository.delete).toHaveBeenCalledWith('file_abc');
       
      expect(logger.info).toHaveBeenCalledTimes(2); // Starting + completed
    });

    it('throws when file not found', async () => {
      vi.mocked(repository.findById).mockResolvedValue(null);

      const service = createFileService({ storage, repository, logger });

      await expect(service.delete('nonexistent')).rejects.toThrow('File not found');
    });
  });

  describe('getTemporaryUrl', () => {
    it('returns public URL if available', async () => {
      const storedFile = createMockStoredFile({ publicUrl: 'https://public.example.com/file.pdf' });
      vi.mocked(repository.findById).mockResolvedValue(storedFile);

      const service = createFileService({ storage, repository, logger });
      const url = await service.getTemporaryUrl('file_abc');

      expect(url).toBe('https://public.example.com/file.pdf');
       
      expect(storage.getSignedUrl).not.toHaveBeenCalled();
    });

    it('returns signed URL when no public URL', async () => {
      const storedFile = createMockStoredFile({ publicUrl: undefined });
      vi.mocked(repository.findById).mockResolvedValue(storedFile);

      const service = createFileService({ storage, repository, logger });
      const url = await service.getTemporaryUrl('file_abc', 7200);

      expect(url).toBe('https://signed-url.example.com');
       
      expect(storage.getSignedUrl).toHaveBeenCalledWith(
        'proj_test/2025/01/01/uuid.pdf',
        7200
      );
    });

    it('returns null when file not found', async () => {
      vi.mocked(repository.findById).mockResolvedValue(null);

      const service = createFileService({ storage, repository, logger });
      const url = await service.getTemporaryUrl('nonexistent');

      expect(url).toBeNull();
    });

    it('returns null when storage does not support signed URLs', async () => {
      const storedFile = createMockStoredFile({ publicUrl: undefined });
      vi.mocked(repository.findById).mockResolvedValue(storedFile);
      
      const storageWithoutSignedUrl: FileStorage = {
        ...storage,
        getSignedUrl: undefined,
      };

      const service = createFileService({ storage: storageWithoutSignedUrl, repository, logger });
      const url = await service.getTemporaryUrl('file_abc');

      expect(url).toBeNull();
    });
  });
});

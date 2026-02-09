/**
 * File Service — combines storage and repository for complete file operations.
 */
import type { Logger } from '@/observability/types.js';
import type {
  FileId,
  FileRepository,
  FileStorage,
  StoredFile,
  UploadFileInput,
} from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface FileServiceDeps {
  storage: FileStorage;
  repository: FileRepository;
  logger: Logger;
}

export interface FileService {
  /** Upload a file (stores in storage + creates DB record) */
  upload(input: UploadFileInput): Promise<StoredFile>;

  /** Download a file by ID */
  download(id: FileId): Promise<{ file: StoredFile; content: Buffer }>;

  /** Get file metadata by ID */
  getById(id: FileId): Promise<StoredFile | null>;

  /** Delete a file (removes from storage + DB) */
  delete(id: FileId): Promise<void>;

  /** Get a temporary URL for accessing a file (if supported) */
  getTemporaryUrl(id: FileId, expiresInSeconds?: number): Promise<string | null>;
}

// ─── Service Factory ────────────────────────────────────────────

/**
 * Create a FileService instance.
 */
export function createFileService(deps: FileServiceDeps): FileService {
  const { storage, repository, logger } = deps;

  return {
    async upload(input: UploadFileInput): Promise<StoredFile> {
      logger.info('Uploading file', {
        component: 'file-service',
        projectId: input.projectId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.content.length,
      });

      // 1. Upload to storage
      const { storagePath, publicUrl } = await storage.upload(input);

      // 2. Create DB record
      const file = await repository.create({
        projectId: input.projectId,
        filename: storagePath.split('/').pop() ?? input.filename,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.content.length,
        storageProvider: storage.provider,
        storagePath,
        publicUrl,
        uploadedBy: input.uploadedBy,
        expiresAt: input.expiresAt,
        metadata: input.metadata,
      });

      logger.info('File uploaded', {
        component: 'file-service',
        fileId: file.id,
        storagePath,
      });

      return file;
    },

    async download(id: FileId): Promise<{ file: StoredFile; content: Buffer }> {
      const file = await repository.findById(id);

      if (!file) {
        throw new Error(`File not found: ${id}`);
      }

      logger.debug('Downloading file', {
        component: 'file-service',
        fileId: id,
        storagePath: file.storagePath,
      });

      const content = await storage.download(file.storagePath);

      return { file, content };
    },

    async getById(id: FileId): Promise<StoredFile | null> {
      return repository.findById(id);
    },

    async delete(id: FileId): Promise<void> {
      const file = await repository.findById(id);

      if (!file) {
        throw new Error(`File not found: ${id}`);
      }

      logger.info('Deleting file', {
        component: 'file-service',
        fileId: id,
        storagePath: file.storagePath,
      });

      // 1. Delete from storage
      await storage.delete(file.storagePath);

      // 2. Delete DB record
      await repository.delete(id);

      logger.info('File deleted', {
        component: 'file-service',
        fileId: id,
      });
    },

    async getTemporaryUrl(id: FileId, expiresInSeconds = 3600): Promise<string | null> {
      const file = await repository.findById(id);

      if (!file) {
        return null;
      }

      // If file has a public URL, return it
      if (file.publicUrl) {
        return file.publicUrl;
      }

      // If storage supports signed URLs, use that
      if (storage.getSignedUrl) {
        return storage.getSignedUrl(file.storagePath, expiresInSeconds);
      }

      return null;
    },
  };
}

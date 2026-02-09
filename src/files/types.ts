import type { ProjectId } from '@/core/types.js';

// ─── File ID ────────────────────────────────────────────────────

export type FileId = string;

// ─── Storage Provider ───────────────────────────────────────────

export type StorageProvider = 'local' | 's3';

// ─── Stored File ────────────────────────────────────────────────

export interface StoredFile {
  id: FileId;
  projectId: ProjectId;

  filename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;

  storageProvider: StorageProvider;
  storagePath: string;

  /** Optional: public URL if accessible */
  publicUrl?: string;

  uploadedBy?: string;
  uploadedAt: Date;
  expiresAt?: Date;

  metadata?: Record<string, unknown>;
}

// ─── Upload Input ───────────────────────────────────────────────

export interface UploadFileInput {
  projectId: ProjectId;
  filename: string;
  mimeType: string;
  content: Buffer;
  uploadedBy?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

// ─── File Repository ────────────────────────────────────────────

export interface FileRepository {
  create(file: Omit<StoredFile, 'id' | 'uploadedAt'>): Promise<StoredFile>;
  findById(id: FileId): Promise<StoredFile | null>;
  findByProject(projectId: ProjectId, options?: { limit?: number; offset?: number }): Promise<StoredFile[]>;
  delete(id: FileId): Promise<void>;
  updateMetadata(id: FileId, metadata: Record<string, unknown>): Promise<StoredFile>;
}

// ─── File Storage Interface ─────────────────────────────────────

export interface FileStorage {
  /** Storage provider type */
  readonly provider: StorageProvider;

  /** Upload a file and return the storage path */
  upload(input: UploadFileInput): Promise<{ storagePath: string; publicUrl?: string }>;

  /** Download a file by storage path */
  download(storagePath: string): Promise<Buffer>;

  /** Delete a file by storage path */
  delete(storagePath: string): Promise<void>;

  /** Get a signed URL for temporary access (if supported) */
  getSignedUrl?(storagePath: string, expiresInSeconds: number): Promise<string>;

  /** Check if a file exists */
  exists(storagePath: string): Promise<boolean>;
}

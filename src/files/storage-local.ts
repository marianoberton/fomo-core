/**
 * Local File Storage — stores files on the local filesystem.
 */
import { mkdir, readFile, writeFile, unlink, access } from 'fs/promises';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type { FileStorage, UploadFileInput } from './types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface LocalStorageConfig {
  /** Base directory for file storage */
  basePath: string;
  /** Optional: base URL for public access */
  baseUrl?: string;
}

// ─── Helper: Generate Storage Path ──────────────────────────────

function generateStoragePath(projectId: string, filename: string): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const uuid = randomUUID();
  
  // Extract extension from filename
  const ext = filename.includes('.') ? filename.split('.').pop() : '';
  const storageName = ext ? `${uuid}.${ext}` : uuid;
  
  // Path: projectId/year/month/day/uuid.ext
  return join(projectId, year.toString(), month, day, storageName);
}

// ─── Storage Factory ────────────────────────────────────────────

/**
 * Create a local file storage instance.
 */
export function createLocalStorage(config: LocalStorageConfig): FileStorage {
  const { basePath, baseUrl } = config;

  return {
    provider: 'local',

    async upload(input: UploadFileInput): Promise<{ storagePath: string; publicUrl?: string }> {
      const storagePath = generateStoragePath(input.projectId, input.filename);
      const fullPath = join(basePath, storagePath);

      // Ensure directory exists
      await mkdir(dirname(fullPath), { recursive: true });

      // Write file
      await writeFile(fullPath, input.content);

      // Generate public URL if base URL is configured
      const publicUrl = baseUrl ? `${baseUrl}/${storagePath}` : undefined;

      return { storagePath, publicUrl };
    },

    async download(storagePath: string): Promise<Buffer> {
      const fullPath = join(basePath, storagePath);
      return readFile(fullPath);
    },

    async delete(storagePath: string): Promise<void> {
      const fullPath = join(basePath, storagePath);
      try {
        await unlink(fullPath);
      } catch (error) {
        // Ignore if file doesn't exist
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    },

    async exists(storagePath: string): Promise<boolean> {
      const fullPath = join(basePath, storagePath);
      try {
        await access(fullPath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

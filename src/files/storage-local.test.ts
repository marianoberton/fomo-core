import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, writeFile, unlink, access } from 'fs/promises';
import { join, dirname } from 'path';
import type { ProjectId } from '@/core/types.js';
import { createLocalStorage } from './storage-local.js';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

describe('LocalStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('upload', () => {
    it('uploads a file to the correct path', async () => {
      const storage = createLocalStorage({ basePath: '/data/files' });

      const result = await storage.upload({
        projectId: 'proj_123' as ProjectId,
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('file content'),
      });

      // storagePath uses forward slashes (platform-independent)
      expect(result.storagePath).toBe('proj_123/2025/06/15/test-uuid-1234.pdf');

      // fullPath uses OS path separators (via path.join)
      const expectedFullPath = join('/data/files', 'proj_123/2025/06/15/test-uuid-1234.pdf');
      expect(mkdir).toHaveBeenCalledWith(dirname(expectedFullPath), { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(expectedFullPath, Buffer.from('file content'));
    });

    it('generates public URL when baseUrl is configured', async () => {
      const storage = createLocalStorage({
        basePath: '/data/files',
        baseUrl: 'https://cdn.example.com/files',
      });

      const result = await storage.upload({
        projectId: 'proj_123' as ProjectId,
        filename: 'image.png',
        mimeType: 'image/png',
        content: Buffer.from('image data'),
      });

      expect(result.publicUrl).toBe('https://cdn.example.com/files/proj_123/2025/06/15/test-uuid-1234.png');
    });

    it('handles files without extension', async () => {
      const storage = createLocalStorage({ basePath: '/data/files' });

      const result = await storage.upload({
        projectId: 'proj_123' as ProjectId,
        filename: 'noextension',
        mimeType: 'application/octet-stream',
        content: Buffer.from('data'),
      });

      expect(result.storagePath).toBe('proj_123/2025/06/15/test-uuid-1234');
    });
  });

  describe('download', () => {
    it('reads file from storage path', async () => {
      const fileContent = Buffer.from('file content');
      vi.mocked(readFile).mockResolvedValue(fileContent);

      const storage = createLocalStorage({ basePath: '/data/files' });
      const content = await storage.download('proj_123/2025/06/15/file.pdf');

      expect(content).toEqual(fileContent);
      expect(readFile).toHaveBeenCalledWith(
        join('/data/files', 'proj_123/2025/06/15/file.pdf'),
      );
    });
  });

  describe('delete', () => {
    it('deletes file from storage', async () => {
      vi.mocked(unlink).mockResolvedValue(undefined);

      const storage = createLocalStorage({ basePath: '/data/files' });
      await storage.delete('proj_123/2025/06/15/file.pdf');

      expect(unlink).toHaveBeenCalledWith(
        join('/data/files', 'proj_123/2025/06/15/file.pdf'),
      );
    });

    it('ignores ENOENT error', async () => {
      const error = new Error('File not found') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      vi.mocked(unlink).mockRejectedValue(error);

      const storage = createLocalStorage({ basePath: '/data/files' });

      // Should not throw
      await expect(storage.delete('nonexistent')).resolves.toBeUndefined();
    });

    it('rethrows other errors', async () => {
      const error = new Error('Permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      vi.mocked(unlink).mockRejectedValue(error);

      const storage = createLocalStorage({ basePath: '/data/files' });

      await expect(storage.delete('somefile')).rejects.toThrow('Permission denied');
    });
  });

  describe('exists', () => {
    it('returns true when file exists', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const storage = createLocalStorage({ basePath: '/data/files' });
      const exists = await storage.exists('proj_123/file.pdf');

      expect(exists).toBe(true);
      expect(access).toHaveBeenCalledWith(
        join('/data/files', 'proj_123/file.pdf'),
      );
    });

    it('returns false when file does not exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const storage = createLocalStorage({ basePath: '/data/files' });
      const exists = await storage.exists('nonexistent');

      expect(exists).toBe(false);
    });
  });

  describe('provider', () => {
    it('returns local as provider type', () => {
      const storage = createLocalStorage({ basePath: '/data' });
      expect(storage.provider).toBe('local');
    });
  });
});

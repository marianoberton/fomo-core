/**
 * Tests for the read-file tool.
 * 3 levels: schema validation, dry-run, execution (with mocked file service).
 */
import { describe, it, expect, vi } from 'vitest';
import { createReadFileTool } from './read-file.js';
import { createTestContext } from '@/testing/fixtures/context.js';
import type { FileService } from '@/files/file-service.js';
import type { StoredFile } from '@/files/types.js';
import type { ProjectId } from '@/core/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeStoredFile(overrides?: Partial<StoredFile>): StoredFile {
  return {
    id: 'file-1',
    projectId: 'test-project' as ProjectId,
    filename: 'test.csv',
    originalFilename: 'test.csv',
    mimeType: 'text/csv',
    sizeBytes: 100,
    storageProvider: 'local',
    storagePath: 'projects/test-project/files/test.csv',
    uploadedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function createMockFileService(overrides?: Partial<FileService>): FileService {
  return {
    upload: vi.fn(),
    download: vi.fn(() => Promise.resolve({
      file: makeStoredFile(),
      content: Buffer.from('name,age\nAlice,30\nBob,25'),
    })),
    getById: vi.fn(() => Promise.resolve(makeStoredFile())),
    delete: vi.fn(),
    getTemporaryUrl: vi.fn(() => Promise.resolve(null)),
    listByProject: vi.fn(() => Promise.resolve([])),
    ...overrides,
  };
}

const context = createTestContext({ allowedTools: ['read-file'] });

// ─── Tests ──────────────────────────────────────────────────────

describe('read-file tool', () => {
  // ─── Level 1: Schema Validation ─────────────────────────────

  describe('schema validation', () => {
    const tool = createReadFileTool({
      fileService: createMockFileService(),
    });

    it('accepts valid fileId', () => {
      const result = tool.inputSchema.safeParse({ fileId: 'file-123' });
      expect(result.success).toBe(true);
    });

    it('accepts fileId with extractionMode', () => {
      const result = tool.inputSchema.safeParse({
        fileId: 'file-123',
        extractionMode: 'structured',
      });
      expect(result.success).toBe(true);
    });

    it('defaults extractionMode to text', () => {
      const result = tool.inputSchema.safeParse({ fileId: 'file-123' });
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as { extractionMode: string };
        expect(data.extractionMode).toBe('text');
      }
    });

    it('rejects empty fileId', () => {
      const result = tool.inputSchema.safeParse({ fileId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing fileId', () => {
      const result = tool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects invalid extractionMode', () => {
      const result = tool.inputSchema.safeParse({
        fileId: 'file-123',
        extractionMode: 'binary',
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Level 2: Dry Run ──────────────────────────────────────

  describe('dry run', () => {
    it('returns file metadata when file exists', async () => {
      const tool = createReadFileTool({
        fileService: createMockFileService(),
      });

      const result = await tool.dryRun({ fileId: 'file-1' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as Record<string, unknown>;
        expect(output['dryRun']).toBe(true);
        expect(output['filename']).toBe('test.csv');
        expect(output['mimeType']).toBe('text/csv');
        expect(output['supported']).toBe(true);
        expect(output['withinSizeLimit']).toBe(true);
      }
    });

    it('returns error when file not found', async () => {
      const tool = createReadFileTool({
        fileService: createMockFileService({
          getById: vi.fn(() => Promise.resolve(null)),
        }),
      });

      const result = await tool.dryRun({ fileId: 'nonexistent' }, context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('File not found');
      }
    });

    it('indicates unsupported mime type', async () => {
      const tool = createReadFileTool({
        fileService: createMockFileService({
          getById: vi.fn(() => Promise.resolve(makeStoredFile({
            mimeType: 'image/png',
          }))),
        }),
      });

      const result = await tool.dryRun({ fileId: 'file-1' }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['supported']).toBe(false);
      }
    });
  });

  // ─── Level 3: Execution ────────────────────────────────────

  describe('execution', () => {
    it('reads CSV file as text', async () => {
      const csvContent = 'name,age\nAlice,30\nBob,25';
      const tool = createReadFileTool({
        fileService: createMockFileService({
          download: vi.fn(() => Promise.resolve({
            file: makeStoredFile({ mimeType: 'text/csv' }),
            content: Buffer.from(csvContent),
          })),
        }),
      });

      const result = await tool.execute({
        fileId: 'file-1',
        extractionMode: 'text',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { content: string; mimeType: string };
        expect(output.content).toBe(csvContent);
        expect(output.mimeType).toBe('text/csv');
      }
    });

    it('reads CSV file as structured data', async () => {
      const csvContent = 'name,age\nAlice,30\nBob,25';
      const tool = createReadFileTool({
        fileService: createMockFileService({
          download: vi.fn(() => Promise.resolve({
            file: makeStoredFile({ mimeType: 'text/csv' }),
            content: Buffer.from(csvContent),
          })),
        }),
      });

      const result = await tool.execute({
        fileId: 'file-1',
        extractionMode: 'structured',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { content: Record<string, string>[] };
        expect(output.content).toEqual([
          { name: 'Alice', age: '30' },
          { name: 'Bob', age: '25' },
        ]);
      }
    });

    it('reads JSON file as structured data', async () => {
      const jsonContent = JSON.stringify({ users: [{ name: 'Alice' }] });
      const tool = createReadFileTool({
        fileService: createMockFileService({
          download: vi.fn(() => Promise.resolve({
            file: makeStoredFile({ mimeType: 'application/json', originalFilename: 'data.json' }),
            content: Buffer.from(jsonContent),
          })),
        }),
      });

      const result = await tool.execute({
        fileId: 'file-1',
        extractionMode: 'structured',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { content: { users: unknown[] } };
        expect(output.content.users).toHaveLength(1);
      }
    });

    it('reads plain text file', async () => {
      const textContent = 'Hello, world!';
      const tool = createReadFileTool({
        fileService: createMockFileService({
          download: vi.fn(() => Promise.resolve({
            file: makeStoredFile({ mimeType: 'text/plain', originalFilename: 'readme.txt' }),
            content: Buffer.from(textContent),
          })),
        }),
      });

      const result = await tool.execute({ fileId: 'file-1' }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { content: string };
        expect(output.content).toBe(textContent);
      }
    });

    it('rejects files exceeding size limit', async () => {
      const tool = createReadFileTool({
        fileService: createMockFileService({
          download: vi.fn(() => Promise.resolve({
            file: makeStoredFile({ sizeBytes: 10 * 1024 * 1024 }),
            content: Buffer.alloc(10 * 1024 * 1024),
          })),
        }),
      });

      const result = await tool.execute({ fileId: 'file-1' }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('File too large');
      }
    });

    it('rejects unsupported MIME types', async () => {
      const tool = createReadFileTool({
        fileService: createMockFileService({
          download: vi.fn(() => Promise.resolve({
            file: makeStoredFile({ mimeType: 'image/png' }),
            content: Buffer.from('png data'),
          })),
        }),
      });

      const result = await tool.execute({ fileId: 'file-1' }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Unsupported file type');
      }
    });

    it('returns error when file not found', async () => {
      const tool = createReadFileTool({
        fileService: createMockFileService({
          download: vi.fn(() => Promise.reject(new Error('File not found: bad-id'))),
        }),
      });

      const result = await tool.execute({ fileId: 'bad-id' }, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('File not found');
      }
    });

    it('handles CSV with quoted fields', async () => {
      const csvContent = 'name,description\n"Alice","Has a, comma"\n"Bob","Normal"';
      const tool = createReadFileTool({
        fileService: createMockFileService({
          download: vi.fn(() => Promise.resolve({
            file: makeStoredFile({ mimeType: 'text/csv' }),
            content: Buffer.from(csvContent),
          })),
        }),
      });

      const result = await tool.execute({
        fileId: 'file-1',
        extractionMode: 'structured',
      }, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as { content: Record<string, string>[] };
        expect(output.content).toEqual([
          { name: 'Alice', description: 'Has a, comma' },
          { name: 'Bob', description: 'Normal' },
        ]);
      }
    });

    it('has correct risk level and approval settings', () => {
      const tool = createReadFileTool({
        fileService: createMockFileService(),
      });

      expect(tool.riskLevel).toBe('low');
      expect(tool.requiresApproval).toBe(false);
      expect(tool.sideEffects).toBe(false);
    });
  });
});

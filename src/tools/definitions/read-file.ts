/**
 * Read File Tool — parses uploaded files (CSV, JSON, plain text, PDF).
 * Retrieves files via the FileService and extracts text or structured data.
 */
import { z } from 'zod';
import type { ExecutionContext, ProjectId } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { FileService } from '@/files/file-service.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'read-file' });

// ─── Constants ──────────────────────────────────────────────────

/** Maximum file size for processing (5 MB). */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Supported MIME types. */
const SUPPORTED_MIME_TYPES = [
  'text/plain',
  'text/csv',
  'application/json',
  'application/pdf',
] as const;

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  fileId: z.string().min(1).optional()
    .describe('ID of the uploaded file (use this when you know the file ID)'),
  filename: z.string().min(1).optional()
    .describe('Original filename to look up by name, e.g. "lista-precios.txt" (use when fileId is not known)'),
  extractionMode: z.enum(['text', 'structured']).default('text')
    .describe('Extraction mode: "text" returns raw text, "structured" returns parsed data (JSON objects, CSV rows)'),
}).refine(
  (data) => data.fileId !== undefined || data.filename !== undefined,
  { message: 'Either fileId or filename must be provided' },
);

const outputSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  content: z.unknown(),
});

// ─── Options ────────────────────────────────────────────────────

export interface ReadFileToolOptions {
  fileService: FileService;
}

// ─── Parsers ────────────────────────────────────────────────────

/** Parse CSV content into rows of objects. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  // Parse header
  const headers = splitCsvLine(lines[0] ?? '');
  if (headers.length === 0) return [];

  // Parse data rows
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i] ?? '');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j] ?? `column_${j}`;
      row[header] = values[j] ?? '';
    }
    rows.push(row);
  }

  return rows;
}

/** Split a CSV line respecting quoted fields. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line.charAt(i);

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line.charAt(i + 1) === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a read-file tool that parses uploaded files. */
export function createReadFileTool(options: ReadFileToolOptions): ExecutableTool {
  const { fileService } = options;

  async function extractContent(
    buffer: Buffer,
    mimeType: string,
    mode: 'text' | 'structured',
  ): Promise<unknown> {
    const text = buffer.toString('utf-8');

    switch (mimeType) {
      case 'text/plain':
        return text;

      case 'text/csv':
        if (mode === 'structured') {
          return parseCsv(text);
        }
        return text;

      case 'application/json': {
        if (mode === 'structured') {
          return JSON.parse(text) as unknown;
        }
        return text;
      }

      case 'application/pdf': {
        const { PDFParse } = await import('pdf-parse');
        const pdf = new PDFParse({ data: new Uint8Array(buffer) });
        const textResult = await pdf.getText();
        await pdf.destroy();
        if (mode === 'structured') {
          return { text: textResult.text, pages: textResult.total };
        }
        return textResult.text;
      }

      default:
        // Attempt to read as plain text
        return text;
    }
  }

  return {
    id: 'read-file',
    name: 'Read File',
    description: 'Reads and parses an uploaded file. Supports CSV, JSON, plain text, and PDF formats. Returns extracted text or structured data (JSON objects, CSV rows). You can identify the file by fileId or by its original filename (e.g. "lista-precios.txt").',
    category: 'data',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        // Resolve fileId — either directly provided or looked up by filename
        let resolvedFileId = parsed.fileId;

        if (!resolvedFileId && parsed.filename) {
          const files = await fileService.listByProject(context.projectId as ProjectId);
          const match = files.find(
            (f) => f.originalFilename.toLowerCase() === parsed.filename!.toLowerCase(),
          );
          if (!match) {
            const available = files.map((f) => f.originalFilename).join(', ');
            return err(new ToolExecutionError(
              'read-file',
              `File "${parsed.filename}" not found in project.${available ? ` Available files: ${available}` : ''}`,
            ));
          }
          resolvedFileId = match.id;
        }

        // Download file via FileService
        const { file, content } = await fileService.download(resolvedFileId!);

        // Validate file size
        if (file.sizeBytes > MAX_FILE_SIZE) {
          return err(new ToolExecutionError(
            'read-file',
            `File too large: ${file.sizeBytes} bytes (max ${MAX_FILE_SIZE} bytes)`,
          ));
        }

        // Validate MIME type
        const supportedTypes: readonly string[] = SUPPORTED_MIME_TYPES;
        if (!supportedTypes.includes(file.mimeType)) {
          return err(new ToolExecutionError(
            'read-file',
            `Unsupported file type: ${file.mimeType}. Supported: ${SUPPORTED_MIME_TYPES.join(', ')}`,
          ));
        }

        // Extract content
        const extracted = await extractContent(content, file.mimeType, parsed.extractionMode);

        logger.info('File read completed', {
          component: 'read-file',
          projectId: context.projectId,
          traceId: context.traceId,
          fileId: parsed.fileId,
          filename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          extractionMode: parsed.extractionMode,
        });

        return ok({
          success: true,
          output: {
            filename: file.originalFilename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            content: extracted,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return err(error);
        }
        const message = error instanceof Error ? error.message : String(error);
        return err(new ToolExecutionError('read-file', message));
      }
    },

    async dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.parse(input);

      try {
        // Resolve file — by fileId or by filename lookup
        let file = parsed.fileId ? await fileService.getById(parsed.fileId) : null;

        if (!file && parsed.filename) {
          const files = await fileService.listByProject(context.projectId as ProjectId);
          file = files.find(
            (f) => f.originalFilename.toLowerCase() === parsed.filename!.toLowerCase(),
          ) ?? null;
        }

        if (!file) {
          return await Promise.resolve(err(new ToolExecutionError(
            'read-file',
            `File not found: ${parsed.fileId}`,
          )));
        }

        const supportedTypes: readonly string[] = SUPPORTED_MIME_TYPES;

        return await Promise.resolve(ok({
          success: true,
          output: {
            dryRun: true,
            fileId: parsed.fileId,
            filename: file.originalFilename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            extractionMode: parsed.extractionMode,
            supported: supportedTypes.includes(file.mimeType),
            withinSizeLimit: file.sizeBytes <= MAX_FILE_SIZE,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return await Promise.resolve(err(new ToolExecutionError('read-file', message)));
      }
    },
  };
}

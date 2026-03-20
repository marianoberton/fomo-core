/**
 * Excel Analyze Tool — parses and analyzes Excel files (.xlsx/.xls), even messy ones.
 * Handles merged cells, multi-row headers, empty rows/columns, and multiple sheets.
 * Returns structured data + column stats for LLM analysis.
 */
import { z } from 'zod';
import * as XLSX from 'xlsx';
import type { ExecutionContext, ProjectId } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { FileService } from '@/files/file-service.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'excel-analyze' });

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS_RETURNED = 500;           // cap for LLM context
const MAX_COLS = 50;

// ─── Schema ─────────────────────────────────────────────────────

const inputSchema = z.object({
  fileId: z.string().min(1).optional()
    .describe('ID of the uploaded Excel file'),
  filename: z.string().min(1).optional()
    .describe('Original filename, e.g. "ventas-2024.xlsx"'),
  sheetName: z.string().optional()
    .describe('Specific sheet to analyze. Defaults to first sheet.'),
  headerRowHint: z.number().int().min(0).optional()
    .describe('Zero-based row index where headers are (if known). If omitted, auto-detected.'),
}).refine(
  (d) => d.fileId !== undefined || d.filename !== undefined,
  { message: 'Either fileId or filename must be provided' },
);

// ─── Helpers ────────────────────────────────────────────────────

type CellValue = string | number | boolean | null;

/** Convert XLSX sheet to a 2D array, expanding merged cells. */
function sheetTo2D(sheet: XLSX.WorkSheet): CellValue[][] {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1');
  const rows: CellValue[][] = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: CellValue[] = [];
    for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + MAX_COLS - 1); c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr] as XLSX.CellObject | undefined;
      if (cell?.v === undefined) {
        row.push(null);
      } else {
        const v = cell.v;
        if (typeof v === 'string') row.push(v.trim());
        else if (typeof v === 'number' || typeof v === 'boolean') row.push(v);
        else row.push(String(v));
      }
    }
    rows.push(row);
  }

  // Expand merged cells (propagate top-left value)
  const merges = sheet['!merges'] ?? [];
  for (const merge of merges) {
    const topLeft = rows[merge.s.r]?.[merge.s.c] ?? null;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (r !== merge.s.r || c !== merge.s.c) {
          if (rows[r]) rows[r]![c] = topLeft;
        }
      }
    }
  }

  return rows;
}

/** Score a row as a likely header row (0–1). Higher = more likely a header. */
function headerScore(row: CellValue[]): number {
  const nonNull = row.filter((v) => v !== null && v !== '');
  if (nonNull.length === 0) return 0;
  const stringRatio = nonNull.filter((v) => typeof v === 'string').length / nonNull.length;
  const fillRatio = nonNull.length / row.length;
  return stringRatio * 0.7 + fillRatio * 0.3;
}

/** Auto-detect the header row index. */
function detectHeaderRow(rows: CellValue[][], hint?: number): number {
  if (hint !== undefined) return hint;
  // Try first 10 rows, pick highest scoring non-empty row
  let bestScore = -1;
  let bestIdx = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const score = headerScore(row);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Compute basic stats for a column. */
function columnStats(values: CellValue[]): {
  type: 'number' | 'text' | 'mixed' | 'empty';
  nonNull: number;
  min?: number;
  max?: number;
  sum?: number;
  sample: CellValue[];
} {
  const nonNullVals = values.filter((v) => v !== null && v !== '');
  if (nonNullVals.length === 0) return { type: 'empty', nonNull: 0, sample: [] };

  const nums = nonNullVals.filter((v) => typeof v === 'number');
  const strs = nonNullVals.filter((v) => typeof v === 'string');

  let type: 'number' | 'text' | 'mixed' | 'empty' = 'mixed';
  if (nums.length === nonNullVals.length) type = 'number';
  else if (strs.length === nonNullVals.length) type = 'text';

  const sample = nonNullVals.slice(0, 3);

  if (type === 'number') {
    return {
      type,
      nonNull: nonNullVals.length,
      min: Math.min(...nums),
      max: Math.max(...nums),
      sum: nums.reduce((a, b) => a + b, 0),
      sample,
    };
  }

  return { type, nonNull: nonNullVals.length, sample };
}

// ─── Options ────────────────────────────────────────────────────

export interface ExcelAnalyzeToolOptions {
  fileService: FileService;
}

// ─── Factory ────────────────────────────────────────────────────

export function createExcelAnalyzeTool(options: ExcelAnalyzeToolOptions): ExecutableTool {
  const { fileService } = options;

  return {
    id: 'excel-analyze',
    name: 'Excel Analyze',
    description: `Parses and analyzes an Excel file uploaded by the user (.xlsx or .xls). 
Handles messy files: merged cells, multi-row headers, empty rows/columns.
Returns: list of sheets, column names, column stats (type, min, max, sum), and up to ${MAX_ROWS_RETURNED} rows of clean data.
Use this as the first step when a user uploads a spreadsheet — then analyze the output to generate insights, summaries, and recommendations.`,
    category: 'data',
    inputSchema,
    outputSchema: z.object({
      filename: z.string(),
      sheets: z.array(z.string()),
      analyzedSheet: z.string(),
      headerRowIndex: z.number(),
      totalRows: z.number(),
      columns: z.array(z.object({
        name: z.string(),
        stats: z.any(),
      })),
      rows: z.array(z.record(z.any())),
      truncated: z.boolean(),
    }),
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: false,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        // Resolve file
        let resolvedFileId = parsed.fileId;
        if (!resolvedFileId && parsed.filename) {
          const files = await fileService.listByProject(context.projectId);
          const match = files.find(
            (f) => f.originalFilename.toLowerCase() === parsed.filename!.toLowerCase(),
          );
          if (!match) {
            const available = files.map((f) => f.originalFilename).join(', ');
            return err(new ToolExecutionError(
              'excel-analyze',
              `File "${parsed.filename}" not found.${available ? ` Available: ${available}` : ''}`,
            ));
          }
          resolvedFileId = match.id;
        }

        const { file, content } = await fileService.download(resolvedFileId!);

        if (file.sizeBytes > MAX_FILE_SIZE) {
          return err(new ToolExecutionError(
            'excel-analyze',
            `File too large: ${file.sizeBytes} bytes (max ${MAX_FILE_SIZE})`,
          ));
        }

        // Parse workbook
        const workbook = XLSX.read(content, {
          type: 'buffer',
          cellDates: true,
          cellNF: false,
          cellText: false,
        });

        const sheets = workbook.SheetNames;
        if (sheets.length === 0) {
          return err(new ToolExecutionError('excel-analyze', 'Excel file has no sheets'));
        }

        const targetSheet = parsed.sheetName
          ? sheets.find((s) => s.toLowerCase() === parsed.sheetName!.toLowerCase()) ?? sheets[0]!
          : sheets[0]!;

        const sheet = workbook.Sheets[targetSheet];
        if (!sheet) {
          return err(new ToolExecutionError('excel-analyze', `Sheet "${targetSheet}" not found`));
        }

        // Convert to 2D array (with merged cell expansion)
        const raw2D = sheetTo2D(sheet);

        // Filter completely empty rows
        const nonEmptyRows = raw2D.filter((r) => r.some((v) => v !== null && v !== ''));
        if (nonEmptyRows.length === 0) {
          return err(new ToolExecutionError('excel-analyze', 'Sheet appears to be empty'));
        }

        // Detect headers
        const headerIdx = detectHeaderRow(nonEmptyRows, parsed.headerRowHint);
        const headerRow = nonEmptyRows[headerIdx] ?? [];

        // Build column names (handle duplicates and nulls)
        const colNames: string[] = [];
        const nameCounts: Record<string, number> = {};
        for (let c = 0; c < headerRow.length; c++) {
          let name = headerRow[c] !== null && headerRow[c] !== '' 
            ? String(headerRow[c]) 
            : `Columna_${c + 1}`;
          if (nameCounts[name]) {
            name = `${name}_${nameCounts[name]}`;
          }
          nameCounts[name] = (nameCounts[name] ?? 0) + 1;
          colNames.push(name);
        }

        // Data rows (after header)
        const dataRows = nonEmptyRows.slice(headerIdx + 1).filter(
          (r) => r.some((v) => v !== null && v !== ''),
        );

        const totalRows = dataRows.length;
        const truncated = totalRows > MAX_ROWS_RETURNED;
        const limitedRows = dataRows.slice(0, MAX_ROWS_RETURNED);

        // Build records
        const records: Record<string, CellValue>[] = limitedRows.map((row) => {
          const record: Record<string, CellValue> = {};
          for (let c = 0; c < colNames.length; c++) {
            record[colNames[c]!] = row[c] ?? null;
          }
          return record;
        });

        // Column stats
        const columns = colNames.map((name, c) => {
          const vals = dataRows.map((r) => r[c] ?? null);
          return { name, stats: columnStats(vals) };
        }).filter((col) => col.stats.type !== 'empty');

        logger.info('Excel analyzed', {
          component: 'excel-analyze',
          projectId: context.projectId,
          filename: file.originalFilename,
          sheet: targetSheet,
          totalRows,
          columns: columns.length,
        });

        return ok({
          success: true,
          output: {
            filename: file.originalFilename,
            sheets,
            analyzedSheet: targetSheet,
            headerRowIndex: headerIdx,
            totalRows,
            columns,
            rows: records,
            truncated,
          },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(new ToolExecutionError('excel-analyze', message));
      }
    },

    async dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.parse(input);
      return Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          fileId: parsed.fileId,
          filename: parsed.filename,
          note: 'Would parse Excel file and return columns + data rows',
        },
        durationMs: 0,
      }));
    },
  };
}

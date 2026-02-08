import { describe, it, expect } from 'vitest';
import { scaffoldTool } from './scaffold.js';
import type { ToolScaffoldInput } from './scaffold.js';

const defaultInput: ToolScaffoldInput = {
  id: 'send-email',
  name: 'Send Email',
  description: 'Sends an email via SMTP.',
  category: 'communication',
  riskLevel: 'high',
  requiresApproval: true,
  sideEffects: true,
};

describe('scaffoldTool', () => {
  // ─── Implementation File ──────────────────────────────────────

  describe('implementationContent', () => {
    it('contains the factory function with correct name', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).toContain('export function createSendEmailTool(');
    });

    it('contains the options interface', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).toContain('export interface SendEmailToolOptions');
    });

    it('contains the tool ID', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).toContain("id: 'send-email'");
    });

    it('contains the tool name', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).toContain("name: 'Send Email'");
    });

    it('contains the risk level', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).toContain("riskLevel: 'high'");
    });

    it('sets requiresApproval correctly', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).toContain('requiresApproval: true');
    });

    it('sets sideEffects correctly', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).toContain('sideEffects: true');
    });

    it('does not contain any type', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).not.toMatch(/:\s*any\b/);
    });

    it('contains Zod input and output schemas', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).toContain('const inputSchema = z.object(');
      expect(result.implementationContent).toContain('const outputSchema = z.object(');
    });

    it('contains both execute and dryRun methods', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).toContain('execute(');
      expect(result.implementationContent).toContain('dryRun(');
    });

    it('uses .js extensions in relative/aliased imports', () => {
      const result = scaffoldTool(defaultInput);
      const importLines = result.implementationContent
        .split('\n')
        .filter((line) => line.startsWith('import') && line.includes('from'));
      // Only check relative (./) or aliased (@/) imports, not package imports
      const localImports = importLines.filter(
        (line) => line.includes("'@/") || line.includes("'./"),
      );
      expect(localImports.length).toBeGreaterThan(0);
      for (const line of localImports) {
        expect(line).toMatch(/\.js['"]/);
      }
    });

    it('imports from core paths correctly', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.implementationContent).toContain("from '@/core/types.js'");
      expect(result.implementationContent).toContain("from '@/core/result.js'");
      expect(result.implementationContent).toContain("from '@/core/errors.js'");
      expect(result.implementationContent).toContain("from '@/tools/types.js'");
    });
  });

  // ─── Test File ────────────────────────────────────────────────

  describe('testContent', () => {
    it('imports the factory function', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.testContent).toContain("import { createSendEmailTool } from './send-email.js'");
    });

    it('contains all 3 test levels', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.testContent).toContain("describe('schema validation'");
      expect(result.testContent).toContain("describe('dryRun'");
      expect(result.testContent).toContain("describe('execute'");
    });

    it('has schema validation tests', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.testContent).toContain('rejects empty input');
      expect(result.testContent).toContain('accepts valid input');
    });

    it('has dry run test', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.testContent).toContain('returns valid result without side effects');
    });

    it('has execute tests', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.testContent).toContain('executes successfully');
      expect(result.testContent).toContain('rejects invalid input');
    });

    it('does not contain any type', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.testContent).not.toMatch(/:\s*any\b/);
    });

    it('uses .js extensions in relative/aliased imports', () => {
      const result = scaffoldTool(defaultInput);
      const importLines = result.testContent
        .split('\n')
        .filter((line) => line.startsWith('import') && line.includes('from'));
      const localImports = importLines.filter(
        (line) => line.includes("'@/") || line.includes("'./"),
      );
      expect(localImports.length).toBeGreaterThan(0);
      for (const line of localImports) {
        expect(line).toMatch(/\.js['"]/);
      }
    });
  });

  // ─── Registration Line ────────────────────────────────────────

  describe('registrationLine', () => {
    it('exports the factory function', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.registrationLine).toContain("export { createSendEmailTool } from './send-email.js'");
    });

    it('exports the options type', () => {
      const result = scaffoldTool(defaultInput);
      expect(result.registrationLine).toContain("export type { SendEmailToolOptions } from './send-email.js'");
    });
  });

  // ─── Different Inputs ─────────────────────────────────────────

  describe('handles different tool configurations', () => {
    it('handles low risk tool with no approval', () => {
      const result = scaffoldTool({
        ...defaultInput,
        id: 'simple-calc',
        name: 'Simple Calc',
        riskLevel: 'low',
        requiresApproval: false,
        sideEffects: false,
      });
      expect(result.implementationContent).toContain("riskLevel: 'low'");
      expect(result.implementationContent).toContain('requiresApproval: false');
      expect(result.implementationContent).toContain('sideEffects: false');
      expect(result.implementationContent).toContain('export function createSimpleCalcTool(');
    });

    it('handles multi-word kebab-case IDs', () => {
      const result = scaffoldTool({
        ...defaultInput,
        id: 'fetch-weather-data',
        name: 'Fetch Weather Data',
      });
      expect(result.implementationContent).toContain('export function createFetchWeatherDataTool(');
      expect(result.implementationContent).toContain('export interface FetchWeatherDataToolOptions');
      expect(result.testContent).toContain("import { createFetchWeatherDataTool } from './fetch-weather-data.js'");
    });
  });
});

/**
 * Hotel Detect Language Tool Tests
 */
import { describe, it, expect } from 'vitest';
import { createHotelDetectLanguageTool } from './hotel-detect-language.js';
import type { ExecutionContext } from '@/core/types.js';
import type { ProjectId, SessionId, TraceId } from '@/core/types.js';

describe('hotel-detect-language tool', () => {
  const mockContext: ExecutionContext = {
    projectId: 'test-project' as ProjectId,
    sessionId: 'test-session' as SessionId,
    traceId: 'test-trace' as TraceId,
    agentConfig: {} as ExecutionContext['agentConfig'],
    permissions: { allowedTools: new Set(['hotel-detect-language']) },
    abortSignal: new AbortController().signal,
  };

  describe('schema validation', () => {
    it('validates valid input', () => {
      const tool = createHotelDetectLanguageTool();
      const result = tool.inputSchema.safeParse({
        contactId: 'contact-123',
        text: 'Hello, I would like to book a room',
      });
      expect(result.success).toBe(true);
    });

    it('accepts forceLanguage', () => {
      const tool = createHotelDetectLanguageTool();
      const result = tool.inputSchema.safeParse({
        contactId: 'contact-123',
        text: 'any text',
        forceLanguage: 'en',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('dryRun', () => {
    it('detects English', async () => {
      const tool = createHotelDetectLanguageTool();
      const result = await tool.dryRun({
        contactId: 'contact-123',
        text: 'Hello, I would like to book a room please',
      }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['success']).toBe(true);
        expect(output['language']).toBe('en');
        expect(output['instructions']).toBeTruthy();
      }
    });

    it('detects Spanish', async () => {
      const tool = createHotelDetectLanguageTool();
      const result = await tool.dryRun({
        contactId: 'contact-123',
        text: 'Hola, quisiera reservar una habitación',
      }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['success']).toBe(true);
        expect(output['language']).toBe('es');
      }
    });

    it('uses forced language', async () => {
      const tool = createHotelDetectLanguageTool();
      const result = await tool.dryRun({
        contactId: 'contact-123',
        text: 'any text',
        forceLanguage: 'fr',
      }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['success']).toBe(true);
        expect(output['language']).toBe('fr');
        expect(output['confidence']).toBe('high');
      }
    });

    it('rejects invalid input', async () => {
      const tool = createHotelDetectLanguageTool();
      const result = await tool.dryRun({}, mockContext);

      expect(result.ok).toBe(false);
    });
  });

  describe('tool properties', () => {
    it('has correct metadata', () => {
      const tool = createHotelDetectLanguageTool();
      expect(tool.id).toBe('hotel-detect-language');
      expect(tool.riskLevel).toBe('low');
      expect(tool.category).toBe('hotels');
    });
  });
});

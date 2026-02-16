/**
 * Vehicle Lead Score Tool Tests
 */
import { describe, it, expect } from 'vitest';
import { createVehicleLeadScoreTool } from './vehicle-lead-score.js';
import type { ExecutionContext } from '@/core/types.js';
import type { ProjectId, SessionId, TraceId } from '@/core/types.js';

describe('vehicle-lead-score tool', () => {
  const mockContext: ExecutionContext = {
    projectId: 'test-project' as ProjectId,
    sessionId: 'test-session' as SessionId,
    traceId: 'test-trace' as TraceId,
    agentConfig: {} as ExecutionContext['agentConfig'],
    permissions: { allowedTools: new Set(['vehicle-lead-score']) },
    abortSignal: new AbortController().signal,
  };

  describe('schema validation', () => {
    it('validates valid input', () => {
      const tool = createVehicleLeadScoreTool();
      const result = tool.inputSchema.safeParse({
        contactId: 'contact-123',
        urgency: 'urgent',
        budgetRange: 'high',
        vehicleType: 'sedan',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid urgency', () => {
      const tool = createVehicleLeadScoreTool();
      const result = tool.inputSchema.safeParse({
        contactId: 'contact-123',
        urgency: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('requires contactId', () => {
      const tool = createVehicleLeadScoreTool();
      const result = tool.inputSchema.safeParse({
        urgency: 'urgent',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dryRun', () => {
    it('calculates score without database access', async () => {
      const tool = createVehicleLeadScoreTool();
      const result = await tool.dryRun({
        contactId: 'contact-123',
        urgency: 'urgent',
        budgetRange: 'premium',
        vehicleType: 'sports',
      }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['success']).toBe(true);
        expect(output['score']).toBeGreaterThan(0);
        expect(output['tier']).toBe('urgent');
        expect(output['suggestedActions']).toBeDefined();
        expect((output['suggestedActions'] as string[]).length).toBeGreaterThan(0);
      }
    });

    it('handles minimal input', async () => {
      const tool = createVehicleLeadScoreTool();
      const result = await tool.dryRun({
        contactId: 'contact-123',
        urgency: 'browsing',
      }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['success']).toBe(true);
        expect(output['tier']).toBe('cold');
      }
    });

    it('rejects invalid input', async () => {
      const tool = createVehicleLeadScoreTool();
      const result = await tool.dryRun({}, mockContext);

      expect(result.ok).toBe(false);
    });
  });

  describe('tool properties', () => {
    it('has correct metadata', () => {
      const tool = createVehicleLeadScoreTool();
      expect(tool.id).toBe('vehicle-lead-score');
      expect(tool.riskLevel).toBe('low');
      expect(tool.requiresApproval).toBe(false);
      expect(tool.category).toBe('vehicles');
    });

    it('has input and output schemas', () => {
      const tool = createVehicleLeadScoreTool();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    });
  });
});

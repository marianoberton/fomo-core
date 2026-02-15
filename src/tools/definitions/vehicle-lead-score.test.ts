import { describe, it, expect, beforeEach, vi } from 'vitest';
import { vehicleLeadScoreTool } from './vehicle-lead-score.js';
import type { ExecutionContext } from '../../core/types.js';

describe('Vehicle Lead Score Tool', () => {
  let mockContext: ExecutionContext;

  beforeEach(() => {
    mockContext = {
      projectId: 'test-project',
      sessionId: 'test-session',
      userId: 'test-user',
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
    } as unknown as ExecutionContext;
  });

  describe('Schema Validation', () => {
    it('should validate valid input', () => {
      const input = {
        contactId: 'contact-123',
        urgency: 'urgent',
        budgetRange: 'high',
        vehicleType: 'sedan',
      };

      const result = vehicleLeadScoreTool.inputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid urgency', () => {
      const input = {
        contactId: 'contact-123',
        urgency: 'invalid',
      };

      const result = vehicleLeadScoreTool.inputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should require contactId', () => {
      const input = {
        urgency: 'urgent',
      };

      const result = vehicleLeadScoreTool.inputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Dry Run', () => {
    it('should calculate score without database access', async () => {
      const input = {
        contactId: 'contact-123',
        urgency: 'urgent',
        budgetRange: 'premium',
        vehicleType: 'sports',
      };

      const result = await vehicleLeadScoreTool.dryRun(input);

      expect(result.success).toBe(true);
      expect(result.score).toBeGreaterThan(0);
      expect(result.tier).toBe('urgent');
      expect(result.suggestedActions).toBeDefined();
      expect(result.suggestedActions.length).toBeGreaterThan(0);
    });

    it('should handle minimal input', async () => {
      const input = {
        contactId: 'contact-123',
        urgency: 'browsing',
      };

      const result = await vehicleLeadScoreTool.dryRun(input);

      expect(result.success).toBe(true);
      expect(result.tier).toBe('cold');
    });
  });

  describe('Tool Properties', () => {
    it('should have correct metadata', () => {
      expect(vehicleLeadScoreTool.id).toBe('vehicle-lead-score');
      expect(vehicleLeadScoreTool.riskLevel).toBe('low');
      expect(vehicleLeadScoreTool.requiresApproval).toBe(false);
      expect(vehicleLeadScoreTool.tags).toContain('vehicles');
    });

    it('should have input and output schemas', () => {
      expect(vehicleLeadScoreTool.inputSchema).toBeDefined();
      expect(vehicleLeadScoreTool.outputSchema).toBeDefined();
    });
  });
});

import { describe, it, expect } from 'vitest';
import { wholesaleUpdateStockTool } from './wholesale-update-stock.js';

describe('Wholesale Update Stock Tool', () => {
  describe('Schema Validation', () => {
    it('should validate valid input', () => {
      const input = {
        csvContent: 'SKU,STOCK\nPROD-001,100',
        projectId: 'test-project',
      };

      const result = wholesaleUpdateStockTool.inputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should require csvContent', () => {
      const input = {
        projectId: 'test-project',
      };

      const result = wholesaleUpdateStockTool.inputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Dry Run', () => {
    it('should parse CSV in dry run', async () => {
      const input = {
        csvContent: `SKU,STOCK,PRICE
PROD-001,100,5000
PROD-002,50,3000`,
        projectId: 'test-project',
      };

      const result = await wholesaleUpdateStockTool.dryRun(input);

      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(2);
    });
  });

  describe('Tool Properties', () => {
    it('should have correct metadata', () => {
      expect(wholesaleUpdateStockTool.id).toBe('wholesale-update-stock');
      expect(wholesaleUpdateStockTool.riskLevel).toBe('medium');
      expect(wholesaleUpdateStockTool.tags).toContain('wholesale');
    });
  });
});

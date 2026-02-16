/**
 * Catalog Order Tool Tests
 */
import { describe, it, expect, vi } from 'vitest';
import { createCatalogOrderTool } from './catalog-order.js';
import type { ExecutionContext } from '@/core/types.js';
import type { ProjectId, SessionId, TraceId } from '@/core/types.js';

describe('catalog-order tool', () => {
  const mockContext: ExecutionContext = {
    projectId: 'test-project' as ProjectId,
    sessionId: 'test-session' as SessionId,
    traceId: 'test-trace' as TraceId,
    agentConfig: {} as ExecutionContext['agentConfig'],
    permissions: { allowedTools: new Set(['catalog-order']) },
    abortSignal: new AbortController().signal,
  };

  describe('schema validation', () => {
    it('rejects empty customer name', async () => {
      const tool = createCatalogOrderTool();
      const result = await tool.execute({
        customerName: '',
        customerContact: { phone: '123456' },
        items: [
          { productId: 'P1', productName: 'Product 1', quantity: 1, unitPrice: 100 },
        ],
      }, mockContext);

      expect(result.ok).toBe(false);
    });

    it('rejects empty items array', async () => {
      const tool = createCatalogOrderTool();
      const result = await tool.execute({
        customerName: 'John Doe',
        customerContact: { phone: '123456' },
        items: [],
      }, mockContext);

      expect(result.ok).toBe(false);
    });

    it('rejects invalid email', async () => {
      const tool = createCatalogOrderTool();
      const result = await tool.execute({
        customerName: 'John Doe',
        customerContact: { email: 'not-an-email' },
        items: [
          { productId: 'P1', productName: 'Product 1', quantity: 1, unitPrice: 100 },
        ],
      }, mockContext);

      expect(result.ok).toBe(false);
    });

    it('accepts valid minimal order', async () => {
      const tool = createCatalogOrderTool();
      const result = await tool.execute({
        customerName: 'John Doe',
        customerContact: { phone: '123456' },
        items: [
          { productId: 'P1', productName: 'Product 1', quantity: 1, unitPrice: 100 },
        ],
      }, mockContext);

      expect(result.ok).toBe(true);
    });

    it('accepts valid full order', async () => {
      const tool = createCatalogOrderTool();
      const result = await tool.execute({
        customerId: 'CUST-001',
        customerName: 'John Doe',
        customerContact: {
          phone: '+54 9 11 1234-5678',
          email: 'john@example.com',
          address: 'Av. Corrientes 1234, CABA',
        },
        items: [
          { productId: 'P1', productName: 'Product 1', quantity: 2, unitPrice: 100, currency: 'ARS' },
          { productId: 'P2', productName: 'Product 2', quantity: 1, unitPrice: 250, currency: 'ARS' },
        ],
        notes: 'Entregar por la mañana',
        deliveryDate: '2024-12-25T10:00:00Z',
      }, mockContext);

      expect(result.ok).toBe(true);
    });
  });

  describe('execute', () => {
    it('creates draft order with mock implementation', async () => {
      const tool = createCatalogOrderTool();
      const result = await tool.execute({
        customerName: 'Jane Smith',
        customerContact: { phone: '555-0123' },
        items: [
          { productId: 'P1', productName: 'Widget', quantity: 5, unitPrice: 20, currency: 'USD' },
        ],
      }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as Record<string, unknown>;
        expect(output['orderId']).toMatch(/^ORD-/);
        expect(output['status']).toBe('draft');
        expect(output['totalAmount']).toBe(100);
        expect(output['currency']).toBe('USD');
        expect(output['itemCount']).toBe(1);
        expect(output['approvalRequired']).toBe(true);
      }
    });

    it('uses custom order creator when provided', async () => {
      const mockCreator = vi.fn().mockResolvedValue({
        orderId: 'CUSTOM-ORD-123',
        status: 'pending_approval',
      });

      const tool = createCatalogOrderTool({ orderCreator: mockCreator });
      const result = await tool.execute({
        customerName: 'Bob Johnson',
        customerContact: { email: 'bob@example.com' },
        items: [
          { productId: 'P1', productName: 'Gadget', quantity: 2, unitPrice: 50 },
        ],
      }, mockContext);

      expect(mockCreator).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['orderId']).toBe('CUSTOM-ORD-123');
        expect(output['status']).toBe('pending_approval');
      }
    });

    it('calculates total correctly for multiple items', async () => {
      const tool = createCatalogOrderTool();
      const result = await tool.execute({
        customerName: 'Alice Brown',
        customerContact: { phone: '555-9999' },
        items: [
          { productId: 'P1', productName: 'Item A', quantity: 3, unitPrice: 100 },
          { productId: 'P2', productName: 'Item B', quantity: 2, unitPrice: 250 },
          { productId: 'P3', productName: 'Item C', quantity: 1, unitPrice: 150 },
        ],
      }, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.value.output as Record<string, unknown>;
        expect(output['totalAmount']).toBe(950); // (3*100) + (2*250) + (1*150)
        expect(output['itemCount']).toBe(3);
      }
    });
  });

  describe('dryRun', () => {
    it('validates input without creating order', async () => {
      const mockCreator = vi.fn();
      const tool = createCatalogOrderTool({ orderCreator: mockCreator });

      const result = await tool.dryRun({
        customerName: 'Test User',
        customerContact: { phone: '123' },
        items: [
          { productId: 'P1', productName: 'Test Product', quantity: 1, unitPrice: 50 },
        ],
      }, mockContext);

      expect(mockCreator).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        const output = result.value.output as Record<string, unknown>;
        expect(output['orderId']).toBe('DRY-RUN-ORDER');
        expect(output['totalAmount']).toBe(50);
      }
    });

    it('rejects invalid input', async () => {
      const tool = createCatalogOrderTool();
      const result = await tool.dryRun({
        customerName: '',
        customerContact: {},
        items: [],
      }, mockContext);

      expect(result.ok).toBe(false);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEscalateToManagerTool } from './escalate-to-manager.js';
import type { AgentComms, AgentId } from '@/agents/types.js';
import type { ExecutionContext, ProjectId, SessionId, TraceId } from '@/core/types.js';
import { isOk, unwrap } from '@/core/result.js';

describe('Escalate to Manager Tool', () => {
    let mockComms: any;
    let mockGetManagerId: any;
    let mockContext: ExecutionContext;

    beforeEach(() => {
        mockComms = {
            send: vi.fn(),
            sendAndWait: vi.fn(),
            subscribe: vi.fn(),
        };

        mockGetManagerId = vi.fn().mockResolvedValue('manager-123' as AgentId);

        mockContext = {
            projectId: 'proj-1' as ProjectId,
            sessionId: 'sess-1' as SessionId,
            traceId: 'trace-1' as TraceId,
            agentConfig: {} as any,
            permissions: { allowedTools: new Set(['escalate-to-manager']) },
            abortSignal: new AbortController().signal,
        };
    });

    const createTool = (timeoutMs?: number) => createEscalateToManagerTool({
        comms: mockComms as AgentComms,
        getManagerId: mockGetManagerId,
        timeoutMs,
    });

    describe('Zod Schema Validation', () => {
        it('should pass with valid input', () => {
            const tool = createTool();
            const valid = tool.inputSchema.safeParse({ query: 'Can I offer a 10% discount?' });
            expect(valid.success).toBe(true);
        });

        it('should allow optional context', () => {
            const tool = createTool();
            const valid = tool.inputSchema.safeParse({
                query: 'Can I offer a 10% discount?',
                context: 'Customer has been with us for 5 years.'
            });
            expect(valid.success).toBe(true);
            if (valid.success) {
                expect(valid.data.context).toBe('Customer has been with us for 5 years.');
            }
        });

        it('should fail with missing query', () => {
            const tool = createTool();
            const invalid = tool.inputSchema.safeParse({ context: 'some context' });
            expect(invalid.success).toBe(false);
        });

        it('should fail with empty query', () => {
            const tool = createTool();
            const invalid = tool.inputSchema.safeParse({ query: '' });
            expect(invalid.success).toBe(false);
        });
    });

    describe('Execute', () => {
        it('should successfully send and wait for reply', async () => {
            mockComms.sendAndWait.mockResolvedValue('Yes, you can offer a 10% discount.');
            const tool = createTool();

            const result = await tool.execute({ query: 'Discount?' }, mockContext);

            expect(isOk(result)).toBe(true);
            const output = unwrap(result);

            expect(output.success).toBe(true);
            expect((output.output as any).reply).toBe('Yes, you can offer a 10% discount.');
            expect((output.output as any).managerId).toBe('manager-123');

            expect(mockComms.sendAndWait).toHaveBeenCalledWith(
                {
                    fromAgentId: 'sess-1',
                    toAgentId: 'manager-123',
                    content: 'Discount?',
                    context: undefined,
                },
                30000 // default timeout
            );
        });

        it('should pass context in message if provided', async () => {
            mockComms.sendAndWait.mockResolvedValue('Yes');
            const tool = createTool();

            await tool.execute({ query: 'Discount?', context: 'Loyal customer' }, mockContext);

            expect(mockComms.sendAndWait).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: 'Discount?',
                    context: { originalContext: 'Loyal customer' },
                }),
                30000
            );
        });

        it('should handle missing manager gracefully', async () => {
            mockGetManagerId.mockResolvedValue(null);
            const tool = createTool();

            const result = await tool.execute({ query: 'Discount?' }, mockContext);

            expect(isOk(result)).toBe(true);
            const output = unwrap(result);

            expect(output.success).toBe(false);
            expect(output.error).toContain('No Manager agent assigned');
            expect(mockComms.sendAndWait).not.toHaveBeenCalled();
        });

        it('should handle timeout error gracefully', async () => {
            mockComms.sendAndWait.mockRejectedValue(new Error('Agent response timeout after 30000ms'));
            const tool = createTool();

            const result = await tool.execute({ query: 'Discount?' }, mockContext);

            expect(isOk(result)).toBe(true);
            const output = unwrap(result);

            expect(output.success).toBe(false);
            expect(output.error).toContain('took too long to respond');
            expect(output.error).toContain('timeout');
        });

        it('should handle Zod validation error as tool execution error', async () => {
            const tool = createTool();

            const result = await tool.execute({ query: '' }, mockContext);

            expect(isOk(result)).toBe(false);
            if (!isOk(result)) {
                expect(result.error.code).toBe('TOOL_EXECUTION_ERROR');
            }
        });
    });

    describe('Dry Run', () => {
        it('should return simulated response without calling comms', async () => {
            const tool = createTool();

            const result = await tool.dryRun({ query: 'Discount?' }, mockContext);

            expect(isOk(result)).toBe(true);
            const output = unwrap(result);

            expect(output.success).toBe(true);
            expect((output.output as any).dryRun).toBe(true);
            expect((output.output as any).reply).toBeDefined();

            expect(mockComms.sendAndWait).not.toHaveBeenCalled();
        });
    });
});

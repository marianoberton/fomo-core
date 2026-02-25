import { describe, it, expect } from 'vitest';
import { createEscalateToHumanTool } from './escalate-to-human.js';
import type { ExecutionContext, ProjectId, SessionId, TraceId } from '@/core/types.js';
import { isOk, unwrap } from '@/core/result.js';

describe('Escalate to Human Tool', () => {
    const mockContext: ExecutionContext = {
        projectId: 'proj-1' as ProjectId,
        sessionId: 'sess-1' as SessionId,
        traceId: 'trace-1' as TraceId,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        agentConfig: {} as any,
        permissions: { allowedTools: new Set(['escalate-to-human']) },
        abortSignal: new AbortController().signal,
    };

    describe('Tool Metadata', () => {
        it('should have correct ID and category', () => {
            const tool = createEscalateToHumanTool();
            expect(tool.id).toBe('escalate-to-human');
            expect(tool.category).toBe('communication');
        });

        it('should require approval (critical risk)', () => {
            const tool = createEscalateToHumanTool();
            expect(tool.riskLevel).toBe('critical');
            expect(tool.requiresApproval).toBe(true);
        });
    });

    describe('Zod Schema Validation', () => {
        it('should pass with valid input', () => {
            const tool = createEscalateToHumanTool();
            const valid = tool.inputSchema.safeParse({ query: 'Can I offer a 10% discount?' });
            expect(valid.success).toBe(true);
        });

        it('should allow optional context', () => {
            const tool = createEscalateToHumanTool();
            const valid = tool.inputSchema.safeParse({
                query: 'Can I offer a 10% discount?',
                context: 'Customer has been with us for 5 years.',
            });
            expect(valid.success).toBe(true);
        });

        it('should fail with missing query', () => {
            const tool = createEscalateToHumanTool();
            const invalid = tool.inputSchema.safeParse({ context: 'some context' });
            expect(invalid.success).toBe(false);
        });

        it('should fail with empty query', () => {
            const tool = createEscalateToHumanTool();
            const invalid = tool.inputSchema.safeParse({ query: '' });
            expect(invalid.success).toBe(false);
        });
    });

    describe('Execute', () => {
        it('should return a dummy response (tool is trapped by approval gate in production)', async () => {
            const tool = createEscalateToHumanTool();
            const result = await tool.execute({ query: 'Discount request' }, mockContext);

            expect(isOk(result)).toBe(true);
            const output = unwrap(result);
            expect(output.success).toBe(true);

            const data = output.output as { reply: string; approved: boolean };
            expect(data.reply).toContain('bypassed');
            expect(data.approved).toBe(true);
        });
    });

    describe('Dry Run', () => {
        it('should return a simulated response', async () => {
            const tool = createEscalateToHumanTool();
            const result = await tool.dryRun({ query: 'Discount request' }, mockContext);

            expect(isOk(result)).toBe(true);
            const output = unwrap(result);
            expect(output.success).toBe(true);

            const data = output.output as { reply: string; approved: boolean };
            expect(data.reply).toBeDefined();
            expect(data.approved).toBe(true);
        });
    });
});

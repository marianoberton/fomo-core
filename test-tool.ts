import { createDatabase } from './src/infrastructure/database.js';
import { createPrismaApprovalStore } from './src/security/prisma-approval-store.js';
import { createApprovalGate } from './src/security/approval-gate.js';
import { createToolRegistry } from './src/tools/registry/tool-registry.js';
import { createSendEmailTool } from './src/tools/definitions/send-email.js';

async function main() {
    const db = createDatabase();
    await db.connect();
    const prisma = db.client;

    const project = await prisma.project.findFirst();
    if (!project) throw new Error('No project');

    const session = await prisma.session.findFirst();
    const sessionId = session ? session.id : 'fake-session';

    const approvalGate = createApprovalGate({ store: createPrismaApprovalStore(prisma) });

    const toolRegistry = createToolRegistry({
        approvalGate: async (toolId, input, context) => {
            const request = await approvalGate.requestApproval({
                projectId: context.projectId,
                sessionId: context.sessionId,
                toolCallId: `tc_${Date.now()}` as any,
                toolId,
                toolInput: input,
                riskLevel: 'high',
            });
            return { approved: true, approvalId: request.id };
        },
    });

    toolRegistry.register(createSendEmailTool({ secretService: { get: async () => 'fake-key' } as any }));

    console.log('Resolving send-email...');

    const result = await toolRegistry.resolve('send-email', {
        to: 'mariano@example.com',
        subject: 'Test',
        body: 'Hello',
    }, {
        projectId: project.id,
        sessionId: sessionId,
        traceId: 'trace-1' as any,
        agentConfig: {} as any,
        permissions: { allowedTools: new Set(['send-email']) },
        abortSignal: new AbortController().signal
    });

    console.log('Result:', result);

    await db.disconnect();
}
main().catch(console.error);

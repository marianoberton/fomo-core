import { describe, it, expect, vi } from 'vitest';
import {
  createInAppApprovalNotifier,
  APPROVAL_NOTIFICATION_KIND,
} from './in-app-approval-notifier.js';
import type { ApprovalNotificationContext } from './types.js';
import type { ApprovalRequest } from '@/security/types.js';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
}

const sampleContext: ApprovalNotificationContext = {
  approvalId: 'appr_123',
  projectId: 'proj-mp' as ProjectId,
  projectName: 'Market Paper',
  agentId: 'agt-1',
  agentName: 'Reactivadora',
  leadName: 'Juan Pérez',
  leadContact: '+54 11 1234-5678',
  contactId: 'ct-1',
  sessionId: 'sess-1',
  actionSummary: 'Enviar mejora de presupuesto',
  toolId: 'send-channel-message',
  toolInput: {},
  riskLabel: 'Alto',
  riskLevel: 'high',
  requestedAt: new Date('2026-04-24T10:00:00Z'),
};

const sampleRequest: ApprovalRequest = {
  id: 'appr_123' as ApprovalId,
  projectId: 'proj-mp' as ProjectId,
  sessionId: 'sess-1' as SessionId,
  toolCallId: 'tc-1' as ToolCallId,
  toolId: 'send-channel-message',
  toolInput: {},
  riskLevel: 'high',
  status: 'pending',
  requestedAt: new Date('2026-04-24T10:00:00Z'),
  expiresAt: new Date('2026-04-24T10:30:00Z'),
};

describe('createInAppApprovalNotifier', () => {
  it('persists a row with the expected shape', async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { inAppNotification: { create } } as unknown as PrismaClient;
    const logger = makeLogger();

    const notifier = createInAppApprovalNotifier({ prisma, logger });
    await notifier(sampleContext, sampleRequest);

    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0]!;
    const args = call[0] as {
      data: {
        projectId: string;
        userId: string | null;
        kind: string;
        payload: Record<string, unknown>;
      };
    };
    expect(args.data.projectId).toBe('proj-mp');
    expect(args.data.userId).toBeNull();
    expect(args.data.kind).toBe(APPROVAL_NOTIFICATION_KIND);
    expect(args.data.payload).toMatchObject({
      approvalId: 'appr_123',
      agentName: 'Reactivadora',
      leadName: 'Juan Pérez',
      leadContact: '+54 11 1234-5678',
      actionSummary: 'Enviar mejora de presupuesto',
      riskLevel: 'high',
      toolId: 'send-channel-message',
    });
  });

  it('logs error and does not throw when DB persist fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('DB down'));
    const prisma = { inAppNotification: { create } } as unknown as PrismaClient;
    const logger = makeLogger();

    const notifier = createInAppApprovalNotifier({ prisma, logger });
    await expect(notifier(sampleContext, sampleRequest)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('persist failed'),
      expect.objectContaining({ error: 'DB down', approvalId: 'appr_123' }),
    );
  });
});

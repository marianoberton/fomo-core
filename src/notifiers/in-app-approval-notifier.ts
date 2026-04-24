/**
 * In-app approval notifier.
 *
 * Persists an `InAppNotification` row (kind = "approval_requested") so the
 * dashboard can show a bell/badge with pending approvals even after the
 * operator reconnects. Complementary to the Telegram transport — both
 * link back to the same dashboard approval view.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { ApprovalNotificationContext, ApprovalContextNotifier, InAppApprovalPayload } from './types.js';

export const APPROVAL_NOTIFICATION_KIND = 'approval_requested';

export interface InAppApprovalNotifierConfig {
  prisma: PrismaClient;
  logger: Logger;
}

/**
 * Create the in-app notifier. Never throws — failures are logged and
 * swallowed so the approval flow keeps moving even if the notifications
 * table is briefly unreachable.
 */
export function createInAppApprovalNotifier(
  config: InAppApprovalNotifierConfig,
): ApprovalContextNotifier {
  const { prisma, logger } = config;

  return async (context: ApprovalNotificationContext): Promise<void> => {
    const payload: InAppApprovalPayload = {
      approvalId: context.approvalId,
      agentName: context.agentName,
      leadName: context.leadName,
      leadContact: context.leadContact,
      actionSummary: context.actionSummary,
      riskLevel: context.riskLevel,
      toolId: context.toolId,
    };

    try {
      await prisma.inAppNotification.create({
        data: {
          projectId: context.projectId,
          userId: null,
          kind: APPROVAL_NOTIFICATION_KIND,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });

      logger.info('In-app approval notification persisted', {
        component: 'in-app-notifier',
        event: 'approval_sent',
        approvalId: context.approvalId,
        projectId: context.projectId,
      });
    } catch (error) {
      logger.error('In-app approval notifier: persist failed', {
        component: 'in-app-notifier',
        approvalId: context.approvalId,
        projectId: context.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

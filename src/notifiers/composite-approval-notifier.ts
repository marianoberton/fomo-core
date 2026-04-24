/**
 * Composite approval notifier.
 *
 * Fans an approval event out to every registered transport (Telegram,
 * in-app, ...). Builds the shared enriched context once and awaits all
 * transports in parallel with error isolation — a failure in one
 * transport never blocks or crashes the others.
 *
 * Exposes an `ApprovalNotifier` (the shape `ApprovalGate.options.notifier`
 * expects), so it drops straight into the existing wiring.
 */
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { ApprovalNotifier } from '@/security/approval-gate.js';
import { buildApprovalContext } from './approval-context.js';
import type { ApprovalContextNotifier } from './types.js';

export interface CompositeApprovalNotifierConfig {
  prisma: PrismaClient;
  logger: Logger;
  notifiers: ApprovalContextNotifier[];
}

/** Fan-out notifier — one context build, many transports. */
export function createCompositeApprovalNotifier(
  config: CompositeApprovalNotifierConfig,
): ApprovalNotifier {
  const { prisma, logger, notifiers } = config;

  return async (request): Promise<void> => {
    if (notifiers.length === 0) return;

    let context;
    try {
      context = await buildApprovalContext(prisma, request);
    } catch (error) {
      logger.error('Composite approval notifier: context build failed', {
        component: 'composite-approval-notifier',
        approvalId: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const results = await Promise.allSettled(
      notifiers.map((n) => n(context, request)),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        // Individual notifiers already log internally; this is a
        // safety net for any that forgot to catch.
        logger.error('Composite approval notifier: transport threw', {
          component: 'composite-approval-notifier',
          approvalId: request.id,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  };
}

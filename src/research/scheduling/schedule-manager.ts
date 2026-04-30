// ResearchScheduleManager — longitudinal schedule lifecycle.
//
// Core logic for Phase 5:
//   - computeNextRunAt: uses intervalMs or cronExpr (cron-parser v5) + jitter
//   - processDueSchedules: called hourly by BullMQ repeatable; finds due
//     schedules, creates sessions, advances state.
//
// Why intervalMs instead of cron for "every 14 days":
//   The cron expression for day-of-month step fires on days 1, 15, 29 then
//   wraps back to day 1 — producing a 2-3 day gap at month boundary.
//   intervalMs + nextRunAt arithmetic gives true 14-day intervals.
//   cronExpr is kept for genuinely cron-friendly schedules like
//   "every Monday at 10am" (0 10 * * 1).
import { CronExpressionParser } from 'cron-parser';
import type { PrismaClient, ResearchSessionSchedule } from '@prisma/client';
import type { Logger } from '@/observability/logger.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ResearchError } from '../errors.js';
import type { ResearchSessionScheduleId } from '../types.js';
import {
  createResearchScheduleRepository,
  type CreateScheduleInput,
} from '../repositories/schedule-repository.js';
import type { ResearchSessionScheduleRepository } from '../repositories/schedule-repository.js';
import { createResearchSessionRepository } from '../repositories/session-repository.js';

// ─── Active-hours clamping ─────────────────────────────────────────
//
// Probes run during business hours (09:00–21:00) to avoid disturbing
// target agents during off-hours and reduce detection risk.

const ACTIVE_HOUR_START = 9;
const ACTIVE_HOUR_END = 21;

function clampToActiveHours(date: Date): Date {
  const h = date.getHours();
  if (h >= ACTIVE_HOUR_START && h < ACTIVE_HOUR_END) return date;
  const next = new Date(date);
  if (h >= ACTIVE_HOUR_END) {
    // Past 21:00 → advance to next day 09:00
    next.setDate(next.getDate() + 1);
  }
  next.setHours(ACTIVE_HOUR_START, Math.floor(Math.random() * 60), 0, 0);
  return next;
}

// ─── Public interface ──────────────────────────────────────────────

export interface ResearchScheduleManager {
  createSchedule(
    input: CreateScheduleInput,
  ): Promise<Result<ResearchSessionSchedule, ResearchError>>;
  activateSchedule(id: ResearchSessionScheduleId): Promise<void>;
  deactivateSchedule(id: ResearchSessionScheduleId): Promise<void>;
  /** Hourly BullMQ tick — finds due schedules and creates sessions. */
  processDueSchedules(): Promise<{ created: number; skipped: number; errors: number }>;
  /** Pure — compute next fire time from cron or intervalMs + jitter. */
  computeNextRunAt(schedule: ResearchSessionSchedule, from?: Date): Date;
}

// ─── Deps ──────────────────────────────────────────────────────────

export interface ScheduleManagerDeps {
  prisma: PrismaClient;
  scheduleRepo?: ResearchSessionScheduleRepository;
  logger: Logger;
}

// ─── Factory ──────────────────────────────────────────────────────

export function createScheduleManager(deps: ScheduleManagerDeps): ResearchScheduleManager {
  const { prisma, logger } = deps;
  const scheduleRepo = deps.scheduleRepo ?? createResearchScheduleRepository(prisma);
  const sessionRepo = createResearchSessionRepository(prisma);

  function computeNextRunAt(schedule: ResearchSessionSchedule, from: Date = new Date()): Date {
    let next: Date;

    if (schedule.cronExpr) {
      next = CronExpressionParser.parse(schedule.cronExpr, { currentDate: from })
        .next()
        .toDate();
    } else if (schedule.intervalMs !== null) {
      next = new Date(from.getTime() + Number(schedule.intervalMs));
    } else {
      throw new ResearchError({
        message: `Schedule ${schedule.id} has neither cronExpr nor intervalMs`,
        code: 'SCRIPT_INVALID',
      });
    }

    // Apply jitter (±jitterMs) to avoid predictable probe patterns
    const jitter = (Math.random() * 2 - 1) * schedule.jitterMs;
    next = new Date(next.getTime() + jitter);

    return clampToActiveHours(next);
  }

  return {
    computeNextRunAt,

    async createSchedule(input) {
      if (!input.cronExpr && input.intervalMs === undefined) {
        return err(
          new ResearchError({
            message: 'Schedule must have either cronExpr or intervalMs',
            code: 'SCRIPT_INVALID',
          }),
        );
      }

      const schedule = await scheduleRepo.create(input);

      logger.info('research scheduler: schedule created', {
        component: 'research-scheduler',
        scheduleId: schedule.id,
        targetId: schedule.targetId,
        intervalMs: schedule.intervalMs?.toString(),
        cronExpr: schedule.cronExpr,
      });

      return ok(schedule);
    },

    async activateSchedule(id) {
      await scheduleRepo.update(id, { isActive: true });
      logger.info('research scheduler: schedule activated', {
        component: 'research-scheduler',
        scheduleId: id,
      });
    },

    async deactivateSchedule(id) {
      await scheduleRepo.deactivate(id);
      logger.info('research scheduler: schedule deactivated', {
        component: 'research-scheduler',
        scheduleId: id,
      });
    },

    async processDueSchedules() {
      const now = new Date();
      const due = await scheduleRepo.listDue(now);

      let created = 0;
      let skipped = 0;
      let errors = 0;

      logger.info('research scheduler: tick started', {
        component: 'research-job-schedule-tick',
        dueCount: due.length,
        now: now.toISOString(),
      });

      for (const schedule of due) {
        try {
          // Rate-limit check: if target has an active/queued session, postpone
          const activeSession = await prisma.researchSession.findFirst({
            where: {
              targetId: schedule.targetId,
              status: { in: ['queued', 'running', 'waiting_response', 'paused'] },
            },
          });

          if (activeSession) {
            // Advance nextRunAt by 1 hour and skip
            const postponed = new Date(now.getTime() + 60 * 60 * 1000);
            await scheduleRepo.recordRun(schedule.id as ResearchSessionScheduleId, false, postponed);
            skipped++;
            logger.info('research scheduler: target busy, postponed 1h', {
              component: 'research-job-schedule-tick',
              scheduleId: schedule.id,
              targetId: schedule.targetId,
              activeSessionId: activeSession.id,
            });
            continue;
          }

          // Create session linked to this schedule
          await sessionRepo.create({
            targetId: schedule.targetId,
            phoneId: schedule.phoneId,
            scriptId: schedule.scriptId,
            scheduleId: schedule.id,
            triggeredBy: 'schedule',
          });

          // Advance schedule state
          const nextRunAt = computeNextRunAt(schedule, now);
          await scheduleRepo.recordRun(schedule.id as ResearchSessionScheduleId, true, nextRunAt);

          created++;
          logger.info('research scheduler: session created', {
            component: 'research-job-schedule-tick',
            scheduleId: schedule.id,
            targetId: schedule.targetId,
            nextRunAt: nextRunAt.toISOString(),
          });
        } catch (cause) {
          errors++;
          const msg = cause instanceof Error ? cause.message : String(cause);
          logger.error('research scheduler: error processing schedule', {
            component: 'research-job-schedule-tick',
            scheduleId: schedule.id,
            error: msg,
          });
        }
      }

      logger.info('research scheduler: tick completed', {
        component: 'research-job-schedule-tick',
        created,
        skipped,
        errors,
      });

      return { created, skipped, errors };
    },
  };
}

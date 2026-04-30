/**
 * ResearchProbeRunner — orchestrates a probe session turn-by-turn.
 *
 * Architecture (§3.1):
 *   start()        → loads session, loops over script turns, marks completed
 *   handleInbound  → called by webhook: opt-out check, PII scrub, DB persist, Redis signal
 *   handleTimeout  → called by timeout BullMQ job: publishes timeout signal to Redis
 *
 * Race-condition fix (§3.3): buffer key written BEFORE pub, subscriber checks
 * buffer at step 1 + re-checks at step 3 to guarantee no signal is ever lost.
 *
 * Restart resilience (§3.3b): currentTurn is updated only after a full exchange
 * (outbound + inbound). On restart the runner resumes from session.currentTurn
 * and skips the sendText if the outbound was already recorded in DB.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { Logger } from '@/observability/logger.js';
import type { WahaResearchClient } from '../waha-research-client.js';
import type { ResearchSessionRepository } from '../repositories/session-repository.js';
import type { ResearchTurnRepository } from '../repositories/turn-repository.js';
import type { ResearchSessionId } from '../types.js';
import type { ProbeTurn } from '../types.js';
import { scrubPii } from './pii-scrubber.js';
import { isOptOutMessage } from '../compliance/opt-out-detector.js';
import { ResearchError } from '../errors.js';

// ─── Public interface ─────────────────────────────────────────────

export interface HandleInboundParams {
  sessionId: ResearchSessionId;
  /** 1-indexed turn order (= session.currentTurn + 1 at time of receipt). */
  turnOrder: number;
  wahaMessageId: string;
  text: string;
  /** Unix timestamp in seconds (from WAHA payload). */
  timestamp?: number;
  targetId: string;
}

export interface ResearchProbeRunner {
  /**
   * Execute the full probe session. Called by the BullMQ worker.
   * Idempotent: re-running a completed session is a no-op.
   */
  start(sessionId: ResearchSessionId): Promise<void>;

  /**
   * Signal an inbound message to the waiting runner via Redis.
   * Handles opt-out detection, PII scrubbing, and turn persistence.
   * Called by the research webhook handler when an active session matches.
   */
  handleInbound(params: HandleInboundParams): Promise<void>;

  /**
   * Signal a turn timeout to the waiting runner via Redis.
   * Called by the `research-probe-timeout` BullMQ job when it fires.
   */
  handleTimeout(sessionId: ResearchSessionId, turnOrder: number): Promise<void>;
}

// ─── Internal signal types ────────────────────────────────────────

interface SignalResponse {
  type: 'response';
  wahaMessageId: string;
  text: string;
}

interface SignalTimeout {
  type: 'timeout';
}

interface SignalAborted {
  type: 'aborted';
}

type RunnerSignal = SignalResponse | SignalTimeout | SignalAborted;

// ─── Deps ─────────────────────────────────────────────────────────

export interface ProbeRunnerDeps {
  prisma: PrismaClient;
  redis: Redis;
  wahaClient: WahaResearchClient;
  sessionRepo: ResearchSessionRepository;
  turnRepo: ResearchTurnRepository;
  /** Queue used to enqueue timeout jobs + cancel them when response arrives. */
  probeQueue: Queue;
  /** Queue to enqueue analysis jobs after session completes. Optional — skipped if null. */
  analysisQueue?: Queue | null;
  logger: Logger;
}

// ─── Redis key helpers ────────────────────────────────────────────

function bufferKey(sessionId: string, turnOrder: number): string {
  return `research:inbox:${sessionId}:${turnOrder}`;
}

function channelKey(sessionId: string, turnOrder: number): string {
  return `research:response:${sessionId}:${turnOrder}`;
}

// ─── Factory ─────────────────────────────────────────────────────

export function createResearchProbeRunner(deps: ProbeRunnerDeps): ResearchProbeRunner {
  const { prisma, redis, wahaClient, sessionRepo, turnRepo, probeQueue, analysisQueue, logger } = deps;

  // ── Private: Redis buffer + subscribe wait ──────────────────────

  async function waitForResponse(
    sessionId: string,
    turnOrder: number,
    timeoutMs: number,
  ): Promise<RunnerSignal> {
    const bKey = bufferKey(sessionId, turnOrder);
    const cKey = channelKey(sessionId, turnOrder);

    // Step 1: check buffer — response may have arrived before we subscribe
    const early = await redis.get(bKey);
    if (early !== null) {
      return JSON.parse(early) as RunnerSignal;
    }

    // Step 2: subscribe (must be before re-check to close the race window)
    const subscriber = redis.duplicate();
    await subscriber.subscribe(cKey);

    try {
      // Step 3: re-check buffer (message could have arrived between steps 1 and 2)
      const recheck = await redis.get(bKey);
      if (recheck !== null) {
        return JSON.parse(recheck) as RunnerSignal;
      }

      // Step 4: wait with in-process timer
      const message = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => { resolve(null); }, timeoutMs);
        subscriber.on('message', (_ch: string, msg: string) => {
          clearTimeout(timer);
          resolve(msg);
        });
      });

      if (message === null) {
        return { type: 'timeout' };
      }
      return JSON.parse(message) as RunnerSignal;
    } finally {
      await subscriber.unsubscribe(cKey);
      await subscriber.quit();
    }
  }

  // ── Private: jitter sleep ────────────────────────────────────────

  async function applyJitter(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise<void>((resolve) => { setTimeout(resolve, delay); });
  }

  // ── Private: typing indicator ────────────────────────────────────

  async function sendTypingAndWait(
    wahaSession: string,
    chatId: string,
    messageText: string,
  ): Promise<void> {
    const typingMs = Math.min(50 * messageText.length, 8_000);
    const startResult = await wahaClient.startTyping(wahaSession, chatId, typingMs);
    if (!startResult.ok) {
      logger.warn('research runner: startTyping failed (non-fatal)', {
        component: 'research-runner',
        error: startResult.error.message,
      });
      return;
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, typingMs); });
    const stopResult = await wahaClient.stopTyping(wahaSession, chatId);
    if (!stopResult.ok) {
      logger.warn('research runner: stopTyping failed (non-fatal)', {
        component: 'research-runner',
        error: stopResult.error.message,
      });
    }
  }

  // ── Public: start ────────────────────────────────────────────────

  async function start(sessionId: ResearchSessionId): Promise<void> {
    const session = await sessionRepo.findById(sessionId);
    if (!session) {
      throw new ResearchError({
        message: `Session ${sessionId} not found`,
        code: 'SCRIPT_INVALID',
      });
    }

    if (['completed', 'failed', 'aborted'].includes(session.status)) {
      logger.info('research runner: session already terminal, skipping', {
        component: 'research-runner',
        sessionId,
        status: session.status,
      });
      return;
    }

    // Load script
    const script = await prisma.probeScript.findUnique({ where: { id: session.scriptId } });
    if (!script) {
      await sessionRepo.markFailed(sessionId, 'Script not found', 'SCRIPT_INVALID');
      return;
    }

    // Load phone + target
    const [phone, target] = await Promise.all([
      prisma.researchPhone.findUnique({ where: { id: session.phoneId } }),
      prisma.researchTarget.findUnique({ where: { id: session.targetId } }),
    ]);

    if (!phone || !target) {
      await sessionRepo.markFailed(sessionId, 'Phone or target not found', 'SCRIPT_INVALID');
      return;
    }

    // Parse turns from JSON column
    const turns = script.turns as unknown as ProbeTurn[];
    if (!Array.isArray(turns) || turns.length === 0) {
      await sessionRepo.markFailed(sessionId, 'Script has no turns', 'SCRIPT_INVALID');
      return;
    }

    await sessionRepo.updateStatus(sessionId, 'running');

    const startTurnIdx = session.currentTurn; // 0-based: resume after last completed exchange
    const chatId = target.phoneNumber;

    logger.info('research runner: session started', {
      component: 'research-runner',
      sessionId,
      totalTurns: turns.length,
      resumeFrom: startTurnIdx,
    });

    for (let i = startTurnIdx; i < turns.length; i++) {
      const turn = turns[i];
      if (!turn) continue;

      const turnOrder = i + 1; // 1-indexed

      // ── Jitter (skip on very first send of a fresh session) ──────
      if (i > 0 || startTurnIdx > 0) {
        await applyJitter(script.waitMinMs, script.waitMaxMs);
      }

      // ── Restart dedup: skip sendText if outbound already in DB ───
      const existingOutbound = await prisma.researchTurn.findFirst({
        where: { sessionId, turnOrder, direction: 'outbound' },
        select: { id: true },
      });

      if (!existingOutbound) {
        // Typing indicator + send
        await sendTypingAndWait(phone.wahaSession, chatId, turn.message);

        const sendResult = await wahaClient.sendText(phone.wahaSession, chatId, turn.message);
        if (!sendResult.ok) {
          logger.error('research runner: sendText failed', {
            component: 'research-runner',
            sessionId,
            turnOrder,
            error: sendResult.error.message,
            code: sendResult.error.researchCode,
          });
          await sessionRepo.markFailed(
            sessionId,
            sendResult.error.message,
            sendResult.error.researchCode,
          );
          return;
        }

        await turnRepo.create({
          sessionId,
          turnOrder,
          direction: 'outbound',
          message: turn.message,
          wahaMessageId: sendResult.value.id,
        });
      } else {
        logger.info('research runner: outbound already persisted, skipping send (restart dedup)', {
          component: 'research-runner',
          sessionId,
          turnOrder,
        });
      }

      // ── Enqueue timeout job ──────────────────────────────────────
      const timeoutJobId = `timeout:${sessionId}:${turnOrder}`;
      await probeQueue.add(
        'research-probe-timeout',
        { sessionId, turnOrder },
        { delay: turn.waitForResponseMs, jobId: timeoutJobId },
      );

      await sessionRepo.updateStatus(sessionId, 'waiting_response');

      logger.info('research runner: waiting for response', {
        component: 'research-runner',
        sessionId,
        turnOrder,
        timeoutMs: turn.waitForResponseMs,
      });

      // ── Wait for response ────────────────────────────────────────
      const responseStart = Date.now();
      const signal = await waitForResponse(sessionId, turnOrder, turn.waitForResponseMs);
      const latencyMs = Date.now() - responseStart;

      // ── Cancel timeout job if response arrived ───────────────────
      if (signal.type !== 'timeout') {
        try {
          await probeQueue.remove(timeoutJobId);
        } catch {
          // Job may have already fired or been removed — safe to ignore
        }
      }

      if (signal.type === 'aborted') {
        logger.info('research runner: session aborted (opt-out or manual)', {
          component: 'research-runner',
          sessionId,
        });
        return;
      }

      if (signal.type === 'timeout') {
        logger.info('research runner: turn timed out', {
          component: 'research-runner',
          sessionId,
          turnOrder,
        });

        await turnRepo.create({
          sessionId,
          turnOrder,
          direction: 'inbound',
          message: '',
          latencyMs,
          isTimeout: true,
        });

        if (!turn.continueOnTimeout) {
          await sessionRepo.markFailed(sessionId, 'Response timeout', 'RESPONSE_TIMEOUT');
          return;
        }

        await sessionRepo.updateStatus(sessionId, 'running');
        await sessionRepo.updateCurrentTurn(sessionId, turnOrder);
        continue;
      }

      // ── Normal response (turn complete) ──────────────────────────
      // handleInbound already persisted the inbound turn; just advance state.
      await sessionRepo.updateStatus(sessionId, 'running');
      await sessionRepo.updateCurrentTurn(sessionId, turnOrder);

      logger.info('research runner: turn completed', {
        component: 'research-runner',
        sessionId,
        turnOrder,
        latencyMs,
      });
    }

    // All turns done
    await sessionRepo.markCompleted(sessionId);

    logger.info('research runner: session completed', {
      component: 'research-runner',
      sessionId,
      totalTurns: turns.length,
    });

    if (analysisQueue) {
      await analysisQueue.add(
        'research-analyze-session',
        { sessionId },
        { attempts: 2, backoff: { type: 'exponential', delay: 10_000 } },
      );
    }
  }

  // ── Public: handleInbound ────────────────────────────────────────

  async function handleInbound(params: HandleInboundParams): Promise<void> {
    const { sessionId, turnOrder, wahaMessageId, text, timestamp, targetId } = params;

    // Opt-out detection — abort before persisting anything
    if (isOptOutMessage(text)) {
      logger.info('research runner: opt-out detected', {
        component: 'research-runner',
        sessionId,
        targetId,
      });

      await prisma.$transaction([
        prisma.researchSession.update({
          where: { id: sessionId },
          data: {
            status: 'aborted',
            failedAt: new Date(),
            failCode: 'OPT_OUT_DETECTED',
            failReason: 'Opt-out keyword detected',
          },
        }),
        prisma.researchTarget.update({
          where: { id: targetId },
          data: {
            optedOutAt: new Date(),
            optedOutReason: text.slice(0, 500),
            status: 'banned',
          },
        }),
      ]);

      // Signal abort so the waiting runner stops immediately
      const cKey = channelKey(sessionId, turnOrder);
      await redis.publish(cKey, JSON.stringify({ type: 'aborted' } satisfies SignalAborted));
      return;
    }

    // PII scrubbing
    const { clean, redactionsCount } = scrubPii(text, 'AR');

    const latencyMs = timestamp ? Date.now() - timestamp * 1000 : undefined;

    await turnRepo.create({
      sessionId,
      turnOrder,
      direction: 'inbound',
      message: clean,
      rawMessage: clean !== text ? text : undefined,
      wahaMessageId,
      latencyMs,
      sanitized: redactionsCount > 0,
      redactionsCount,
    });

    // Buffer BEFORE publish (race-condition fix from §3.3)
    const bKey = bufferKey(sessionId, turnOrder);
    const cKey = channelKey(sessionId, turnOrder);
    const signal = JSON.stringify({
      type: 'response',
      wahaMessageId,
      text: clean,
    } satisfies SignalResponse);

    await redis.set(bKey, signal, 'EX', 300);
    await redis.publish(cKey, signal);

    logger.info('research runner: inbound turn persisted and signaled', {
      component: 'research-runner',
      sessionId,
      turnOrder,
      wahaMessageId,
      redactionsCount,
    });
  }

  // ── Public: handleTimeout ────────────────────────────────────────

  async function handleTimeout(
    sessionId: ResearchSessionId,
    turnOrder: number,
  ): Promise<void> {
    const cKey = channelKey(sessionId, turnOrder);
    await redis.publish(cKey, JSON.stringify({ type: 'timeout' } satisfies SignalTimeout));

    logger.info('research runner: timeout signal published', {
      component: 'research-runner',
      sessionId,
      turnOrder,
    });
  }

  return { start, handleInbound, handleTimeout };
}

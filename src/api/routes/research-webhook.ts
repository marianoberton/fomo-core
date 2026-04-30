/**
 * WAHA → fomo-core inbound webhook for research sessions.
 *
 * Registered at POST /webhooks/research/waha so it inherits the existing
 * auth-middleware exemption (paths starting with /api/v1/webhooks/ skip
 * Bearer checks). Authentication is HMAC-SHA256 instead.
 *
 * Idempotency: ResearchTurn.wahaMessageId has @unique — duplicate deliveries
 * from WAHA cause a Prisma unique-constraint error which we catch and ignore
 * (return 200 OK). No explicit dedup table needed.
 *
 * When a ResearchProbeRunner is wired in (via deps.researchRunner), all inbound
 * processing (opt-out, PII scrub, DB persist, Redis signal) is delegated to it.
 * When no runner is present (Redis unavailable), the webhook falls back to the
 * inline opt-out + persist path.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { createResearchPhoneRepository } from '@/research/repositories/phone-repository.js';
import { isOptOutMessage } from '@/research/compliance/opt-out-detector.js';
import type { ResearchSessionId } from '@/research/types.js';

// ─── Payload schema ───────────────────────────────────────────────────

const WahaMessagePayloadSchema = z.object({
  /** Unique WAHA message ID — maps to ResearchTurn.wahaMessageId. */
  id: z.string(),
  /** WAHA session name (maps to ResearchPhone.wahaSession). */
  session: z.string(),
  /** Sender's WhatsApp ID, e.g. "5491123456789@c.us". */
  from: z.string(),
  /** Message text body. */
  body: z.string().optional().default(''),
  /** Unix timestamp in seconds. */
  timestamp: z.number().optional(),
  /** Type of event — we only process "message". */
  event: z.string().optional(),
});

type WahaMessagePayload = z.infer<typeof WahaMessagePayloadSchema>;

// ─── HMAC verification ────────────────────────────────────────────────

/**
 * Verify WAHA webhook HMAC-SHA256.
 * bodyStr is the JSON-serialized request body (round-tripped via JSON.stringify).
 * For strict byte-exact verification, a rawBody plugin would be needed;
 * this approach works because WAHA sends consistent JSON.
 */
function verifyHmac(bodyStr: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(bodyStr).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signature.replace(/^sha256=/, ''), 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

// ─── Route registration ───────────────────────────────────────────────

export function researchWebhookRoutes(fastify: FastifyInstance, deps: RouteDependencies): void {
  const { prisma, logger } = deps;
  const phoneRepo = createResearchPhoneRepository(prisma);
  const hmacSecret = process.env['WAHA_WEBHOOK_HMAC_SECRET'] ?? '';

  // POST /webhooks/research/waha
  // Note: full path is /api/v1/webhooks/research/waha — exempt from Bearer auth.
  fastify.post(
    '/webhooks/research/waha',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // ── 1. HMAC verification ──────────────────────────────────────
      const signature = (request.headers['x-webhook-hmac'] as string | undefined) ?? '';
      const bodyStr = JSON.stringify(request.body);

      if (hmacSecret) {
        if (!verifyHmac(bodyStr, signature, hmacSecret)) {
          logger.warn('research webhook: HMAC mismatch', {
            component: 'research-webhook',
            session: 'unknown',
          });
          await reply.code(401).send({ ok: false, error: 'Invalid HMAC signature' });
          return;
        }
      }

      // ── 2. Parse body ────────────────────────────────────────────
      const parsed = WahaMessagePayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        logger.warn('research webhook: malformed payload', {
          component: 'research-webhook',
          issues: parsed.error.issues,
        });
        await reply.code(400).send({ ok: false, error: 'Malformed payload' });
        return;
      }

      const payload: WahaMessagePayload = parsed.data;

      // ── 3. Idempotency check (UNIQUE wahaMessageId) ───────────────
      const existing = await prisma.researchTurn.findFirst({
        where: { wahaMessageId: payload.id },
        select: { id: true },
      });
      if (existing) {
        logger.info('research webhook: duplicate message, skipping', {
          component: 'research-webhook',
          wahaMessageId: payload.id,
        });
        await reply.code(200).send({ ok: true, status: 'already_processed' });
        return;
      }

      // ── 4. Resolve phone ──────────────────────────────────────────
      const phone = await phoneRepo.findBySession(payload.session);
      if (!phone) {
        logger.warn('research webhook: unknown session', {
          component: 'research-webhook',
          session: payload.session,
        });
        await reply.code(200).send({ ok: true, status: 'unknown_session' });
        return;
      }

      // ── 5. Find active research session ────────────────────────────
      // We look for a running/waiting_response session on this phone
      // targeting the sender's number.
      const fromNumber = payload.from.replace(/@c\.us$/, '');
      const activeSession = await prisma.researchSession.findFirst({
        where: {
          phoneId: phone.id,
          status: { in: ['running', 'waiting_response'] },
          target: { phoneNumber: fromNumber },
        },
        select: { id: true, currentTurn: true, targetId: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!activeSession) {
        logger.info('research webhook: no active session for sender', {
          component: 'research-webhook',
          session: payload.session,
          from: fromNumber,
        });
        await reply.code(200).send({ ok: true, status: 'no_active_session' });
        return;
      }

      const messageText = payload.body;
      const turnOrder = activeSession.currentTurn + 1;

      // ── 6. Delegate to runner (when available) ────────────────────
      if (deps.researchRunner) {
        try {
          await deps.researchRunner.handleInbound({
            sessionId: activeSession.id as ResearchSessionId,
            turnOrder,
            wahaMessageId: payload.id,
            text: messageText,
            timestamp: payload.timestamp,
            targetId: activeSession.targetId,
          });
        } catch (e) {
          const isUniqueViolation =
            e instanceof Error && e.message.includes('Unique constraint');
          if (isUniqueViolation) {
            await reply.code(200).send({ ok: true, status: 'already_processed' });
            return;
          }
          throw e;
        }

        await phoneRepo.updateLastSeen(phone.id as import('@/research/types.js').ResearchPhoneId);
        await reply.code(200).send({ ok: true, status: 'processed' });
        return;
      }

      // ── 6b. Fallback (no runner — Redis unavailable) ──────────────
      if (isOptOutMessage(messageText)) {
        logger.info('research webhook: opt-out detected (no-runner fallback)', {
          component: 'research-webhook',
          sessionId: activeSession.id,
          targetId: activeSession.targetId,
        });

        await prisma.$transaction([
          prisma.researchSession.update({
            where: { id: activeSession.id },
            data: {
              status: 'aborted',
              failedAt: new Date(),
              failCode: 'OPT_OUT_DETECTED',
              failReason: 'Opt-out keyword detected',
            },
          }),
          prisma.researchTarget.update({
            where: { id: activeSession.targetId },
            data: {
              optedOutAt: new Date(),
              optedOutReason: messageText.slice(0, 500),
              status: 'banned',
            },
          }),
        ]);

        await reply.code(200).send({ ok: true, status: 'opt_out_recorded' });
        return;
      }

      try {
        await prisma.researchTurn.create({
          data: {
            sessionId: activeSession.id,
            turnOrder,
            direction: 'inbound',
            message: messageText,
            wahaMessageId: payload.id,
          },
        });
      } catch (e) {
        const isUniqueViolation =
          e instanceof Error && e.message.includes('Unique constraint');
        if (isUniqueViolation) {
          await reply.code(200).send({ ok: true, status: 'already_processed' });
          return;
        }
        throw e;
      }

      await phoneRepo.updateLastSeen(phone.id as import('@/research/types.js').ResearchPhoneId);

      logger.info('research webhook: turn persisted (no-runner fallback)', {
        component: 'research-webhook',
        sessionId: activeSession.id,
        turnOrder,
        wahaMessageId: payload.id,
      });

      await reply.code(200).send({ ok: true, status: 'processed' });
    },
  );
}

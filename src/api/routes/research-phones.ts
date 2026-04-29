/**
 * Phone Manager routes — CRUD for research SIMs (WAHA sessions).
 *
 * All routes require super_admin access (enforced via requireSuperAdmin hook
 * applied at plugin scope — not per-route to avoid hook bleed).
 *
 * WAHA credentials: read from env vars in dev; set via Dokploy secrets in prod.
 *   WAHA_RESEARCH_URL=http://localhost:3010
 *   WAHA_RESEARCH_API_KEY=<key>
 *   WAHA_WEBHOOK_HMAC_SECRET=<secret>
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { requireSuperAdmin } from '@/research/compliance/super-admin-guard.js';
import { createWahaResearchClient } from '@/research/waha-research-client.js';
import { createResearchPhoneRepository } from '@/research/repositories/phone-repository.js';
import { createResearchAuditLogRepository } from '@/research/repositories/audit-log-repository.js';
import type { ResearchPhoneId } from '@/research/types.js';

// ─── Schemas ────────────────────────────────────────────────────────

const CreatePhoneSchema = z.object({
  label: z.string().min(1).max(50),
  notes: z.string().max(500).optional(),
});

// ─── Route Registration ─────────────────────────────────────────────

export function researchPhonesRoutes(fastify: FastifyInstance, deps: RouteDependencies): void {
  const { prisma, logger } = deps;

  const phoneRepo = createResearchPhoneRepository(prisma);
  const auditRepo = createResearchAuditLogRepository(prisma);

  const wahaBaseUrl = process.env['WAHA_RESEARCH_URL'] ?? 'http://localhost:3010';
  const wahaApiKey = process.env['WAHA_RESEARCH_API_KEY'] ?? '';
  const webhookHmacSecret = process.env['WAHA_WEBHOOK_HMAC_SECRET'] ?? '';
  const publicApiUrl = process.env['PUBLIC_API_URL'] ?? 'http://localhost:3002';

  const wahaClient = createWahaResearchClient({
    baseUrl: wahaBaseUrl,
    apiKey: wahaApiKey,
    logger,
  });

  // Apply super_admin guard to all routes in this plugin scope
  fastify.addHook('preHandler', requireSuperAdmin({ logger }));

  // ─── GET /research/phones ──────────────────────────────────────
  fastify.get('/research/phones', async (_request: FastifyRequest, reply: FastifyReply) => {
    const [phones, sessionsResult] = await Promise.all([
      phoneRepo.findAll(),
      wahaClient.listSessions(),
    ]);

    // Build live status map from WAHA (best-effort — failures don't block list)
    const liveStatus = new Map<string, string>();
    if (sessionsResult.ok) {
      for (const s of sessionsResult.value) {
        liveStatus.set(s.name, s.status);
      }
    }

    const data = phones.map((p) => ({
      ...p,
      wahaStatus: liveStatus.get(p.wahaSession) ?? null,
    }));

    await sendSuccess(reply, data);
  });

  // ─── POST /research/phones ─────────────────────────────────────
  fastify.post('/research/phones', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreatePhoneSchema.safeParse(request.body);
    if (!parsed.success) {
      await sendError(reply, 'VALIDATION_ERROR', 'Invalid request body', 400, {
        issues: parsed.error.issues,
      });
      return;
    }

    const { label, notes } = parsed.data;
    // wahaSession name derived from label (lowercase, alphanumeric-dash only)
    const wahaSession = label.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const actorEmail = request.superAdminEmail ?? 'system';

    // 1. Create WAHA session
    const sessionResult = await wahaClient.createSession(wahaSession);
    if (!sessionResult.ok) {
      logger.error('failed to create WAHA session', {
        component: 'research-phones',
        label,
        wahaSession,
        error: sessionResult.error.message,
      });
      await sendError(reply, sessionResult.error.researchCode, sessionResult.error.message, 502);
      return;
    }

    // 2. Persist to DB
    const phone = await phoneRepo.create({
      label,
      wahaSession,
      notes,
      createdBy: actorEmail,
    });

    // 3. Configure WAHA webhook (best-effort — phone is created regardless)
    if (webhookHmacSecret) {
      const webhookUrl = `${publicApiUrl}/api/v1/research/webhook/waha`;
      const webhookResult = await wahaClient.configureWebhook(wahaSession, webhookUrl, webhookHmacSecret);
      if (!webhookResult.ok) {
        logger.warn('webhook config failed (non-fatal)', {
          component: 'research-phones',
          wahaSession,
          error: webhookResult.error.message,
        });
      }
    }

    // 4. Audit log
    await auditRepo.log({
      actorEmail,
      action: 'phone.create',
      entityType: 'ResearchPhone',
      entityId: phone.id,
      payload: { label, wahaSession },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    await sendSuccess(reply, phone, 201);
  });

  // ─── GET /research/phones/:id/qr ──────────────────────────────
  fastify.get(
    '/research/phones/:id/qr',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const phone = await phoneRepo.findById(request.params.id as ResearchPhoneId);
      if (!phone) {
        await sendNotFound(reply, 'ResearchPhone', request.params.id);
        return;
      }

      const result = await wahaClient.getSessionQR(phone.wahaSession);
      if (!result.ok) {
        await sendError(reply, result.error.researchCode, result.error.message, 502);
        return;
      }

      await sendSuccess(reply, result.value);
    },
  );

  // ─── GET /research/phones/:id/status ─────────────────────────
  fastify.get(
    '/research/phones/:id/status',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const phone = await phoneRepo.findById(request.params.id as ResearchPhoneId);
      if (!phone) {
        await sendNotFound(reply, 'ResearchPhone', request.params.id);
        return;
      }

      const result = await wahaClient.getSessionStatus(phone.wahaSession);
      if (!result.ok) {
        await sendError(reply, result.error.researchCode, result.error.message, 502);
        return;
      }

      // Update DB status + lastSeen when WORKING
      if (result.value.status === 'WORKING' && phone.status !== 'active') {
        await phoneRepo.updateStatus(phone.id as ResearchPhoneId, { status: 'active' });
        await phoneRepo.updateLastSeen(phone.id as ResearchPhoneId);
      }

      await sendSuccess(reply, { ...result.value, phoneId: phone.id });
    },
  );

  // ─── POST /research/phones/:id/refresh ───────────────────────
  fastify.post(
    '/research/phones/:id/refresh',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const phone = await phoneRepo.findById(request.params.id as ResearchPhoneId);
      if (!phone) {
        await sendNotFound(reply, 'ResearchPhone', request.params.id);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'system';

      // Stop existing session (best-effort)
      await wahaClient.stopSession(phone.wahaSession);

      // Re-create session
      const result = await wahaClient.createSession(phone.wahaSession);
      if (!result.ok) {
        await sendError(reply, result.error.researchCode, result.error.message, 502);
        return;
      }

      // Re-configure webhook
      if (webhookHmacSecret) {
        const webhookUrl = `${publicApiUrl}/api/v1/research/webhook/waha`;
        await wahaClient.configureWebhook(phone.wahaSession, webhookUrl, webhookHmacSecret);
      }

      // Update status to pending (needs new QR scan)
      const updated = await phoneRepo.updateStatus(phone.id as ResearchPhoneId, { status: 'pending' });

      await auditRepo.log({
        actorEmail,
        action: 'phone.refresh',
        entityType: 'ResearchPhone',
        entityId: phone.id,
        payload: { wahaSession: phone.wahaSession },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      await sendSuccess(reply, updated);
    },
  );

  // ─── DELETE /research/phones/:id ─────────────────────────────
  fastify.delete(
    '/research/phones/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const phone = await phoneRepo.findById(request.params.id as ResearchPhoneId);
      if (!phone) {
        await sendNotFound(reply, 'ResearchPhone', request.params.id);
        return;
      }

      const actorEmail = request.superAdminEmail ?? 'system';

      // Stop WAHA session (best-effort — delete from DB regardless)
      const stopResult = await wahaClient.stopSession(phone.wahaSession);
      if (!stopResult.ok) {
        logger.warn('WAHA stopSession failed during delete (continuing)', {
          component: 'research-phones',
          wahaSession: phone.wahaSession,
          error: stopResult.error.message,
        });
      }

      await phoneRepo.delete(phone.id as ResearchPhoneId);

      await auditRepo.log({
        actorEmail,
        action: 'phone.delete',
        entityType: 'ResearchPhone',
        entityId: phone.id,
        payload: { label: phone.label, wahaSession: phone.wahaSession },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      await sendSuccess(reply, { deleted: true });
    },
  );
}

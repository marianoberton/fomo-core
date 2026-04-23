/**
 * Project-access guards for routes whose URL parameter is NOT a projectId.
 *
 * The hook registered in `src/api/project-access.ts` covers routes like
 * `/projects/:projectId/...` by inspecting `request.params.projectId`.
 * Routes like `/sessions/:id`, `/traces/:id`, `/approvals/:id` have no
 * projectId in the URL, so we must look up the entity's owning projectId
 * before enforcing the scope.
 *
 * These helpers are designed to be called inline at the top of a route
 * handler (or registered as a `preHandler`). They send a 403/404 response
 * and throw on denial so the handler short-circuits.
 *
 * Usage:
 *   await requireSessionAccess(request, reply, request.params.id, prisma);
 *   // Handler continues only if the request's API key has access.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';

// ─── Errors ────────────────────────────────────────────────────

export class ProjectAccessDeniedError extends Error {
  constructor(message = 'forbidden') {
    super(message);
    this.name = 'ProjectAccessDeniedError';
  }
}

export class ResourceNotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} "${id}" not found`);
    this.name = 'ResourceNotFoundError';
  }
}

// ─── Core Guard ────────────────────────────────────────────────

/**
 * Assert that the request's API key is allowed to access the given projectId.
 *
 * - Master keys (apiKeyProjectId === null) pass always.
 * - Unauthenticated requests (apiKeyProjectId === undefined) pass — auth may
 *   be disabled, and the upstream middleware would have already rejected.
 * - Scoped keys must match `projectId` exactly; otherwise a 403 is sent and
 *   `ProjectAccessDeniedError` is thrown.
 */
export async function requireProjectAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string,
): Promise<void> {
  const keyProjectId = request.apiKeyProjectId;
  if (keyProjectId === null || keyProjectId === undefined) return;
  if (keyProjectId === projectId) return;

  await reply.code(403).send({
    success: false,
    error: {
      code: 'PROJECT_ACCESS_DENIED',
      message: 'API key does not have access to this project',
    },
  });
  throw new ProjectAccessDeniedError();
}

// ─── Lookup Guards ─────────────────────────────────────────────

/**
 * Look up a session's projectId and enforce access. Throws
 * `ResourceNotFoundError` (404) if the session does not exist.
 */
export async function requireSessionAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  sessionId: string,
  prisma: PrismaClient,
): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { projectId: true },
  });

  if (!session) {
    await reply.code(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `Session "${sessionId}" not found` },
    });
    throw new ResourceNotFoundError('Session', sessionId);
  }

  await requireProjectAccess(request, reply, session.projectId);
}

/**
 * Look up an approval's projectId and enforce access. Throws
 * `ResourceNotFoundError` (404) if the approval does not exist.
 */
export async function requireApprovalAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  approvalId: string,
  prisma: PrismaClient,
): Promise<void> {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
    select: { projectId: true },
  });

  if (!approval) {
    await reply.code(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `ApprovalRequest "${approvalId}" not found` },
    });
    throw new ResourceNotFoundError('ApprovalRequest', approvalId);
  }

  await requireProjectAccess(request, reply, approval.projectId);
}

/**
 * Look up a trace's projectId and enforce access. Throws
 * `ResourceNotFoundError` (404) if the trace does not exist.
 */
export async function requireTraceAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  traceId: string,
  prisma: PrismaClient,
): Promise<void> {
  const trace = await prisma.executionTrace.findUnique({
    where: { id: traceId },
    select: { projectId: true },
  });

  if (!trace) {
    await reply.code(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `ExecutionTrace "${traceId}" not found` },
    });
    throw new ResourceNotFoundError('ExecutionTrace', traceId);
  }

  await requireProjectAccess(request, reply, trace.projectId);
}

/**
 * Look up a client's projectId and enforce access.
 * Throws `ResourceNotFoundError` (404) if the client does not exist.
 */
export async function requireClientAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  clientId: string,
  prisma: PrismaClient,
): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { projectId: true },
  });

  if (!client) {
    await reply.code(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `Client "${clientId}" not found` },
    });
    throw new ResourceNotFoundError('Client', clientId);
  }

  await requireProjectAccess(request, reply, client.projectId);
}

/**
 * Look up a contact's projectId and enforce access.
 */
export async function requireContactAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  contactId: string,
  prisma: PrismaClient,
): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { projectId: true },
  });

  if (!contact) {
    await reply.code(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `Contact "${contactId}" not found` },
    });
    throw new ResourceNotFoundError('Contact', contactId);
  }

  await requireProjectAccess(request, reply, contact.projectId);
}

/**
 * Look up an agent's projectId and enforce access.
 */
export async function requireAgentAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  agentId: string,
  prisma: PrismaClient,
): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { projectId: true },
  });

  if (!agent) {
    await reply.code(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `Agent "${agentId}" not found` },
    });
    throw new ResourceNotFoundError('Agent', agentId);
  }

  await requireProjectAccess(request, reply, agent.projectId);
}

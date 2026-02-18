/**
 * Route registration — registers all API route plugins with Fastify.
 */
import type { FastifyInstance } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { projectRoutes } from './projects.js';
import { sessionRoutes } from './sessions.js';
import { promptLayerRoutes } from './prompt-layers.js';
import { traceRoutes } from './traces.js';
import { approvalRoutes } from './approvals.js';
import { toolRoutes } from './tools.js';
import { chatRoutes } from './chat.js';
import { chatStreamRoutes } from './chat-stream.js';
import { scheduledTaskRoutes } from './scheduled-tasks.js';
import { contactRoutes } from './contacts.js';
import { webhookRoutes } from './webhooks.js';
import { webhookGenericRoutes } from './webhooks-generic.js';
import { fileRoutes } from './files.js';
import { agentRoutes } from './agents.js';
import { dashboardRoutes } from './dashboard.js';
import { usageRoutes } from './usage.js';
import { wsDashboardRoutes } from './ws-dashboard.js';
import { catalogRoutes } from './catalog.js';
import { templateRoutes } from './templates.js';
import { secretRoutes } from './secrets.js';
import { knowledgeRoutes } from './knowledge.js';

/** Register all API routes on the Fastify instance. */
export async function registerRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): Promise<void> {
  await fastify.register(projectRoutes, deps);
  await fastify.register(sessionRoutes, deps);
  await fastify.register(promptLayerRoutes, deps);
  await fastify.register(traceRoutes, deps);
  await fastify.register(approvalRoutes, deps);
  await fastify.register(toolRoutes, deps);
  await fastify.register(chatRoutes, deps);
  await fastify.register(chatStreamRoutes, deps);
  await fastify.register(scheduledTaskRoutes, deps);
  await fastify.register(contactRoutes, deps);
  await fastify.register(webhookRoutes, deps);
  await fastify.register(webhookGenericRoutes, deps);
  await fastify.register(fileRoutes, deps);
  await fastify.register(agentRoutes, deps);
  await fastify.register(dashboardRoutes, deps);
  await fastify.register(usageRoutes, deps);
  await fastify.register(wsDashboardRoutes, deps);
  await fastify.register(catalogRoutes, deps);
  await fastify.register(templateRoutes, deps);
  await fastify.register(secretRoutes, deps);
  await fastify.register(knowledgeRoutes, deps);
}

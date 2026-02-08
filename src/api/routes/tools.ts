/**
 * Tool routes — list registered tools and their metadata.
 */
import type { FastifyInstance } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';

// ─── Types ──────────────────────────────────────────────────────

/** Public-facing tool info (excludes schemas and implementation details). */
interface ToolInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  riskLevel: string;
  requiresApproval: boolean;
  sideEffects: boolean;
}

// ─── Route Plugin ───────────────────────────────────────────────

/** Register tool listing routes. */
export function toolRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { toolRegistry } = deps;

  // GET /tools — list all registered tools
  fastify.get('/tools', async (_request, reply) => {
    const toolIds = toolRegistry.listAll();
    const tools: ToolInfo[] = [];

    for (const id of toolIds) {
      const tool = toolRegistry.get(id);
      if (tool) {
        tools.push({
          id: tool.id,
          name: tool.name,
          description: tool.description,
          category: tool.category,
          riskLevel: tool.riskLevel,
          requiresApproval: tool.requiresApproval,
          sideEffects: tool.sideEffects,
        });
      }
    }

    return sendSuccess(reply, tools);
  });

  // GET /tools/:id — get a single tool's info
  fastify.get<{ Params: { id: string } }>('/tools/:id', async (request, reply) => {
    const tool = toolRegistry.get(request.params.id);
    if (!tool) return sendNotFound(reply, 'Tool', request.params.id);

    const info: ToolInfo = {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      riskLevel: tool.riskLevel,
      requiresApproval: tool.requiresApproval,
      sideEffects: tool.sideEffects,
    };

    return sendSuccess(reply, info);
  });
}

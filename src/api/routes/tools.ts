/**
 * Tool routes — full catalog API for the UI tool picker.
 * Provides metadata + JSON schemas for all registered tools,
 * and per-agent tool management (toggle on/off).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendNotFound } from '../error-handler.js';
import type { AgentId } from '@/agents/types.js';

// ─── Types ──────────────────────────────────────────────────────

/** Full tool catalog entry for UI display. */
interface ToolCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  riskLevel: string;
  requiresApproval: boolean;
  sideEffects: boolean;
  supportsDryRun: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────

function toZodJsonSchema(zodSchema: import('zod').ZodType): Record<string, unknown> {
  return zodToJsonSchema(zodSchema, { target: 'openApi3' }) as Record<string, unknown>;
}

function buildCatalogEntry(tool: {
  id: string;
  name: string;
  description: string;
  category: string;
  riskLevel: string;
  requiresApproval: boolean;
  sideEffects: boolean;
  supportsDryRun: boolean;
  inputSchema: import('zod').ZodType;
  outputSchema?: import('zod').ZodType;
}): ToolCatalogEntry {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    riskLevel: tool.riskLevel,
    requiresApproval: tool.requiresApproval,
    sideEffects: tool.sideEffects,
    supportsDryRun: tool.supportsDryRun,
    inputSchema: toZodJsonSchema(tool.inputSchema),
    outputSchema: tool.outputSchema ? toZodJsonSchema(tool.outputSchema) : undefined,
  };
}

// ─── Route Plugin ────────────────────────────────────────────────

/** Register tool catalog and per-agent tool management routes. */
export function toolRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { toolRegistry, agentRepository } = deps;

  // ─── GET /tools ─────────────────────────────────────────────────
  // Full catalog with JSON schemas for every registered tool

  fastify.get('/tools', async (_request: FastifyRequest, reply: FastifyReply) => {
    const catalog = toolRegistry.listAll()
      .map((id) => toolRegistry.get(id))
      .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined)
      .map(buildCatalogEntry);

    await sendSuccess(reply, catalog);
  });

  // ─── GET /tools/categories ──────────────────────────────────────
  // Tools grouped by category — useful for UI category pickers

  fastify.get('/tools/categories', async (_request: FastifyRequest, reply: FastifyReply) => {
    const byCategory = new Map<string, ToolCatalogEntry[]>();

    for (const id of toolRegistry.listAll()) {
      const tool = toolRegistry.get(id);
      if (!tool) continue;

      const entry = buildCatalogEntry(tool);
      const existing = byCategory.get(tool.category);
      if (existing) {
        existing.push(entry);
      } else {
        byCategory.set(tool.category, [entry]);
      }
    }

    const result = [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, tools]) => ({ category, tools }));

    await sendSuccess(reply, result);
  });

  // ─── GET /tools/:id ─────────────────────────────────────────────
  // Single tool detail with full schemas

  fastify.get<{ Params: { id: string } }>(
    '/tools/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tool = toolRegistry.get(request.params.id);
      if (!tool) return sendNotFound(reply, 'Tool', request.params.id);
      await sendSuccess(reply, buildCatalogEntry(tool));
    },
  );

  // ─── GET /agents/:agentId/tools ─────────────────────────────────
  // Returns the full catalog entries for tools enabled on a specific agent

  fastify.get(
    '/agents/:agentId/tools',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      const agent = await agentRepository.findById(agentId as AgentId);
      if (!agent) return sendNotFound(reply, 'Agent', agentId);

      const allToolIds = toolRegistry.listAll();
      const enabledTools = agent.toolAllowlist
        .map((id) => toolRegistry.get(id))
        .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined)
        .map(buildCatalogEntry);

      const disabledToolIds = allToolIds.filter((id) => !agent.toolAllowlist.includes(id));

      await sendSuccess(reply, {
        agentId,
        enabledTools,
        disabledToolIds,
      });
    },
  );

  // ─── PUT /agents/:agentId/tools ─────────────────────────────────
  // Set the tool allowlist for an agent (full replace)

  const updateToolsSchema = z.object({
    tools: z.array(z.string()),
  });

  fastify.put(
    '/agents/:agentId/tools',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      const agent = await agentRepository.findById(agentId as AgentId);
      if (!agent) return sendNotFound(reply, 'Agent', agentId);

      const body = updateToolsSchema.parse(request.body);

      // Validate all requested tool IDs are registered
      const unknownTools = body.tools.filter((id) => !toolRegistry.has(id));
      if (unknownTools.length > 0) {
        await sendSuccess(reply, {
          error: 'UNKNOWN_TOOLS',
          unknownTools,
          message: `The following tool IDs are not registered: ${unknownTools.join(', ')}`,
        });
        return;
      }

      const updated = await agentRepository.update(agentId as AgentId, {
        toolAllowlist: body.tools,
      });

      await sendSuccess(reply, {
        agentId,
        toolAllowlist: updated.toolAllowlist,
      });
    },
  );
}

/**
 * control-agent tool
 * Owner can pause, resume, or inspect agents via WhatsApp command.
 * Example: "Pausá el agente de ventas" or "¿Cuál es el estado del agente de soporte?"
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import type { AgentRegistry } from '@/agents/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  agentId: z.string().min(1).describe('Agent ID or agent name to control'),
  action: z.enum(['pause', 'resume', 'get_status', 'get_recent_activity'])
    .describe('Action to perform on the agent'),
});

const outputSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  action: z.string(),
  previousStatus: z.string().optional(),
  currentStatus: z.string(),
  activeSessions: z.number().optional(),
  recentActivity: z.object({
    sessionsLast24h: z.number(),
    messagesLast24h: z.number(),
  }).optional(),
  message: z.string(),
});

// ─── Options ────────────────────────────────────────────────────

export interface ControlAgentToolOptions {
  prisma: PrismaClient;
  agentRegistry: AgentRegistry;
}

// ─── Factory ────────────────────────────────────────────────────

export function createControlAgentTool(
  options: ControlAgentToolOptions,
): ExecutableTool {
  const { prisma, agentRegistry } = options;

  return {
    id: 'control-agent',
    name: 'Control Agent',
    description:
      'Pause, resume, or inspect the status of an agent in the project. Use this when the owner wants to stop an agent temporarily, reactivate it, or check what it\'s currently doing. Accepts agent ID or name.',
    category: 'orchestration',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        agentId: string;
        action: 'pause' | 'resume' | 'get_status' | 'get_recent_activity';
      };
      const projectId = context.projectId as string;

      try {
        // Try to find agent by ID first, then by name
        let agent = await prisma.agent.findFirst({
          where: { id: data.agentId, projectId },
        });

        if (!agent) {
          // Try by name (case-insensitive)
          const byName = await agentRegistry.getByName(projectId, data.agentId);
          if (byName) {
            agent = await prisma.agent.findUnique({ where: { id: byName.id } });
          }
        }

        if (!agent) {
          return err(new ToolExecutionError(
            'control-agent',
            `Agent "${data.agentId}" not found in project`,
          ));
        }

        const previousStatus = agent.status;
        let currentStatus = agent.status;
        let message = '';

        if (data.action === 'pause') {
          if (agent.status === 'paused') {
            message = `⚠️ El agente "${agent.name}" ya estaba pausado.`;
          } else {
            await prisma.agent.update({
              where: { id: agent.id },
              data: { status: 'paused' },
            });
            currentStatus = 'paused';
            message = `⏸️ Agente "${agent.name}" pausado correctamente.`;
          }
        } else if (data.action === 'resume') {
          if (agent.status === 'active') {
            message = `⚠️ El agente "${agent.name}" ya estaba activo.`;
          } else {
            await prisma.agent.update({
              where: { id: agent.id },
              data: { status: 'active' },
            });
            currentStatus = 'active';
            message = `▶️ Agente "${agent.name}" reactivado correctamente.`;
          }
        } else {
          // get_status or get_recent_activity
          message = `📊 Estado del agente "${agent.name}": ${agent.status}`;
        }

        // Active sessions count
        const activeSessions = await prisma.session.count({
          where: { agentId: agent.id, projectId, status: 'active' },
        });

        // Recent activity (last 24h)
        let recentActivity: { sessionsLast24h: number; messagesLast24h: number } | undefined;

        if (data.action === 'get_recent_activity' || data.action === 'get_status') {
          const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const [sessionsLast24h, messagesLast24h] = await Promise.all([
            prisma.session.count({
              where: { agentId: agent.id, projectId, createdAt: { gte: since24h } },
            }),
            prisma.message.count({
              where: {
                session: { agentId: agent.id, projectId },
                createdAt: { gte: since24h },
              },
            }),
          ]);
          recentActivity = { sessionsLast24h, messagesLast24h };

          if (data.action === 'get_recent_activity') {
            message = `📊 Agente "${agent.name}" — últimas 24h: ${sessionsLast24h} conversaciones, ${messagesLast24h} mensajes.`;
          }
        }

        const output = {
          agentId: agent.id,
          agentName: agent.name,
          action: data.action,
          previousStatus: data.action === 'pause' || data.action === 'resume' ? previousStatus : undefined,
          currentStatus,
          activeSessions,
          recentActivity,
          message,
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'control-agent',
          error instanceof Error ? error.message : 'Unknown error controlling agent',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const data = inputSchema.parse(input) as { agentId: string; action: string };

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would ${data.action} agent "${data.agentId}"`,
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}

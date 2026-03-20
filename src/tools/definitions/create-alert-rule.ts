/**
 * create-alert-rule tool
 * Owner can set up monitoring alerts via WhatsApp command.
 * Example: "Notify me when a lead score is above 80" or "Alert me if someone mentions urgent".
 *
 * Alert rules are stored in project metadata and evaluated by the Manager Agent
 * during its monitoring cycles or when processing relevant events.
 */
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  name: z.string().min(1).describe('Alert name, e.g. "Lead alto valor"'),
  condition: z.enum([
    'lead_score_above',
    'keyword_detected',
    'customer_angry',
    'agent_error',
    'no_response_timeout',
  ]).describe('Condition type that triggers the alert'),
  threshold: z.number().optional()
    .describe('Numeric threshold for score-based conditions (e.g. 80 for lead_score_above)'),
  keywords: z.array(z.string()).optional()
    .describe('Keywords to watch for in conversations (for keyword_detected condition)'),
  notifyVia: z.enum(['whatsapp', 'email', 'both']).default('whatsapp')
    .describe('How to notify when alert triggers'),
  notifyTo: z.string().describe('Phone number (with country code) or email address to notify'),
  active: z.boolean().default(true).describe('Whether the alert is active immediately'),
});

const outputSchema = z.object({
  alertId: z.string(),
  name: z.string(),
  condition: z.string(),
  threshold: z.number().optional(),
  keywords: z.array(z.string()).optional(),
  notifyVia: z.string(),
  notifyTo: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  message: z.string(),
});

// ─── Options ────────────────────────────────────────────────────

export interface CreateAlertRuleToolOptions {
  prisma: PrismaClient;
}

// ─── Factory ────────────────────────────────────────────────────

export function createAlertRuleTool(
  options: CreateAlertRuleToolOptions,
): ExecutableTool {
  const { prisma } = options;

  return {
    id: 'create-alert-rule',
    name: 'Create Alert Rule',
    description:
      'Create a monitoring alert rule for the project. The owner can set conditions like "notify me when a lead score exceeds 80" or "alert me if a customer mentions urgency". Alerts are stored and evaluated during agent monitoring cycles.',
    category: 'orchestration',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: true,
    supportsDryRun: true,

    async execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        name: string;
        condition: string;
        threshold?: number;
        keywords?: string[];
        notifyVia: string;
        notifyTo: string;
        active: boolean;
      };
      const projectId = context.projectId as string;

      try {
        // Store alert rule in project memory (using MemoryEntry with a special key)
        const alertId = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const alertData = {
          alertId,
          name: data.name,
          condition: data.condition,
          threshold: data.threshold,
          keywords: data.keywords,
          notifyVia: data.notifyVia,
          notifyTo: data.notifyTo,
          active: data.active,
          createdAt: new Date().toISOString(),
          projectId,
        };

        // Persist as a memory entry so it survives restarts
        await prisma.memoryEntry.create({
          data: {
            id: alertId,
            projectId,
            agentId: context.agentId,
            scope: 'project',
            category: 'alert_rule',
            content: JSON.stringify(alertData),
            importance: 1.0,
            metadata: alertData as unknown as Prisma.InputJsonValue,
          },
        });

        const conditionDescriptions: Record<string, string> = {
          lead_score_above: `cuando un lead supere el puntaje de ${data.threshold ?? 'N/A'}`,
          keyword_detected: `cuando se detecten las palabras: ${(data.keywords ?? []).join(', ')}`,
          customer_angry: 'cuando un cliente muestre señales de enojo o frustración',
          agent_error: 'cuando un agente encuentre un error crítico',
          no_response_timeout: 'cuando una conversación quede sin respuesta por demasiado tiempo',
        };

        const conditionDesc = conditionDescriptions[data.condition] ?? data.condition;
        const notifyDesc = data.notifyVia === 'both'
          ? `por WhatsApp y email a ${data.notifyTo}`
          : `por ${data.notifyVia} a ${data.notifyTo}`;

        const output = {
          ...alertData,
          message: `✅ Alerta "${data.name}" creada. Te voy a notificar ${conditionDesc}, ${notifyDesc}.${data.active ? '' : ' (inactiva por ahora)'}`,
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'create-alert-rule',
          error instanceof Error ? error.message : 'Unknown error creating alert rule',
        ));
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        name: string;
        condition: string;
        notifyVia: string;
        notifyTo: string;
        active: boolean;
      };

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would create alert rule "${data.name}" (${data.condition}) → notify via ${data.notifyVia} to ${data.notifyTo}`,
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}

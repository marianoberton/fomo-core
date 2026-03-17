/**
 * Fomo-Agent Skill — OpenClaw skill that invokes fomo-core agents via HTTP.
 *
 * Installed on OpenClaw Manager instances. When the Manager decides to
 * delegate a task (e.g. "Elena, qualify this lead"), it calls this skill
 * which POSTs to fomo-core's /api/v1/agents/:agentId/invoke endpoint.
 *
 * @example
 * ```ts
 * const skill = createFomoAgentSkill({
 *   fomoCorBaseUrl: 'http://localhost:3002',
 *   fomoApiKey: process.env.FOMO_CORE_API_KEY,
 *   timeoutMs: 60_000,
 * });
 *
 * const result = await skill.invoke({
 *   agentId: 'agent_elena_123',
 *   message: 'Qualify this lead: Juan Perez, +5491112345678',
 * });
 * ```
 */
import {
  FomoAgentInvokeInputSchema,
  FomoAgentInvokeOutputSchema,
} from './types.js';
import type {
  FomoAgentInvokeInput,
  FomoAgentInvokeOutput,
  FomoAgentSkillConfig,
} from './types.js';

// ─── Types ───────────────────────────────────────────────────────

/** Result envelope matching fomo-core's ApiResponse<T>. */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

/** Dependencies for the fomo-agent skill. */
export interface FomoAgentSkillDeps {
  /** Base URL of the fomo-core API (e.g. "http://localhost:3002"). */
  fomoCorBaseUrl: string;
  /** API key for authenticating with fomo-core (Bearer token). */
  fomoApiKey: string;
  /** Request timeout in milliseconds (default: 60000). */
  timeoutMs?: number;
}

/** The fomo-agent skill interface. */
export interface FomoAgentSkill {
  /** Invoke a fomo-core agent with a message/task. */
  invoke(input: FomoAgentInvokeInput): Promise<FomoAgentInvokeOutput>;
}

// ─── Factory ─────────────────────────────────────────────────────

/**
 * Create a fomo-agent skill instance.
 *
 * @param deps - Connection configuration for fomo-core.
 * @returns A skill that can invoke fomo-core agents via HTTP.
 */
export function createFomoAgentSkill(deps: FomoAgentSkillDeps): FomoAgentSkill {
  const { fomoCorBaseUrl, fomoApiKey, timeoutMs = 60_000 } = deps;

  // Strip trailing slash from base URL
  const baseUrl = fomoCorBaseUrl.replace(/\/+$/, '');

  return {
    async invoke(input: FomoAgentInvokeInput): Promise<FomoAgentInvokeOutput> {
      // Validate input
      const parsed = FomoAgentInvokeInputSchema.parse(input);

      const url = `${baseUrl}/api/v1/agents/${encodeURIComponent(parsed.agentId)}/invoke`;

      const body = JSON.stringify({
        message: parsed.message,
        sessionId: parsed.sessionId,
        sourceChannel: parsed.sourceChannel,
        contactRole: parsed.contactRole,
        metadata: parsed.metadata,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${fomoApiKey}`,
          },
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `fomo-core invoke failed (HTTP ${response.status}): ${errorBody}`,
          );
        }

        const json = (await response.json()) as ApiResponse<unknown>;

        if (!json.success || !json.data) {
          const errMsg = json.error?.message ?? 'Unknown error from fomo-core';
          throw new Error(`fomo-core invoke error: ${errMsg}`);
        }

        // Validate response shape
        const output = FomoAgentInvokeOutputSchema.parse(json.data);
        return output;
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

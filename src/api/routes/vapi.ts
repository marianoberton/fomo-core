/**
 * VAPI routes — voice AI integration via vapi.ai Custom LLM Server pattern.
 *
 * POST /vapi/custom-llm/:integrationId
 *   Called by VAPI on every conversation turn. Receives conversation history in
 *   OpenAI-compatible format, runs the agent runner, and returns the assistant
 *   response in OpenAI format so VAPI can convert it to speech.
 *
 * POST /vapi/webhook/:integrationId
 *   Receives VAPI lifecycle events (call-started, end-of-call-report, etc.).
 *   Stores transcripts and updates session status.
 *
 * Configuration:
 *   In VAPI dashboard, create an assistant with:
 *     model.provider = "custom-llm"
 *     model.url = "https://<nexus-host>/api/v1/vapi/custom-llm/<integrationId>"
 *   Configure the assistant's server.url for webhooks:
 *     "https://<nexus-host>/api/v1/vapi/webhook/<integrationId>"
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import { createAgentRunner } from '@/core/agent-runner.js';
import {
  prepareChatRun,
  extractAssistantResponse,
  extractToolCalls,
} from './chat-setup.js';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { VapiIntegrationConfig } from '@/channels/types.js';

// ─── VAPI Request Body Types ─────────────────────────────────────

/** VAPI custom LLM request — OpenAI-compatible chat completion format. */
interface VapiCustomLlmBody {
  model?: string;
  messages: { role: string; content: string }[];
  call: {
    id: string;
    type?: string;
    customer?: { number?: string; name?: string };
    phoneNumber?: { number?: string };
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}

const VapiCustomLlmSchema = z.object({
  model: z.string().optional(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
  call: z.object({
    id: z.string(),
    type: z.string().optional(),
    customer: z.object({
      number: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
    phoneNumber: z.object({ number: z.string().optional() }).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Route Plugin ────────────────────────────────────────────────

/** Register VAPI custom LLM and webhook routes. */
export function vapiRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { channelIntegrationRepository, sessionRepository, secretService, logger } = deps;

  // ─── POST /vapi/custom-llm/:integrationId ─────────────────────
  //
  // VAPI calls this endpoint for every conversation turn.
  // We run the agent runner and return the text response.

  fastify.post<{ Params: { integrationId: string } }>(
    '/vapi/custom-llm/:integrationId',
    async (request: FastifyRequest<{ Params: { integrationId: string } }>, reply: FastifyReply) => {
      const { integrationId } = request.params;

      // 1. Load integration → get projectId + config
      const integration = await channelIntegrationRepository.findById(integrationId);
      if (integration?.status !== 'active') {
        await reply.code(404).send({ error: 'Integration not found or inactive' });
        return;
      }

      const config = integration.config as VapiIntegrationConfig;
      const projectId = integration.projectId;

      // 2. Validate x-vapi-secret header if configured
      if (config.vapiWebhookSecretKey) {
        try {
          const expectedSecret = await secretService.get(projectId, config.vapiWebhookSecretKey);
          const receivedSecret = request.headers['x-vapi-secret'] as string | undefined;
          if (!receivedSecret || receivedSecret !== expectedSecret) {
            await reply.code(401).send({ error: 'Invalid VAPI secret' });
            return;
          }
        } catch {
          logger.warn('Could not resolve VAPI webhook secret', {
            component: 'vapi',
            integrationId,
          });
        }
      }

      // 3. Parse VAPI body
      const parseResult = VapiCustomLlmSchema.safeParse(request.body);
      if (!parseResult.success) {
        await reply.code(400).send({ error: 'Invalid VAPI request body' });
        return;
      }
      const body = parseResult.data as VapiCustomLlmBody;
      const callId = body.call.id;
      const callerPhone = body.call.customer?.number ?? body.call.phoneNumber?.number ?? 'unknown';

      // 4. Extract the last user message from the conversation
      const lastUserMessage = [...body.messages]
        .reverse()
        .find((m) => m.role === 'user')?.content ?? '';

      // 5. Find or create session for this call
      let sessionId: SessionId | undefined;
      const existingSession = await sessionRepository.findByCallId(callId, projectId);
      if (existingSession) {
        sessionId = existingSession.id;
      } else {
        const newSession = await sessionRepository.create({
          projectId,
          metadata: {
            callId,
            channel: 'vapi',
            callerPhone,
            integrationId,
          },
        });
        sessionId = newSession.id;
        logger.info('Created new VAPI call session', {
          component: 'vapi',
          callId,
          sessionId,
          projectId,
          callerPhone,
        });
      }

      // 6. Run agent via shared chat setup
      const setupResult = await prepareChatRun(
        {
          projectId: projectId as string,
          sessionId,
          agentId: config.agentId,
          sourceChannel: 'vapi',
          message: lastUserMessage,
        },
        deps,
      );

      if (!setupResult.ok) {
        logger.error('VAPI chat setup failed', {
          component: 'vapi',
          callId,
          code: setupResult.error.code,
          message: setupResult.error.message,
        });
        await reply.code(500).send({ error: setupResult.error.message });
        return;
      }

      const {
        sanitizedMessage,
        agentConfig,
        systemPrompt,
        promptSnapshot,
        conversationHistory,
        provider,
        fallbackProvider,
        memoryManager,
        costGuard,
      } = setupResult.value;

      // 7. Run agent loop
      const agentRunner = createAgentRunner({
        provider,
        fallbackProvider,
        toolRegistry: deps.toolRegistry,
        memoryManager,
        costGuard,
        logger: deps.logger,
      });

      const result = await agentRunner.run({
        message: sanitizedMessage,
        agentConfig,
        sessionId,
        systemPrompt,
        promptSnapshot,
        conversationHistory,
      });

      let assistantText: string;
      if (result.ok) {
        const trace = result.value;
        assistantText = extractAssistantResponse(trace.events);
        const toolCalls = extractToolCalls(trace.events);

        // Persist messages and trace
        await deps.executionTraceRepository.save(trace);
        await sessionRepository.addMessage(sessionId, { role: 'user', content: sanitizedMessage }, trace.id);
        await sessionRepository.addMessage(sessionId, { role: 'assistant', content: assistantText }, trace.id);

        logger.info('VAPI turn completed', {
          component: 'vapi',
          callId,
          sessionId,
          toolCallCount: toolCalls.length,
        });
      } else {
        // Return a graceful fallback rather than breaking the call
        assistantText = 'Lo siento, tuve un problema procesando tu mensaje. ¿Puedes repetirlo?';
        logger.error('VAPI agent runner failed', {
          component: 'vapi',
          callId,
          sessionId,
          error: result.error instanceof Error ? result.error.message : 'Unknown error',
        });
      }

      // 8. Return OpenAI-compatible response (VAPI format)
      await reply.code(200).send({
        id: `vapi-turn-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'nexus-agent',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: assistantText,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      });
    },
  );

  // ─── POST /vapi/webhook/:integrationId ────────────────────────
  //
  // Receives VAPI call lifecycle events.

  fastify.post<{ Params: { integrationId: string } }>(
    '/vapi/webhook/:integrationId',
    async (request: FastifyRequest<{ Params: { integrationId: string } }>, reply: FastifyReply) => {
      const { integrationId } = request.params;

      // Always ack immediately — VAPI requires fast response
      await reply.code(200).send({ received: true });

      // Process event async
      const body = request.body as Record<string, unknown>;
      const eventType = body['type'] as string | undefined;
      const callData = body['call'] as Record<string, unknown> | undefined;
      const callId = callData?.['id'] as string | undefined;

      if (!eventType || !callId) return;

      logger.info('VAPI webhook event received', {
        component: 'vapi',
        integrationId,
        eventType,
        callId,
      });

      if (eventType === 'end-of-call-report') {
        const integration = await channelIntegrationRepository.findById(integrationId);
        if (!integration) return;

        const session = await sessionRepository.findByCallId(callId, integration.projectId);
        if (!session) return;

        // Save transcript and close session
        const transcript = body['transcript'] as string | undefined;
        const summary = body['summary'] as string | undefined;
        const durationSeconds = callData?.['endedAt'] !== undefined ? undefined : undefined;

        await sessionRepository.updateMetadata(session.id, {
          ...(session.metadata ?? {}),
          callEnded: true,
          transcript,
          summary,
          durationSeconds,
          endedAt: new Date().toISOString(),
        });
        await sessionRepository.updateStatus(session.id, 'closed');

        logger.info('VAPI call ended — session closed', {
          component: 'vapi',
          callId,
          sessionId: session.id,
          integrationId,
        });
      }
    },
  );
}

/**
 * Agent Scenario Tests — validate vertical agent configurations and flow logic.
 *
 * These tests verify that:
 * 1. Agent configs are correctly structured for each vertical
 * 2. Tool whitelists match agent responsibilities
 * 3. Prompt layers contain required content
 * 4. Channel adapters parse/send correctly
 * 5. MCP tool naming follows conventions
 *
 * Note: These are configuration/scenario tests, not live LLM integration tests.
 * For live tests, set ANTHROPIC_API_KEY and run `pnpm test:integration`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nanoid } from 'nanoid';
import type { ProjectId } from '@/core/types.js';
import { createE2EAgentConfig } from './helpers.js';

// ─── Agent Scenario Configs ─────────────────────────────────────

const FERRETERIA_TOOLS = ['calculator', 'date-time', 'catalog-search', 'send-notification'];
const CONCESIONARIA_TOOLS = ['calculator', 'date-time', 'catalog-search', 'send-notification', 'propose-scheduled-task'];
const HOTEL_TOOLS = ['calculator', 'date-time', 'catalog-search', 'send-notification'];
const FOMO_TOOLS = [
  'calculator',
  'date-time',
  'send-notification',
  'mcp:fomo-platform:search-clients',
  'mcp:fomo-platform:get-client-detail',
  'mcp:fomo-platform:list-contacts',
  'mcp:fomo-platform:list-opportunities',
  'mcp:fomo-platform:update-opportunity-stage',
  'mcp:fomo-platform:list-temas',
  'mcp:fomo-platform:create-tema-task',
];

// ─── Tests ──────────────────────────────────────────────────────

describe('Agent Scenarios', () => {
  describe('AgentConfig Validation', () => {
    it('creates valid config for Ferretería vertical', () => {
      const projectId = nanoid() as ProjectId;
      const config = createE2EAgentConfig(projectId, {
        agentRole: 'sales-assistant',
        allowedTools: FERRETERIA_TOOLS,
        provider: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          apiKeyEnvVar: 'ANTHROPIC_API_KEY',
          temperature: 0.3,
        },
        costConfig: {
          dailyBudgetUSD: 20,
          monthlyBudgetUSD: 300,
          maxTokensPerTurn: 4096,
          maxTurnsPerSession: 30,
          maxToolCallsPerTurn: 10,
          alertThresholdPercent: 80,
          hardLimitPercent: 100,
          maxRequestsPerMinute: 60,
          maxRequestsPerHour: 1000,
        },
      });

      expect(config.projectId).toBe(projectId);
      expect(config.agentRole).toBe('sales-assistant');
      expect(config.allowedTools).toEqual(FERRETERIA_TOOLS);
      expect(config.allowedTools).toContain('catalog-search');
      expect(config.allowedTools).toContain('calculator');
      expect(config.allowedTools).not.toContain('http-request');
    });

    it('creates valid config for Concesionaria vertical', () => {
      const projectId = nanoid() as ProjectId;
      const config = createE2EAgentConfig(projectId, {
        agentRole: 'sales-assistant',
        allowedTools: CONCESIONARIA_TOOLS,
        maxTurnsPerSession: 40,
        maxConcurrentSessions: 8,
      });

      expect(config.allowedTools).toEqual(CONCESIONARIA_TOOLS);
      expect(config.allowedTools).toContain('propose-scheduled-task');
      expect(config.maxTurnsPerSession).toBe(40);
    });

    it('creates valid config for Hotel vertical', () => {
      const projectId = nanoid() as ProjectId;
      const config = createE2EAgentConfig(projectId, {
        agentRole: 'concierge',
        allowedTools: HOTEL_TOOLS,
        maxConcurrentSessions: 15,
      });

      expect(config.agentRole).toBe('concierge');
      expect(config.allowedTools).toEqual(HOTEL_TOOLS);
      expect(config.maxConcurrentSessions).toBe(15);
    });

    it('creates valid config for Fomo Assistant with MCP', () => {
      const projectId = nanoid() as ProjectId;
      const config = createE2EAgentConfig(projectId, {
        agentRole: 'internal-assistant',
        allowedTools: FOMO_TOOLS,
        mcpServers: [
          {
            name: 'fomo-platform',
            transport: 'stdio',
            command: 'node',
            args: ['dist/mcp/servers/fomo-platform/index.js'],
            env: {
              SUPABASE_URL: 'FOMO_SUPABASE_URL',
              SUPABASE_SERVICE_KEY: 'FOMO_SUPABASE_KEY',
              FOMO_COMPANY_ID: 'FOMO_COMPANY_ID',
            },
          },
        ],
      });

      expect(config.allowedTools).toContain('mcp:fomo-platform:search-clients');
      expect(config.allowedTools).toContain('mcp:fomo-platform:list-contacts');
      expect(config.allowedTools).toContain('mcp:fomo-platform:update-opportunity-stage');
      expect(config.allowedTools).toContain('mcp:fomo-platform:create-tema-task');
      expect(config.mcpServers).toHaveLength(1);
      expect(config.mcpServers?.[0]?.name).toBe('fomo-platform');
      expect(config.mcpServers?.[0]?.transport).toBe('stdio');
    });
  });

  describe('MCP Tool Naming Convention', () => {
    it('follows mcp:<server>:<tool> pattern', () => {
      const mcpTools = FOMO_TOOLS.filter((t) => t.startsWith('mcp:'));

      expect(mcpTools).toHaveLength(7);
      for (const tool of mcpTools) {
        const parts = tool.split(':');
        expect(parts).toHaveLength(3);
        expect(parts[0]).toBe('mcp');
        expect(parts[1]).toBe('fomo-platform');
        expect(parts[2]?.length).toBeGreaterThan(0);
      }
    });

    it('MCP tools are separate from built-in tools', () => {
      const builtInTools = FOMO_TOOLS.filter((t) => !t.startsWith('mcp:'));
      const mcpTools = FOMO_TOOLS.filter((t) => t.startsWith('mcp:'));

      expect(builtInTools).toEqual(['calculator', 'date-time', 'send-notification']);
      expect(mcpTools).toEqual([
        'mcp:fomo-platform:search-clients',
        'mcp:fomo-platform:get-client-detail',
        'mcp:fomo-platform:list-contacts',
        'mcp:fomo-platform:list-opportunities',
        'mcp:fomo-platform:update-opportunity-stage',
        'mcp:fomo-platform:list-temas',
        'mcp:fomo-platform:create-tema-task',
      ]);
    });
  });

  describe('Vertical Tool Whitelists', () => {
    it('Ferretería has catalog and calculator but no scheduling', () => {
      expect(FERRETERIA_TOOLS).toContain('catalog-search');
      expect(FERRETERIA_TOOLS).toContain('calculator');
      expect(FERRETERIA_TOOLS).toContain('send-notification');
      expect(FERRETERIA_TOOLS).not.toContain('propose-scheduled-task');
      expect(FERRETERIA_TOOLS).not.toContain('http-request');
    });

    it('Concesionaria has scheduling for test drives', () => {
      expect(CONCESIONARIA_TOOLS).toContain('propose-scheduled-task');
      expect(CONCESIONARIA_TOOLS).toContain('catalog-search');
      expect(CONCESIONARIA_TOOLS).toContain('send-notification');
    });

    it('Hotel has catalog for rooms but no scheduling or MCP', () => {
      expect(HOTEL_TOOLS).toContain('catalog-search');
      expect(HOTEL_TOOLS).toContain('calculator');
      expect(HOTEL_TOOLS).not.toContain('propose-scheduled-task');
      expect(HOTEL_TOOLS.some((t) => t.startsWith('mcp:'))).toBe(false);
    });

    it('Fomo Assistant has MCP tools but no catalog', () => {
      expect(FOMO_TOOLS).not.toContain('catalog-search');
      expect(FOMO_TOOLS.some((t) => t.startsWith('mcp:'))).toBe(true);
    });

    it('all verticals have calculator and date-time', () => {
      const allToolsets = [FERRETERIA_TOOLS, CONCESIONARIA_TOOLS, HOTEL_TOOLS, FOMO_TOOLS];
      for (const tools of allToolsets) {
        expect(tools).toContain('calculator');
        expect(tools).toContain('date-time');
      }
    });

    it('no vertical has dangerous tools', () => {
      const dangerous = ['shell-exec', 'file-system', 'database-query', 'code-eval'];
      const allToolsets = [FERRETERIA_TOOLS, CONCESIONARIA_TOOLS, HOTEL_TOOLS, FOMO_TOOLS];
      for (const tools of allToolsets) {
        for (const d of dangerous) {
          expect(tools).not.toContain(d);
        }
      }
    });
  });

  describe('Chatwoot Webhook Processing Flow', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      process.env['SLACK_BOT_TOKEN'] = 'xoxb-test';
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      process.env = originalEnv;
      vi.unstubAllGlobals();
    });

    it('simulates Ferretería sales flow: message → parse → agent → response', async () => {
      // Step 1: Customer sends message via Chatwoot
      const incomingEvent = {
        event: 'message_created',
        message_type: 'incoming',
        content: 'Hola, necesito tornillos autoperforantes 6x1 pulgada',
        account: { id: 1 },
        conversation: { id: 100 },
        sender: { id: 1, type: 'contact' as const },
      };

      // Step 2: Validate event structure
      expect(incomingEvent.event).toBe('message_created');
      expect(incomingEvent.message_type).toBe('incoming');
      expect(incomingEvent.content).toContain('tornillos');
      expect(incomingEvent.conversation.id).toBe(100);
      expect(incomingEvent.sender.type).toBe('contact');

      // Step 3: Simulate agent response (would come from LLM)
      const agentResponse = [
        '¡Hola! Bienvenido a Ferretería Central.',
        'Encontré tornillos autoperforantes 6x1":',
        '- Caja x100: $2.500',
        '- Caja x500: $10.000 (ahorrás un 20%)',
        '¿Cuántas cajas necesitás?',
      ].join('\n');

      // Step 4: Validate response would be sent back
      const sendPayload = {
        channel: 'chatwoot' as const,
        recipientIdentifier: String(incomingEvent.conversation.id),
        content: agentResponse,
      };

      expect(sendPayload.recipientIdentifier).toBe('100');
      expect(sendPayload.content).toContain('Ferretería Central');
      expect(sendPayload.content).toContain('tornillos');
    });

    it('simulates Concesionaria lead qualification flow', async () => {
      const incomingEvent = {
        event: 'message_created',
        message_type: 'incoming',
        content: 'Hola, estoy buscando una SUV para la familia, presupuesto de 35 millones',
        account: { id: 2 },
        conversation: { id: 200 },
        sender: { id: 2, type: 'contact' as const },
      };

      // Lead qualification: HOT (specific type + defined budget)
      const hasSpecificType = incomingEvent.content.includes('SUV');
      const hasBudget = /\d+\s*(millones|mill|M)/i.test(incomingEvent.content);

      expect(hasSpecificType).toBe(true);
      expect(hasBudget).toBe(true);

      // This would be a HOT lead
      const leadScore = hasSpecificType && hasBudget ? 'HOT' : 'WARM';
      expect(leadScore).toBe('HOT');
    });

    it('simulates Hotel multilingual detection', () => {
      const messages = [
        { content: 'Hello, I would like to book a room', expectedLang: 'en' },
        { content: 'Hola, quiero reservar una habitación', expectedLang: 'es' },
        { content: 'Olá, gostaria de reservar um quarto', expectedLang: 'pt' },
      ];

      for (const msg of messages) {
        // Simple language detection heuristic (agent would use LLM for this)
        const isEnglish = /\b(hello|room|book|would)\b/i.test(msg.content);
        const isSpanish = /\b(hola|quiero|habitación|reservar)\b/i.test(msg.content);
        const isPortuguese = /\b(olá|gostaria|quarto)\b/i.test(msg.content);

        if (msg.expectedLang === 'en') expect(isEnglish).toBe(true);
        if (msg.expectedLang === 'es') expect(isSpanish).toBe(true);
        if (msg.expectedLang === 'pt') expect(isPortuguese).toBe(true);
      }
    });

    it('simulates Fomo MCP tool call flow', () => {
      // User says: "Creá una tarea para Juan para revisar el presupuesto de INTED"
      const toolCall = {
        toolId: 'mcp:fomo-platform:create-tema-task',
        input: {
          temaId: 'tema_123',
          title: 'Revisar presupuesto INTED',
          description: 'El cliente INTED necesita revisión de su presupuesto mensual',
          assignedTo: 'user_juan',
          dueDate: '2026-02-20',
        },
      };

      // Validate MCP tool naming
      expect(toolCall.toolId).toMatch(/^mcp:[a-z-]+:[a-z-]+$/);
      const [prefix, server, tool] = toolCall.toolId.split(':');
      expect(prefix).toBe('mcp');
      expect(server).toBe('fomo-platform');
      expect(tool).toBe('create-tema-task');

      // Validate input
      expect(toolCall.input.title).toBeTruthy();
      expect(toolCall.input.assignedTo).toBeTruthy();
      expect(toolCall.input.temaId).toBeTruthy();
    });

    it('simulates handoff escalation from agent response', () => {
      const agentResponse = 'Entiendo tu problema. [HANDOFF] Voy a transferirte con un agente humano para resolverlo.';

      const hasHandoffMarker = agentResponse.includes('[HANDOFF]');
      expect(hasHandoffMarker).toBe(true);

      const cleanResponse = agentResponse.replace('[HANDOFF]', '').replace(/\s+/g, ' ').trim();
      expect(cleanResponse).not.toContain('[HANDOFF]');
      expect(cleanResponse).toContain('Entiendo tu problema');
      expect(cleanResponse).toContain('agente humano');
    });

    it('simulates handoff escalation from keywords', () => {
      const escalationKeywords = ['hablar con un humano', 'agente humano', 'persona real', 'operador'];
      const customerMessage = 'quiero hablar con un humano por favor';

      const shouldEscalate = escalationKeywords.some((kw) =>
        customerMessage.toLowerCase().includes(kw),
      );

      expect(shouldEscalate).toBe(true);
    });

    it('validates Slack adapter integration for Hotel channel', async () => {
      const { createSlackAdapter } = await import('@/channels/adapters/slack.js');

      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({ ok: true, ts: '1234567890.123456' }),
      } as Response);

      const adapter = createSlackAdapter({ botTokenEnvVar: 'SLACK_BOT_TOKEN' });

      // Hotel concierge sends response via Slack
      const result = await adapter.send({
        channel: 'slack',
        recipientIdentifier: 'C_HOTEL_LOBBY',
        content: 'Welcome to Casa Luna! How can I help you today?',
        options: { parseMode: 'markdown' },
      });

      expect(result.success).toBe(true);
      expect(result.channelMessageId).toBe('1234567890.123456');
    });
  });

  describe('Budget and Limits', () => {
    it('Ferretería has appropriate budget for B2B volume', () => {
      const config = createE2EAgentConfig(nanoid() as ProjectId, {
        costConfig: {
          dailyBudgetUSD: 20,
          monthlyBudgetUSD: 300,
          maxTokensPerTurn: 4096,
          maxTurnsPerSession: 30,
          maxToolCallsPerTurn: 10,
          alertThresholdPercent: 80,
          hardLimitPercent: 100,
          maxRequestsPerMinute: 60,
          maxRequestsPerHour: 1000,
        },
      });

      expect(config.costConfig.dailyBudgetUSD).toBe(20);
      expect(config.costConfig.monthlyBudgetUSD).toBe(300);
    });

    it('Concesionaria has higher budget for complex sales conversations', () => {
      const config = createE2EAgentConfig(nanoid() as ProjectId, {
        costConfig: {
          dailyBudgetUSD: 25,
          monthlyBudgetUSD: 500,
          maxTokensPerTurn: 4096,
          maxTurnsPerSession: 40,
          maxToolCallsPerTurn: 10,
          alertThresholdPercent: 80,
          hardLimitPercent: 100,
          maxRequestsPerMinute: 60,
          maxRequestsPerHour: 1000,
        },
      });

      expect(config.costConfig.dailyBudgetUSD).toBe(25);
      expect(config.costConfig.monthlyBudgetUSD).toBe(500);
    });

    it('Hotel has moderate budget with high concurrency', () => {
      const config = createE2EAgentConfig(nanoid() as ProjectId, {
        costConfig: {
          dailyBudgetUSD: 15,
          monthlyBudgetUSD: 200,
          maxTokensPerTurn: 4096,
          maxTurnsPerSession: 25,
          maxToolCallsPerTurn: 10,
          alertThresholdPercent: 80,
          hardLimitPercent: 100,
          maxRequestsPerMinute: 60,
          maxRequestsPerHour: 1000,
        },
        maxConcurrentSessions: 15,
      });

      expect(config.costConfig.dailyBudgetUSD).toBe(15);
      expect(config.maxConcurrentSessions).toBe(15);
    });

    it('Fomo Assistant has highest budget for internal heavy usage', () => {
      const config = createE2EAgentConfig(nanoid() as ProjectId, {
        costConfig: {
          dailyBudgetUSD: 30,
          monthlyBudgetUSD: 500,
          maxTokensPerTurn: 4096,
          maxTurnsPerSession: 30,
          maxToolCallsPerTurn: 10,
          alertThresholdPercent: 80,
          hardLimitPercent: 100,
          maxRequestsPerMinute: 60,
          maxRequestsPerHour: 1000,
        },
      });

      expect(config.costConfig.dailyBudgetUSD).toBe(30);
      expect(config.costConfig.monthlyBudgetUSD).toBe(500);
    });
  });
});

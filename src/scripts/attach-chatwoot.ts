/* eslint-disable no-console */
/**
 * Attach an existing Nexus agent to an existing Chatwoot inbox.
 *
 * The script is ATTACH-only — it never creates projects or agents. It:
 *   1. Validates project + agent exist in DB
 *   2. Stores the Chatwoot API token + webhook HMAC secret in SecretService
 *   3. Upserts a ChannelIntegration(projectId, provider='chatwoot')
 *   4. Appends 'chatwoot' to the agent's channelConfig.allowedChannels
 *   5. Hits GET /api/v1/accounts/:id on Chatwoot to verify the token works
 *
 * Secret values are read from env vars (never passed as CLI args) to keep
 * them out of shell history and process listings.
 *
 * Usage:
 *   node dist/scripts/attach-chatwoot.js \
 *     --project-id <id> \
 *     --agent-id <id> \
 *     --chatwoot-base-url https://chatwoot.fomo.tld \
 *     --chatwoot-account-id 1 \
 *     --chatwoot-inbox-id 2 \
 *     --chatwoot-agent-bot-id 3 \
 *     --api-token-env-var CHATWOOT_API_TOKEN_FOMO \
 *     [--dry-run]
 *
 * The pathToken used in the public webhook URL is generated at first attach
 * and reused on subsequent attaches, so the URL pasted into Chatwoot's bot
 * keeps working across re-runs.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createSecretRepository } from '@/infrastructure/repositories/secret-repository.js';
import { createSecretService } from '@/secrets/secret-service.js';
import { createProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import { createAgentRepository } from '@/infrastructure/repositories/agent-repository.js';
import { createChannelIntegrationRepository } from '@/infrastructure/repositories/channel-integration-repository.js';
import { storeChatwootSecrets } from '@/secrets/chatwoot-secrets.js';
import { generateChatwootPathToken } from '@/api/routes/chatwoot-webhook.js';
import { createLogger } from '@/observability/logger.js';
import type { ChatwootIntegrationConfig } from '@/channels/types.js';
import type { ProjectId } from '@/core/types.js';
import type { AgentId, AgentConfig, ChannelConfig } from '@/agents/types.js';

// ─── CLI ────────────────────────────────────────────────────────

interface CliArgs {
  projectId: string;
  agentId: string;
  chatwootBaseUrl: string;
  chatwootAccountId: number;
  chatwootInboxId: number;
  chatwootAgentBotId: number;
  apiTokenEnvVar: string;
  apiTokenSecretKey?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const flags = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for flag --${key}`);
      }
      flags.set(key, value);
      i += 1;
    }
  }

  function required(key: string): string {
    const v = flags.get(key);
    if (!v) throw new Error(`Missing required flag --${key}`);
    return v;
  }

  function requiredInt(key: string): number {
    const v = required(key);
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n) || n <= 0) throw new Error(`Flag --${key} must be a positive integer`);
    return n;
  }

  const args: CliArgs = {
    projectId: required('project-id'),
    agentId: required('agent-id'),
    chatwootBaseUrl: required('chatwoot-base-url'),
    chatwootAccountId: requiredInt('chatwoot-account-id'),
    chatwootInboxId: requiredInt('chatwoot-inbox-id'),
    chatwootAgentBotId: requiredInt('chatwoot-agent-bot-id'),
    apiTokenEnvVar: required('api-token-env-var'),
    dryRun,
  };
  const apiKey = flags.get('api-token-secret-key');
  if (apiKey !== undefined) args.apiTokenSecretKey = apiKey;
  return args;
}

// ─── Main ───────────────────────────────────────────────────────

const logger = createLogger({ name: 'attach-chatwoot' });

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const prisma = new PrismaClient();
  try {
    const projectRepository = createProjectRepository(prisma);
    const agentRepository = createAgentRepository(prisma);
    const channelIntegrationRepository = createChannelIntegrationRepository(prisma);
    const secretRepository = createSecretRepository(prisma);
    const secretService = createSecretService({ secretRepository });

    // 1. Validate project + agent exist.
    const projectId = args.projectId as ProjectId;
    const project = await projectRepository.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const agent = await agentRepository.findById(args.agentId as AgentId);
    if (!agent) {
      throw new Error(`Agent not found: ${args.agentId}`);
    }
    if (agent.projectId !== projectId) {
      throw new Error(
        `Agent ${args.agentId} belongs to project ${agent.projectId}, not ${projectId}`,
      );
    }

    const currentChannels = Array.isArray(agent.channelConfig.allowedChannels)
      ? agent.channelConfig.allowedChannels
      : [];
    const alreadyAttached = currentChannels.includes('chatwoot');

    const apiTokenSecretKey = args.apiTokenSecretKey ?? 'CHATWOOT_API_TOKEN';

    // 2. Dry-run plan + exit.
    if (args.dryRun) {
      console.log('[attach-chatwoot] DRY RUN');
      console.log(`- Project: ${projectId} "${project.name}"`);
      console.log(
        `- Agent: ${agent.id} "${agent.name}" (current channels: ${JSON.stringify(currentChannels)})`,
      );
      console.log(`- Would upsert ChannelIntegration (projectId=${projectId}, provider='chatwoot')`);
      console.log(
        `- Would ${alreadyAttached ? 'leave unchanged' : "add 'chatwoot' to"} Agent.channelConfig.allowedChannels`,
      );
      console.log(`- Would store API token under key: ${apiTokenSecretKey}`);
      console.log('- Would mint a new pathToken (preserving existing one if re-attaching)');
      console.log('- Health check: SKIPPED (dry-run)');
      console.log('OK');
      return;
    }

    // 3. Read plaintext API token from env var (never from argv).
    const apiToken = process.env[args.apiTokenEnvVar];
    if (!apiToken) {
      throw new Error(`Env var ${args.apiTokenEnvVar} is not set — cannot read API token`);
    }

    // 4. Persist the API token.
    await storeChatwootSecrets(secretService, {
      projectId,
      apiToken,
      apiTokenKey: apiTokenSecretKey,
    });

    // 5. Upsert the ChannelIntegration. Reuse the existing pathToken on
    // re-attach so the URL the user pasted into Chatwoot keeps working.
    const existing = await channelIntegrationRepository.findByProjectAndProvider(
      projectId,
      'chatwoot',
    );
    const existingConfig = existing?.config as ChatwootIntegrationConfig | undefined;
    const pathToken = existingConfig?.pathToken ?? generateChatwootPathToken();

    const config: ChatwootIntegrationConfig = {
      baseUrl: args.chatwootBaseUrl,
      accountId: args.chatwootAccountId,
      inboxId: args.chatwootInboxId,
      agentBotId: args.chatwootAgentBotId,
      pathToken,
      apiTokenSecretKey,
    };

    const integration = existing
      ? await channelIntegrationRepository.update(existing.id, { config, status: 'active' })
      : await channelIntegrationRepository.create({
          projectId,
          provider: 'chatwoot',
          config,
          status: 'active',
        });

    // 6. Append 'chatwoot' to the agent's allowedChannels (preserve others).
    let channelConfigUpdated = false;
    if (!alreadyAttached) {
      const updatedChannelConfig: ChannelConfig = {
        ...agent.channelConfig,
        allowedChannels: [...currentChannels, 'chatwoot'],
      };
      await agentRepository.update(agent.id, { channelConfig: updatedChannelConfig });
      channelConfigUpdated = true;
    }

    // 7. Health check: GET /api/v1/accounts/:id.
    const healthUrl = `${args.chatwootBaseUrl}/api/v1/accounts/${String(args.chatwootAccountId)}`;
    let healthStatus: 'ok' | 'unreachable' = 'unreachable';
    try {
      const resp = await fetch(healthUrl, {
        method: 'GET',
        headers: { 'api_access_token': apiToken },
      });
      healthStatus = resp.ok ? 'ok' : 'unreachable';
      if (!resp.ok) {
        logger.warn('Chatwoot health check returned non-2xx', {
          component: 'attach-chatwoot',
          status: resp.status,
        });
      }
    } catch (error) {
      logger.warn('Chatwoot health check threw', {
        component: 'attach-chatwoot',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 8. Final summary.
    const webhookUrl = `/api/v1/webhooks/chatwoot/${pathToken}`;
    _logAttachSummary({
      projectId,
      projectName: project.name,
      agentId: agent.id,
      agentName: agent.name,
      integrationId: integration.id,
      apiTokenSecretKey,
      webhookUrl,
      channelConfigUpdated,
      healthStatus,
    });
  } finally {
    await prisma.$disconnect();
  }
}

function _logAttachSummary(summary: {
  projectId: string;
  projectName: string;
  agentId: string;
  agentName: string;
  integrationId: string;
  apiTokenSecretKey: string;
  webhookUrl: string;
  channelConfigUpdated: boolean;
  healthStatus: 'ok' | 'unreachable';
}): void {
  logger.info('Chatwoot attach complete', { component: 'attach-chatwoot', ...summary });
  console.log('[attach-chatwoot] OK');
  console.log(`- project: ${summary.projectId} "${summary.projectName}"`);
  console.log(`- agent: ${summary.agentId} "${summary.agentName}"`);
  console.log(`- integrationId: ${summary.integrationId}`);
  console.log(`- apiTokenSecretKey: ${summary.apiTokenSecretKey}`);
  console.log(`- webhookUrl (paste into Chatwoot Agent Bot outgoing_url): ${summary.webhookUrl}`);
  console.log(`- channelConfigUpdated: ${String(summary.channelConfigUpdated)}`);
  console.log(`- health: ${summary.healthStatus}`);
}

main().catch((error: unknown) => {
  logger.error('attach-chatwoot failed', {
    component: 'attach-chatwoot',
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(`[attach-chatwoot] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

// Ensure the AgentConfig import isn't tree-shaken accidentally (type-only check).
export type { AgentConfig };

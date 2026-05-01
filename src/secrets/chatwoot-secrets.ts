/**
 * Chatwoot-specific secret helpers.
 *
 * Stores the Chatwoot API access token (used by Nexus to reply via the
 * platform API). Chatwoot v4.12.x Agent Bots do NOT sign their outgoing
 * webhooks, so there is no webhook HMAC secret — auth on inbound
 * deliveries is handled via the path token in the URL.
 */
import type { ProjectId } from '@/core/types.js';
import type { SecretService } from './types.js';

const API_TOKEN_DESCRIPTION = 'Chatwoot API access token (api_access_token header)';

/** Result of storing the Chatwoot API token for a project. */
export interface StoreChatwootSecretsResult {
  apiTokenKey: string;
}

/** Input for storing the Chatwoot API token. */
export interface StoreChatwootSecretsInput {
  projectId: ProjectId;
  apiToken: string;
  /** Defaults to CHATWOOT_API_TOKEN. */
  apiTokenKey?: string;
}

/**
 * Persist the Chatwoot API token for a project using the encrypted
 * SecretService. Returns the key that was written so the caller can store
 * it on the ChannelIntegration config.
 */
export async function storeChatwootSecrets(
  secretService: SecretService,
  input: StoreChatwootSecretsInput,
): Promise<StoreChatwootSecretsResult> {
  const apiTokenKey = input.apiTokenKey ?? 'CHATWOOT_API_TOKEN';
  await secretService.set(input.projectId, apiTokenKey, input.apiToken, API_TOKEN_DESCRIPTION);
  return { apiTokenKey };
}

/**
 * Retrieve the Chatwoot API access token for a project.
 * Throws SecretNotFoundError if absent.
 */
export async function getChatwootApiToken(
  secretService: SecretService,
  projectId: ProjectId,
  key = 'CHATWOOT_API_TOKEN',
): Promise<string> {
  return secretService.get(projectId, key);
}

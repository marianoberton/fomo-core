/**
 * Chatwoot-specific secret helpers.
 *
 * Wraps SecretService with typed getters/setters for the two credentials
 * a Chatwoot integration needs: the account API access token, and the
 * HMAC secret Chatwoot uses to sign webhook payloads.
 */
import type { ProjectId } from '@/core/types.js';
import type { SecretService } from './types.js';

/** Stable descriptions written to secret metadata so operators can tell them apart in the UI. */
const API_TOKEN_DESCRIPTION = 'Chatwoot API access token (api_access_token header)';
const WEBHOOK_SECRET_DESCRIPTION = 'Chatwoot webhook HMAC signing secret (X-Chatwoot-Api-Signature)';

/** Result of storing both Chatwoot secrets for a project. */
export interface StoreChatwootSecretsResult {
  apiTokenKey: string;
  webhookSecretKey: string;
}

/** Input for storing Chatwoot secrets. */
export interface StoreChatwootSecretsInput {
  projectId: ProjectId;
  apiToken: string;
  webhookSecret: string;
  /** Defaults to CHATWOOT_API_TOKEN. */
  apiTokenKey?: string;
  /** Defaults to CHATWOOT_WEBHOOK_SECRET. */
  webhookSecretKey?: string;
}

/**
 * Persist the Chatwoot API token and webhook secret for a project using
 * the encrypted SecretService. Returns the keys that were written so the
 * caller can store them on the ChannelIntegration config.
 */
export async function storeChatwootSecrets(
  secretService: SecretService,
  input: StoreChatwootSecretsInput,
): Promise<StoreChatwootSecretsResult> {
  const apiTokenKey = input.apiTokenKey ?? 'CHATWOOT_API_TOKEN';
  const webhookSecretKey = input.webhookSecretKey ?? 'CHATWOOT_WEBHOOK_SECRET';

  await secretService.set(input.projectId, apiTokenKey, input.apiToken, API_TOKEN_DESCRIPTION);
  await secretService.set(
    input.projectId,
    webhookSecretKey,
    input.webhookSecret,
    WEBHOOK_SECRET_DESCRIPTION,
  );

  return { apiTokenKey, webhookSecretKey };
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

/**
 * Retrieve the Chatwoot webhook HMAC secret for a project.
 * Throws SecretNotFoundError if absent.
 */
export async function getChatwootWebhookSecret(
  secretService: SecretService,
  projectId: ProjectId,
  key = 'CHATWOOT_WEBHOOK_SECRET',
): Promise<string> {
  return secretService.get(projectId, key);
}

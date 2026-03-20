/**
 * Dokploy Service — client provisioning via Dokploy REST API (tRPC).
 * Replaces Docker socket-based provisioning with Dokploy panel management.
 */
import type { Logger } from '@/observability/logger.js';
import type {
  CreateClientRequest,
  ProvisioningResult,
  ClientContainerStatus,
} from './provisioning-types.js';

// ─── Constants ──────────────────────────────────────────────────

const CONTAINER_PREFIX = 'fomo-client-';
const GITHUB_REPOSITORY = 'marianoberton/fomo-openclaw-client';
const GITHUB_BRANCH = 'main';

// ─── Service Interface ──────────────────────────────────────────

/** Dokploy-based application management for client provisioning. */
export interface DokployService {
  /** Create and deploy a new application for a client. */
  createClientContainer(req: CreateClientRequest): Promise<ProvisioningResult>;
  /** Delete a client's application. */
  destroyClientContainer(clientId: string): Promise<void>;
  /** Get the status of a client's application. */
  getContainerStatus(clientId: string): Promise<ClientContainerStatus>;
  /** List all managed client applications. */
  listClientContainers(): Promise<ClientContainerStatus[]>;
}

// ─── Service Dependencies ───────────────────────────────────────

export interface DokployServiceDeps {
  logger: Logger;
  /** Dokploy panel base URL (e.g. https://panel.fomo.com.ar). */
  dokployUrl: string;
  /** API key for Dokploy authentication. */
  dokployApiKey: string;
  /** Dokploy project ID where client apps are provisioned. */
  dokployProjectId: string;
}

// ─── Dokploy API Types ──────────────────────────────────────────

interface TrpcResponse<T> {
  result: {
    data: T;
  };
}

interface TrpcBatchResponse<T> {
  0: TrpcResponse<T>;
}

interface DokployApplication {
  applicationId: string;
  appName: string;
  name: string;
  applicationStatus: string;
  createdAt: string;
}

interface DokployProject {
  projectId: string;
  name: string;
  applications: DokployApplication[];
}

// ─── Helpers ────────────────────────────────────────────────────

/** Build the Dokploy application name from a client ID. */
function appName(clientId: string): string {
  return `${CONTAINER_PREFIX}${clientId}`;
}

/** Map Dokploy applicationStatus to our status enum. */
function mapStatus(applicationStatus: string): 'running' | 'stopped' | 'error' {
  if (applicationStatus === 'done') return 'running';
  if (applicationStatus === 'error') return 'error';
  return 'stopped';
}

/** Build environment variables string for Dokploy. */
function buildEnvString(req: CreateClientRequest): string {
  const vars: string[] = [
    `CLIENT_ID=${req.clientId}`,
    `CLIENT_NAME=${req.clientName}`,
    `INSTANCE_NAME=${req.clientId}`,
    `CHANNELS=${req.channels.join(',')}`,
    `SOUL_COMPANY_NAME=${req.companyName ?? req.clientName}`,
    `SOUL_COMPANY_VERTICAL=${req.vertical ?? 'ventas'}`,
    `MANAGER_NAME=${req.managerName ?? 'Manager'}`,
    `OWNER_NAME=${req.ownerName ?? ''}`,
  ];
  if (req.agentConfig.provider) vars.push(`MODEL_PROVIDER=${req.agentConfig.provider}`);
  vars.push(`MODEL_NAME=${req.agentConfig.model}`);
  if (req.agentConfig.systemPrompt) vars.push(`AGENT_SYSTEM_PROMPT=${req.agentConfig.systemPrompt}`);
  if (req.agentConfig.maxTokens) vars.push(`AGENT_MAX_TOKENS=${String(req.agentConfig.maxTokens)}`);
  if (req.agentConfig.temperature !== undefined) vars.push(`AGENT_TEMPERATURE=${String(req.agentConfig.temperature)}`);
  return vars.join('\n');
}

// ─── Service Factory ────────────────────────────────────────────

/** Create a Dokploy service for managing client applications. */
export function createDokployService(deps: DokployServiceDeps): DokployService {
  const { logger, dokployUrl, dokployApiKey, dokployProjectId } = deps;
  const COMPONENT = 'dokploy-service';

  /** Make an authenticated request to the Dokploy tRPC API. */
  async function dokployRequest<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${dokployUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': dokployApiKey,
      },
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Dokploy API ${method} ${path} returned ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /** Find a Dokploy application by name within the project. */
  async function findApplicationByName(name: string): Promise<DokployApplication | undefined> {
    const projects = await dokployRequest<DokployProject[]>(
      'GET',
      '/api/trpc/project.all',
    );

    const project = projects.find((p) => p.projectId === dokployProjectId);
    if (!project) return undefined;

    return project.applications.find((app) => app.appName === name || app.name === name);
  }

  return {
    async createClientContainer(req: CreateClientRequest): Promise<ProvisioningResult> {
      const name = appName(req.clientId);

      logger.info('Creating client application via Dokploy', {
        component: COMPONENT,
        clientId: req.clientId,
        appName: name,
      });

      try {
        // Step 1: Create the application
        const createResult = await dokployRequest<TrpcBatchResponse<DokployApplication>>(
          'POST',
          '/api/trpc/application.create?batch=1',
          {
            0: {
              json: {
                name,
                projectId: dokployProjectId,
                source: 'github',
                repository: GITHUB_REPOSITORY,
                branch: GITHUB_BRANCH,
              },
            },
          },
        );

        const applicationId = createResult[0].result.data.applicationId;

        // Step 2: Set build type to Dockerfile
        await dokployRequest(
          'POST',
          '/api/trpc/application.saveBuildType?batch=1',
          {
            0: {
              json: {
                applicationId,
                buildType: 'dockerfile',
                dockerfile: './Dockerfile',
              },
            },
          },
        );

        // Step 3: Inject environment variables
        const envString = buildEnvString(req);
        await dokployRequest(
          'POST',
          '/api/trpc/application.saveEnvironment?batch=1',
          {
            0: {
              json: {
                applicationId,
                env: envString,
              },
            },
          },
        );

        // Step 4: Deploy
        await dokployRequest(
          'POST',
          '/api/trpc/application.deploy?batch=1',
          {
            0: {
              json: {
                applicationId,
              },
            },
          },
        );

        logger.info('Client application created and deployed via Dokploy', {
          component: COMPONENT,
          applicationId,
          appName: name,
        });

        return { success: true, containerId: applicationId, containerName: name };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Error creating client application via Dokploy', { component: COMPONENT, error: message });
        return { success: false, containerName: name, error: message };
      }
    },

    async destroyClientContainer(clientId: string): Promise<void> {
      const name = appName(clientId);

      logger.info('Destroying client application via Dokploy', { component: COMPONENT, appName: name });

      const app = await findApplicationByName(name);
      if (!app) {
        throw new Error(`Application for client "${clientId}" not found`);
      }

      await dokployRequest(
        'POST',
        '/api/trpc/application.delete?batch=1',
        {
          0: {
            json: {
              applicationId: app.applicationId,
            },
          },
        },
      );

      logger.info('Client application destroyed via Dokploy', { component: COMPONENT, appName: name });
    },

    async getContainerStatus(clientId: string): Promise<ClientContainerStatus> {
      const name = appName(clientId);

      const app = await findApplicationByName(name);
      if (!app) {
        throw new Error(`Container for client "${clientId}" not found`);
      }

      const result = await dokployRequest<TrpcBatchResponse<DokployApplication>>(
        'GET',
        `/api/trpc/application.one?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: { applicationId: app.applicationId } } }))}`,
      );

      const appData = result[0].result.data;
      const status = mapStatus(appData.applicationStatus);

      return {
        clientId,
        containerId: appData.applicationId,
        status,
        uptime: status === 'running'
          ? Math.floor((Date.now() - new Date(appData.createdAt).getTime()) / 1000)
          : undefined,
      };
    },

    async listClientContainers(): Promise<ClientContainerStatus[]> {
      try {
        const projects = await dokployRequest<DokployProject[]>(
          'GET',
          '/api/trpc/project.all',
        );

        const project = projects.find((p) => p.projectId === dokployProjectId);
        if (!project) return [];

        return project.applications
          .filter((app) => app.appName.startsWith(CONTAINER_PREFIX))
          .map((app) => ({
            clientId: app.appName.replace(CONTAINER_PREFIX, ''),
            containerId: app.applicationId,
            status: mapStatus(app.applicationStatus),
            uptime: undefined,
          }));
      } catch (err) {
        logger.error('Failed to list client applications from Dokploy', {
          component: COMPONENT,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    },
  };
}

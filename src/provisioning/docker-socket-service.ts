/**
 * Docker Socket Service — low-level Docker Engine API client over Unix socket.
 * Manages container lifecycle (create, destroy, inspect, list) for client provisioning.
 */
import http from 'node:http';
import type { Logger } from '@/observability/logger.js';
import type {
  CreateClientRequest,
  ProvisioningResult,
  ClientContainerStatus,
} from './provisioning-types.js';
import type { TemplateEngine } from './template-engine.js';

// ─── Constants ──────────────────────────────────────────────────

const DOCKER_SOCKET = '/var/run/docker.sock';
const CONTAINER_IMAGE = 'fomo/openclaw-client:latest';
const CONTAINER_PREFIX = 'fomo-client-';
const DOCKER_NETWORK = 'fomo-network';
const PORT_RANGE_START = 19000;
const PORT_RANGE_END = 19999;
const IMAGE_VERSION = 'latest';

// ─── Docker Socket Helper ───────────────────────────────────────

interface DockerResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Send an HTTP request to the Docker Engine API via Unix socket.
 * Returns the parsed JSON response.
 */
function dockerRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<DockerResponse> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;

    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          parsed = raw || null;
        }
        resolve({ statusCode: res.statusCode ?? 500, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Service Interface ──────────────────────────────────────────

/** Low-level Docker container management for client provisioning. */
export interface DockerSocketService {
  /** Create and start a new container for a client. */
  createClientContainer(req: CreateClientRequest): Promise<ProvisioningResult>;
  /** Stop and remove a client's container. */
  destroyClientContainer(clientId: string): Promise<void>;
  /** Get the status of a client's container. */
  getContainerStatus(clientId: string): Promise<ClientContainerStatus>;
  /** List all managed client containers. */
  listClientContainers(): Promise<ClientContainerStatus[]>;
}

// ─── Service Dependencies ───────────────────────────────────────

/** Dependencies for the Docker socket service. */
export interface DockerSocketServiceDeps {
  logger: Logger;
  templateEngine?: TemplateEngine;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Build the Docker container name from a client ID. */
function containerName(clientId: string): string {
  return `${CONTAINER_PREFIX}${clientId}`;
}

/** Map Docker container state string to our status enum. */
function mapStatus(state: string): 'running' | 'stopped' | 'error' {
  if (state === 'running') return 'running';
  if (state === 'exited' || state === 'created' || state === 'paused') return 'stopped';
  return 'error';
}

/** Build environment variables for the client container. */
function buildEnvVars(req: CreateClientRequest): string[] {
  const env: string[] = [
    `CLIENT_ID=${req.clientId}`,
    `CLIENT_NAME=${req.clientName}`,
    `INSTANCE_NAME=${req.clientId}`,
    `CHANNELS=${req.channels.join(',')}`,
    `SOUL_COMPANY_NAME=${req.companyName ?? req.clientName}`,
    `SOUL_COMPANY_VERTICAL=${req.vertical ?? 'ventas'}`,
    `MANAGER_NAME=${req.managerName ?? 'Manager'}`,
    `OWNER_NAME=${req.ownerName ?? ''}`,
  ];
  if (req.agentConfig.provider) env.push(`MODEL_PROVIDER=${req.agentConfig.provider}`);
  env.push(`MODEL_NAME=${req.agentConfig.model}`);
  if (req.agentConfig.systemPrompt) env.push(`AGENT_SYSTEM_PROMPT=${req.agentConfig.systemPrompt}`);
  if (req.agentConfig.maxTokens) env.push(`AGENT_MAX_TOKENS=${String(req.agentConfig.maxTokens)}`);
  if (req.agentConfig.temperature !== undefined) env.push(`AGENT_TEMPERATURE=${String(req.agentConfig.temperature)}`);
  return env;
}

/** Allocate a dynamic port from the provisioning range by querying existing containers. */
async function allocatePort(): Promise<number> {
  const filters = JSON.stringify({ label: ['fomo.managed=true'] });
  const res = await dockerRequest(
    'GET',
    `/containers/json?all=true&filters=${encodeURIComponent(filters)}`,
  );

  const usedPorts = new Set<number>();
  if (res.statusCode === 200 && Array.isArray(res.body)) {
    for (const container of res.body as { Labels?: Record<string, string> }[]) {
      const portLabel = container.Labels?.['com.fomo.port'];
      if (portLabel) {
        usedPorts.add(Number(portLabel));
      }
    }
  }

  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (!usedPorts.has(port)) return port;
  }

  throw new Error(`No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
}

/** Compute uptime in seconds from a Docker container start timestamp. */
function computeUptime(startedAt: string | undefined): number | undefined {
  if (!startedAt) return undefined;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return undefined;
  return Math.floor((Date.now() - started) / 1000);
}

/** Extract an error message from a Docker API response body. */
function extractDockerError(body: unknown, fallbackStatusCode: number): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    return (body as { message: string }).message;
  }
  return `Docker API returned ${fallbackStatusCode}`;
}

// ─── Service Factory ────────────────────────────────────────────

/** Create a Docker socket service for managing client containers. */
export function createDockerSocketService(deps: DockerSocketServiceDeps): DockerSocketService {
  const { logger, templateEngine } = deps;
  const COMPONENT = 'docker-socket-service';

  return {
    async createClientContainer(req: CreateClientRequest): Promise<ProvisioningResult> {
      const name = containerName(req.clientId);
      const vertical = req.vertical ?? 'ventas';

      logger.info('Creating client container', {
        component: COMPONENT,
        clientId: req.clientId,
        containerName: name,
        vertical,
      });

      try {
        // Allocate a dynamic port
        const hostPort = await allocatePort();

        // Prepare template workspace if template engine is available
        let workspaceDir: string | undefined;
        const binds: string[] = [];

        if (templateEngine) {
          const templateVars: Record<string, string> = {
            client_id: req.clientId,
            instance_name: req.clientId,
            company_name: req.companyName ?? req.clientName,
            company_vertical: vertical,
            manager_name: req.managerName ?? 'Manager',
            owner_name: req.ownerName ?? '',
            channels: req.channels.join(','),
            channels_list: req.channels.map((ch) => `- ${ch}`).join('\n'),
            channels_config: req.channels.map((ch) => `${ch}:\n    enabled: true`).join('\n  '),
            health_check_port: '8080',
            fomo_core_api_url: process.env['FOMO_CORE_API_URL'] ?? 'https://core.fomo.com.ar',
          };

          workspaceDir = await templateEngine.prepareClientWorkspace(
            req.clientId,
            vertical,
            templateVars,
          );

          binds.push(
            `${workspaceDir}/SOUL.md:/app/SOUL.md:ro`,
            `${workspaceDir}/USER.md:/app/USER.md:ro`,
            `${workspaceDir}/config:/app/config:ro`,
          );
        }

        // Create container via Docker API
        const createRes = await dockerRequest(
          'POST',
          `/containers/create?name=${encodeURIComponent(name)}`,
          {
            Image: CONTAINER_IMAGE,
            Env: buildEnvVars(req),
            ExposedPorts: { '8080/tcp': {} },
            HostConfig: {
              NetworkMode: DOCKER_NETWORK,
              RestartPolicy: { Name: 'unless-stopped' },
              PortBindings: {
                '8080/tcp': [{ HostPort: String(hostPort) }],
              },
              Binds: binds.length > 0 ? binds : undefined,
            },
            Labels: {
              'fomo.managed': 'true',
              'fomo.client-id': req.clientId,
              'fomo.client-name': req.clientName,
              'fomo.channels': req.channels.join(','),
              'com.fomo.clientId': req.clientId,
              'com.fomo.vertical': vertical,
              'com.fomo.version': IMAGE_VERSION,
              'com.fomo.port': String(hostPort),
            },
          },
        );

        if (createRes.statusCode !== 201) {
          const msg = extractDockerError(createRes.body, createRes.statusCode);
          logger.error('Failed to create container', { component: COMPONENT, error: msg });
          return { success: false, containerName: name, error: msg };
        }

        const containerId = (createRes.body as { Id: string }).Id;

        // Start the container
        const startRes = await dockerRequest('POST', `/containers/${containerId}/start`);
        if (startRes.statusCode !== 204 && startRes.statusCode !== 304) {
          logger.error('Failed to start container', { component: COMPONENT, containerId });
          return {
            success: false,
            containerId,
            containerName: name,
            error: 'Container created but failed to start',
          };
        }

        logger.info('Client container created and started', {
          component: COMPONENT,
          containerId,
          containerName: name,
          hostPort,
          vertical,
        });

        return { success: true, containerId, containerName: name };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Error creating client container', { component: COMPONENT, error: message });
        return { success: false, containerName: name, error: message };
      }
    },

    async destroyClientContainer(clientId: string): Promise<void> {
      const name = containerName(clientId);

      logger.info('Destroying client container', { component: COMPONENT, containerName: name });

      // Stop first (ignore errors — container may already be stopped)
      await dockerRequest('POST', `/containers/${encodeURIComponent(name)}/stop`).catch(() => {
        /* noop */
      });

      // Remove with force
      const res = await dockerRequest('DELETE', `/containers/${encodeURIComponent(name)}?force=true`);
      if (res.statusCode !== 204 && res.statusCode !== 404) {
        const msg = extractDockerError(res.body, res.statusCode);
        throw new Error(`Failed to destroy container "${name}": ${msg}`);
      }

      logger.info('Client container destroyed', { component: COMPONENT, containerName: name });
    },

    async getContainerStatus(clientId: string): Promise<ClientContainerStatus> {
      const name = containerName(clientId);

      const res = await dockerRequest('GET', `/containers/${encodeURIComponent(name)}/json`);
      if (res.statusCode === 404) {
        throw new Error(`Container for client "${clientId}" not found`);
      }

      const info = res.body as {
        Id: string;
        State: { Status: string; StartedAt?: string };
      };

      return {
        clientId,
        containerId: info.Id,
        status: mapStatus(info.State.Status),
        uptime: info.State.Status === 'running' ? computeUptime(info.State.StartedAt) : undefined,
      };
    },

    async listClientContainers(): Promise<ClientContainerStatus[]> {
      const filters = JSON.stringify({ label: ['fomo.managed=true'] });
      const res = await dockerRequest(
        'GET',
        `/containers/json?all=true&filters=${encodeURIComponent(filters)}`,
      );

      if (res.statusCode !== 200) return [];

      const containers = res.body as {
        Id: string;
        State: string;
        Status: string;
        Created: number;
        Labels: Record<string, string>;
      }[];

      return containers.map((c) => ({
        clientId: c.Labels['fomo.client-id'] ?? 'unknown',
        containerId: c.Id,
        status: mapStatus(c.State),
        uptime: undefined, // List endpoint doesn't provide StartedAt — use getContainerStatus for uptime
      }));
    },
  };
}

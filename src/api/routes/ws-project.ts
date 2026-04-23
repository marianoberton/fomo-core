/**
 * Project live events WebSocket route.
 *
 * GET /api/v1/ws/project/:projectId?apiKey=<nx_...>
 *
 * Authenticates using the same API key rules as REST (DB-backed + env-var
 * fallback). Subscribes the connection to the per-project event bus and
 * pushes every ProjectEvent for that project as a JSON line.
 *
 * This is a read-only push stream — inbound messages from the client are
 * ignored.
 *
 * Backpressure: if the socket's internal buffer grows past BACKPRESSURE_BYTES
 * for more than BACKPRESSURE_TIMEOUT_MS, we close the connection with 1008
 * so the client can reconnect and resume at HEAD.
 */
import type { FastifyInstance } from 'fastify';
import type { ProjectId } from '@/core/types.js';
import type { RouteDependencies } from '../types.js';

// ─── Constants ──────────────────────────────────────────────────

const HEARTBEAT_MS = 30_000;
const BACKPRESSURE_BYTES = 1_000_000; // 1 MB
const BACKPRESSURE_TIMEOUT_MS = 5_000;

// ─── Socket Shape ───────────────────────────────────────────────

interface ProjectSocket {
  readonly readyState: number;
  /** Buffered but not-yet-flushed bytes (ws native socket exposes this). */
  readonly bufferedAmount?: number;
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'message', listener: (data: Buffer) => void): void;
}

// ─── Route Plugin ───────────────────────────────────────────────

/**
 * Register the project live-events WS route.
 * Must be registered inside the scope that has `@fastify/websocket` loaded.
 */
export function wsProjectRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { eventBus, apiKeyService, logger } = deps;

  fastify.get('/ws/project/:projectId', { websocket: true }, (socket, request) => {
    const s = socket as unknown as ProjectSocket;
    const { projectId } = request.params as { projectId: string };

    if (!projectId) {
      s.close(1008, 'projectId required');
      return;
    }

    // Extract API key from query (?apiKey=) or Authorization header.
    const query = request.query as Record<string, string> | undefined;
    const authHeader = request.headers.authorization;
    const headerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    const apiKey = query?.['apiKey'] ?? headerToken ?? '';

    if (!apiKey) {
      s.close(1008, 'unauthorized');
      return;
    }

    // Validate the key (DB-backed, then env-var fallback).
    const envKey = process.env['NEXUS_API_KEY'];

    void (async (): Promise<void> => {
      let valid = false;
      let keyProjectId: string | null = null;

      const envMatch = envKey && apiKey === envKey;
      if (envMatch) {
        valid = true;
        keyProjectId = null; // master
      } else {
        const result = await apiKeyService.validateApiKey(apiKey);
        if (result.valid) {
          valid = true;
          keyProjectId = result.projectId;
        }
      }

      if (!valid) {
        logger.warn('Rejected WS connection with invalid API key', {
          component: 'ws-project',
          projectId,
          ip: request.ip,
        });
        s.close(1008, 'unauthorized');
        return;
      }

      // Master key (keyProjectId === null) has full access. Scoped key must
      // match the requested projectId.
      if (keyProjectId !== null && keyProjectId !== projectId) {
        logger.warn('Rejected WS connection with cross-project API key', {
          component: 'ws-project',
          projectId,
          keyProjectId,
          ip: request.ip,
        });
        s.close(1008, 'forbidden');
        return;
      }

      logger.info('WS project connection opened', {
        component: 'ws-project',
        projectId,
        scoped: keyProjectId !== null,
      });

      // Subscribe to the bus. The emit is synchronous, so we try/catch each
      // send to avoid one faulty listener killing the server.
      let overflowedSince: number | null = null;

      const unsubscribe = eventBus.subscribe(projectId as ProjectId, (event) => {
        if (s.readyState !== 1 /* OPEN */) return;

        // Backpressure guard
        if (typeof s.bufferedAmount === 'number' && s.bufferedAmount > BACKPRESSURE_BYTES) {
          overflowedSince ??= Date.now();
          if (Date.now() - overflowedSince > BACKPRESSURE_TIMEOUT_MS) {
            logger.warn('WS backpressure timeout — closing', {
              component: 'ws-project',
              projectId,
              bufferedAmount: s.bufferedAmount,
            });
            s.close(1008, 'backpressure');
            return;
          }
        } else {
          overflowedSince = null;
        }

        try {
          s.send(JSON.stringify(event));
        } catch (err) {
          logger.warn('WS send failed', {
            component: 'ws-project',
            projectId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      const heartbeat = setInterval(() => {
        if (s.readyState === 1) {
          try {
            s.ping();
          } catch {
            /* ignore */
          }
        }
      }, HEARTBEAT_MS);

      // Ignore inbound messages — this is a read-only push stream.
      s.on('message', () => { /* noop */ });

      s.on('close', (code, reason) => {
        unsubscribe();
        clearInterval(heartbeat);
        logger.info('WS project connection closed', {
          component: 'ws-project',
          projectId,
          code,
          reason: reason.toString(),
        });
      });

      s.on('error', (err) => {
        logger.warn('WS project connection error', {
          component: 'ws-project',
          projectId,
          error: err.message,
        });
      });
    })();
  });
}

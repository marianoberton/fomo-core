/**
 * Agent Registry — cached access to agent configurations.
 *
 * Provides a caching layer over the agent repository with configurable TTL.
 */
import type { Logger } from 'pino';
import type {
  AgentId,
  AgentConfig,
  AgentRegistry,
  AgentRepository,
} from './types.js';

// ─── Cache Entry ─────────────────────────────────────────────────

interface CacheEntry {
  config: AgentConfig;
  expiresAt: number;
}

// ─── Registry Dependencies ───────────────────────────────────────

interface RegistryDeps {
  agentRepository: AgentRepository;
  logger: Logger;
  /** Cache TTL in milliseconds. Default: 60000 (1 minute). */
  cacheTtlMs?: number;
}

// ─── Factory Function ────────────────────────────────────────────

/**
 * Create an agent registry with caching.
 */
export function createAgentRegistry(deps: RegistryDeps): AgentRegistry {
  const cache = new Map<string, CacheEntry>();
  const cacheTtlMs = deps.cacheTtlMs ?? 60000;

  function isValid(entry: CacheEntry | undefined): entry is CacheEntry {
    return entry !== undefined && entry.expiresAt > Date.now();
  }

  function setCached(config: AgentConfig): void {
    cache.set(config.id, {
      config,
      expiresAt: Date.now() + cacheTtlMs,
    });
  }

  const registry: AgentRegistry = {
    async get(agentId: AgentId): Promise<AgentConfig | null> {
      const cached = cache.get(agentId);
      if (isValid(cached)) {
        deps.logger.debug({ agentId }, 'Agent cache hit');
        return cached.config;
      }

      deps.logger.debug({ agentId }, 'Agent cache miss, fetching from repository');
      const config = await deps.agentRepository.findById(agentId);

      if (config) {
        setCached(config);
      }

      return config;
    },

    async getByName(projectId: string, name: string): Promise<AgentConfig | null> {
      // Check cache first by iterating
      for (const entry of cache.values()) {
        if (
          isValid(entry) &&
          entry.config.projectId === projectId &&
          entry.config.name === name
        ) {
          deps.logger.debug({ projectId, name }, 'Agent cache hit by name');
          return entry.config;
        }
      }

      deps.logger.debug({ projectId, name }, 'Agent cache miss by name, fetching from repository');
      const config = await deps.agentRepository.findByName(projectId, name);

      if (config) {
        setCached(config);
      }

      return config;
    },

    async list(projectId: string): Promise<AgentConfig[]> {
      // List always goes to repository to ensure fresh data
      return deps.agentRepository.list(projectId);
    },

    async refresh(agentId: AgentId): Promise<void> {
      deps.logger.debug({ agentId }, 'Refreshing agent cache');
      cache.delete(agentId);
      await registry.get(agentId);
    },

    invalidate(agentId: AgentId): void {
      deps.logger.debug({ agentId }, 'Invalidating agent cache');
      cache.delete(agentId);
    },
  };

  return registry;
}

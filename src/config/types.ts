import type { AgentConfig } from '@/core/types.js';

// ─── Project Configuration ──────────────────────────────────────

/**
 * Full project configuration as stored in the database.
 * The `agentConfig` field maps directly to AgentConfig.
 */
export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  environment: 'production' | 'staging' | 'development';
  owner: string;
  tags: string[];
  agentConfig: AgentConfig;
  status: 'active' | 'paused' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
}

import { describe, expect, it } from 'vitest';

import {
  agentConfigSchema,
  costConfigSchema,
  failoverConfigSchema,
  llmProviderConfigSchema,
  mcpServerConfigSchema,
  memoryConfigSchema,
  projectConfigFileSchema,
} from './schema.js';

// ─── Test Fixtures ──────────────────────────────────────────────

const validLLMProviderConfig = {
  provider: 'anthropic' as const,
  model: 'claude-sonnet-4-5-20250929',
  temperature: 0.7,
  maxOutputTokens: 4096,
  apiKeyEnvVar: 'ANTHROPIC_API_KEY',
};

const validFailoverConfig = {
  onRateLimit: true,
  onServerError: true,
  onTimeout: true,
  timeoutMs: 30000,
  maxRetries: 3,
};

const validMemoryConfig = {
  longTerm: {
    enabled: true,
    maxEntries: 1000,
    retrievalTopK: 5,
    embeddingProvider: 'openai',
    decayEnabled: true,
    decayHalfLifeDays: 30,
  },
  contextWindow: {
    reserveTokens: 2000,
    pruningStrategy: 'turn-based' as const,
    maxTurnsInContext: 20,
    compaction: {
      enabled: true,
      memoryFlushBeforeCompaction: true,
    },
  },
};

const validCostConfig = {
  dailyBudgetUSD: 10,
  monthlyBudgetUSD: 100,
  maxTokensPerTurn: 4096,
  maxTurnsPerSession: 50,
  maxToolCallsPerTurn: 10,
  alertThresholdPercent: 80,
  hardLimitPercent: 100,
  maxRequestsPerMinute: 60,
  maxRequestsPerHour: 1000,
};

const validAgentConfig = {
  projectId: 'proj-123',
  agentRole: 'assistant',
  provider: validLLMProviderConfig,
  failover: validFailoverConfig,
  allowedTools: ['web_search', 'file_read'],
  memoryConfig: validMemoryConfig,
  costConfig: validCostConfig,
  maxTurnsPerSession: 100,
  maxConcurrentSessions: 5,
};

const validProjectConfigFile = {
  id: 'proj-123',
  name: 'Test Project',
  description: 'A test project for validation',
  environment: 'development' as const,
  owner: 'test-user',
  tags: ['test', 'validation'],
  agentConfig: validAgentConfig,
};

// ─── llmProviderConfigSchema Tests ──────────────────────────────

describe('llmProviderConfigSchema', () => {
  it('accepts valid anthropic config', () => {
    const result = llmProviderConfigSchema.safeParse(validLLMProviderConfig);
    expect(result.success).toBe(true);
  });

  it('accepts valid openai config', () => {
    const config = { ...validLLMProviderConfig, provider: 'openai', model: 'gpt-4o' };
    const result = llmProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts valid google config', () => {
    const config = { ...validLLMProviderConfig, provider: 'google', model: 'gemini-pro' };
    const result = llmProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts valid ollama config with baseUrl', () => {
    const config = {
      provider: 'ollama',
      model: 'llama2',
      baseUrl: 'http://localhost:11434',
    };
    const result = llmProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects invalid provider', () => {
    const config = { ...validLLMProviderConfig, provider: 'invalid-provider' };
    const result = llmProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects empty model', () => {
    const config = { ...validLLMProviderConfig, model: '' };
    const result = llmProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts config without optional fields', () => {
    const config = { provider: 'anthropic', model: 'claude-3-haiku' };
    const result = llmProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects temperature above 2', () => {
    const config = { ...validLLMProviderConfig, temperature: 2.5 };
    const result = llmProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects negative temperature', () => {
    const config = { ...validLLMProviderConfig, temperature: -0.5 };
    const result = llmProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects invalid baseUrl format', () => {
    const config = { ...validLLMProviderConfig, baseUrl: 'not-a-url' };
    const result = llmProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

// ─── failoverConfigSchema Tests ─────────────────────────────────

describe('failoverConfigSchema', () => {
  it('accepts valid failover config', () => {
    const result = failoverConfigSchema.safeParse(validFailoverConfig);
    expect(result.success).toBe(true);
  });

  it('rejects negative timeoutMs', () => {
    const config = { ...validFailoverConfig, timeoutMs: -1000 };
    const result = failoverConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects maxRetries above 10', () => {
    const config = { ...validFailoverConfig, maxRetries: 15 };
    const result = failoverConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts maxRetries of 0', () => {
    const config = { ...validFailoverConfig, maxRetries: 0 };
    const result = failoverConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects non-integer timeoutMs', () => {
    const config = { ...validFailoverConfig, timeoutMs: 1000.5 };
    const result = failoverConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

// ─── memoryConfigSchema Tests ───────────────────────────────────

describe('memoryConfigSchema', () => {
  it('accepts valid memory config', () => {
    const result = memoryConfigSchema.safeParse(validMemoryConfig);
    expect(result.success).toBe(true);
  });

  it('rejects negative maxEntries', () => {
    const config = {
      ...validMemoryConfig,
      longTerm: { ...validMemoryConfig.longTerm, maxEntries: -100 },
    };
    const result = memoryConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects invalid pruning strategy', () => {
    const config = {
      ...validMemoryConfig,
      contextWindow: { ...validMemoryConfig.contextWindow, pruningStrategy: 'invalid' },
    };
    const result = memoryConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts token-based pruning strategy', () => {
    const config = {
      ...validMemoryConfig,
      contextWindow: { ...validMemoryConfig.contextWindow, pruningStrategy: 'token-based' },
    };
    const result = memoryConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects empty embeddingProvider', () => {
    const config = {
      ...validMemoryConfig,
      longTerm: { ...validMemoryConfig.longTerm, embeddingProvider: '' },
    };
    const result = memoryConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

// ─── costConfigSchema Tests ─────────────────────────────────────

describe('costConfigSchema', () => {
  it('accepts valid cost config', () => {
    const result = costConfigSchema.safeParse(validCostConfig);
    expect(result.success).toBe(true);
  });

  it('rejects negative daily budget', () => {
    const config = { ...validCostConfig, dailyBudgetUSD: -5 };
    const result = costConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects alertThresholdPercent above 100', () => {
    const config = { ...validCostConfig, alertThresholdPercent: 150 };
    const result = costConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts alertThresholdPercent of 0', () => {
    const config = { ...validCostConfig, alertThresholdPercent: 0 };
    const result = costConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts hardLimitPercent up to 200', () => {
    const config = { ...validCostConfig, hardLimitPercent: 200 };
    const result = costConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects hardLimitPercent above 200', () => {
    const config = { ...validCostConfig, hardLimitPercent: 250 };
    const result = costConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects zero maxTokensPerTurn', () => {
    const config = { ...validCostConfig, maxTokensPerTurn: 0 };
    const result = costConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

// ─── agentConfigSchema Tests ────────────────────────────────────

describe('agentConfigSchema', () => {
  it('accepts valid agent config', () => {
    const result = agentConfigSchema.safeParse(validAgentConfig);
    expect(result.success).toBe(true);
  });

  it('accepts agent config with fallback provider', () => {
    const config = {
      ...validAgentConfig,
      fallbackProvider: { provider: 'openai', model: 'gpt-4o' },
    };
    const result = agentConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects empty projectId', () => {
    const config = { ...validAgentConfig, projectId: '' };
    const result = agentConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects empty agentRole', () => {
    const config = { ...validAgentConfig, agentRole: '' };
    const result = agentConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts empty allowedTools array', () => {
    const config = { ...validAgentConfig, allowedTools: [] };
    const result = agentConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects allowedTools with empty string', () => {
    const config = { ...validAgentConfig, allowedTools: ['valid_tool', ''] };
    const result = agentConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

// ─── projectConfigFileSchema Tests ──────────────────────────────

describe('projectConfigFileSchema', () => {
  it('accepts valid project config file', () => {
    const result = projectConfigFileSchema.safeParse(validProjectConfigFile);
    expect(result.success).toBe(true);
  });

  it('rejects empty project id', () => {
    const config = { ...validProjectConfigFile, id: '' };
    const result = projectConfigFileSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects empty project name', () => {
    const config = { ...validProjectConfigFile, name: '' };
    const result = projectConfigFileSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects project name exceeding 100 characters', () => {
    const config = { ...validProjectConfigFile, name: 'a'.repeat(101) };
    const result = projectConfigFileSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts project without description', () => {
    const { description: _description, ...configWithoutDesc } = validProjectConfigFile;
    void _description;
    const result = projectConfigFileSchema.safeParse(configWithoutDesc);
    expect(result.success).toBe(true);
  });

  it('rejects description exceeding 500 characters', () => {
    const config = { ...validProjectConfigFile, description: 'a'.repeat(501) };
    const result = projectConfigFileSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects invalid environment', () => {
    const config = { ...validProjectConfigFile, environment: 'invalid' };
    const result = projectConfigFileSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts all valid environments', () => {
    for (const env of ['production', 'staging', 'development']) {
      const config = { ...validProjectConfigFile, environment: env };
      const result = projectConfigFileSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });

  it('rejects when project id does not match agentConfig.projectId', () => {
    const config = {
      ...validProjectConfigFile,
      id: 'proj-123',
      agentConfig: { ...validAgentConfig, projectId: 'proj-456' },
    };
    const result = projectConfigFileSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      expect(firstIssue).toBeDefined();
      expect(firstIssue?.message).toBe('Project ID must match agentConfig.projectId');
    }
  });

  it('accepts matching project id and agentConfig.projectId', () => {
    const config = {
      ...validProjectConfigFile,
      id: 'my-project',
      agentConfig: { ...validAgentConfig, projectId: 'my-project' },
    };
    const result = projectConfigFileSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts empty tags array', () => {
    const config = { ...validProjectConfigFile, tags: [] };
    const result = projectConfigFileSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});

// ─── mcpServerConfigSchema Tests ───────────────────────────────

describe('mcpServerConfigSchema', () => {
  it('accepts valid stdio config', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'google-calendar',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@anthropic/mcp-google-calendar'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid sse config', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'remote-server',
      transport: 'sse',
      url: 'http://localhost:8080/mcp',
    });
    expect(result.success).toBe(true);
  });

  it('accepts stdio config with env vars', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'with-env',
      transport: 'stdio',
      command: 'node',
      env: { API_KEY: 'MY_API_KEY_ENV_VAR' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts config with custom toolPrefix', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'google-calendar',
      transport: 'stdio',
      command: 'npx',
      toolPrefix: 'gcal',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty server name', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: '',
      transport: 'stdio',
      command: 'npx',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid transport type', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test',
      transport: 'websocket',
      command: 'npx',
    });
    expect(result.success).toBe(false);
  });

  it('rejects stdio without command', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test',
      transport: 'stdio',
    });
    expect(result.success).toBe(false);
  });

  it('rejects sse without url', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test',
      transport: 'sse',
    });
    expect(result.success).toBe(false);
  });

  it('rejects sse with invalid url', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'test',
      transport: 'sse',
      url: 'not-a-valid-url',
    });
    expect(result.success).toBe(false);
  });
});

// ─── agentConfigSchema — mcpServers Tests ──────────────────────

describe('agentConfigSchema — mcpServers', () => {
  it('accepts agent config without mcpServers', () => {
    const result = agentConfigSchema.safeParse(validAgentConfig);
    expect(result.success).toBe(true);
  });

  it('accepts agent config with mcpServers', () => {
    const config = {
      ...validAgentConfig,
      mcpServers: [
        { name: 'gcal', transport: 'stdio' as const, command: 'npx' },
        { name: 'remote', transport: 'sse' as const, url: 'http://localhost:8080/mcp' },
      ],
    };
    const result = agentConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts agent config with empty mcpServers array', () => {
    const config = { ...validAgentConfig, mcpServers: [] };
    const result = agentConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects agent config with invalid mcpServer entry', () => {
    const config = {
      ...validAgentConfig,
      mcpServers: [{ name: '', transport: 'stdio' }],
    };
    const result = agentConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

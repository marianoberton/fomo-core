import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigError, loadProjectConfig, resolveEnvVars } from './loader.js';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const mockedReadFile = vi.mocked(readFile);

// ─── Test Fixtures ──────────────────────────────────────────────

const validConfigJson = {
  id: 'proj-123',
  name: 'Test Project',
  description: 'A test project',
  environment: 'development',
  owner: 'test-user',
  tags: ['test'],
  agentConfig: {
    projectId: 'proj-123',
    agentRole: 'assistant',
    provider: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
    },
    failover: {
      onRateLimit: true,
      onServerError: true,
      onTimeout: true,
      timeoutMs: 30000,
      maxRetries: 3,
    },
    allowedTools: ['web_search'],
    memoryConfig: {
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
        pruningStrategy: 'turn-based',
        maxTurnsInContext: 20,
        compaction: {
          enabled: true,
          memoryFlushBeforeCompaction: true,
        },
      },
    },
    costConfig: {
      dailyBudgetUSD: 10,
      monthlyBudgetUSD: 100,
      maxTokensPerTurn: 4096,
      maxTurnsPerSession: 50,
      maxToolCallsPerTurn: 10,
      alertThresholdPercent: 80,
      hardLimitPercent: 100,
      maxRequestsPerMinute: 60,
      maxRequestsPerHour: 1000,
    },
    maxTurnsPerSession: 100,
    maxConcurrentSessions: 5,
  },
};

// ─── resolveEnvVars Tests ───────────────────────────────────────

describe('resolveEnvVars', () => {
  beforeEach(() => {
    vi.stubEnv('TEST_VAR', 'test-value');
    vi.stubEnv('API_KEY', 'sk-secret-key');
    vi.stubEnv('ANOTHER_VAR', 'another-value');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('replaces ${VAR} with the environment variable value', () => {
    const result = resolveEnvVars('${TEST_VAR}');
    expect(result).toBe('test-value');
  });

  it('handles nested objects', () => {
    const input = {
      level1: {
        level2: {
          value: '${TEST_VAR}',
        },
      },
    };
    const result = resolveEnvVars(input);
    expect(result).toEqual({
      level1: {
        level2: {
          value: 'test-value',
        },
      },
    });
  });

  it('handles arrays', () => {
    const input = ['${TEST_VAR}', '${API_KEY}', 'plain-string'];
    const result = resolveEnvVars(input);
    expect(result).toEqual(['test-value', 'sk-secret-key', 'plain-string']);
  });

  it('leaves strings without ${} intact', () => {
    const result = resolveEnvVars('plain string without env vars');
    expect(result).toBe('plain string without env vars');
  });

  it('throws ConfigError if the env var does not exist', () => {
    expect(() => resolveEnvVars('${NONEXISTENT_VAR}')).toThrow(ConfigError);
    expect(() => resolveEnvVars('${NONEXISTENT_VAR}')).toThrow(
      'Environment variable "NONEXISTENT_VAR" is not defined',
    );
  });

  it('does not modify numbers', () => {
    const result = resolveEnvVars(42);
    expect(result).toBe(42);
  });

  it('does not modify booleans', () => {
    const result = resolveEnvVars(true);
    expect(result).toBe(true);
  });

  it('does not modify null', () => {
    const result = resolveEnvVars(null);
    expect(result).toBe(null);
  });

  it('handles mixed objects with env vars and plain values', () => {
    const input = {
      apiKey: '${API_KEY}',
      count: 5,
      enabled: true,
      name: 'plain-name',
      nested: {
        secret: '${TEST_VAR}',
      },
    };
    const result = resolveEnvVars(input);
    expect(result).toEqual({
      apiKey: 'sk-secret-key',
      count: 5,
      enabled: true,
      name: 'plain-name',
      nested: {
        secret: 'test-value',
      },
    });
  });

  it('handles arrays within objects', () => {
    const input = {
      values: ['${TEST_VAR}', 'static', '${ANOTHER_VAR}'],
    };
    const result = resolveEnvVars(input);
    expect(result).toEqual({
      values: ['test-value', 'static', 'another-value'],
    });
  });

  it('does not replace partial patterns like prefix${VAR}suffix', () => {
    const result = resolveEnvVars('prefix${TEST_VAR}suffix');
    expect(result).toBe('prefix${TEST_VAR}suffix');
  });
});

// ─── loadProjectConfig Tests ────────────────────────────────────

describe('loadProjectConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TEST_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads and validates a valid config', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify(validConfigJson));

    const result = await loadProjectConfig('/path/to/config.json');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('proj-123');
      expect(result.value.name).toBe('Test Project');
      expect(result.value.agentConfig.provider.model).toBe('claude-sonnet-4-5-20250929');
    }
  });

  it('returns error if the file does not exist', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockedReadFile.mockRejectedValue(error);

    const result = await loadProjectConfig('/nonexistent/config.json');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Configuration file not found');
    }
  });

  it('returns error if the JSON is invalid', async () => {
    mockedReadFile.mockResolvedValue('{ invalid json }');

    const result = await loadProjectConfig('/path/to/invalid.json');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Invalid JSON');
    }
  });

  it('returns error if Zod validation fails', async () => {
    const invalidConfig = { ...validConfigJson, name: '' }; // Empty name is invalid
    mockedReadFile.mockResolvedValue(JSON.stringify(invalidConfig));

    const result = await loadProjectConfig('/path/to/config.json');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Configuration validation failed');
    }
  });

  it('resolves env vars before validation', async () => {
    const configWithEnvVar = {
      ...validConfigJson,
      agentConfig: {
        ...validConfigJson.agentConfig,
        provider: {
          ...validConfigJson.agentConfig.provider,
          apiKeyEnvVar: '${TEST_API_KEY}',
        },
      },
    };
    mockedReadFile.mockResolvedValue(JSON.stringify(configWithEnvVar));

    const result = await loadProjectConfig('/path/to/config.json');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agentConfig.provider.apiKeyEnvVar).toBe('test-key');
    }
  });

  it('returns error when projectId in agentConfig does not match id', async () => {
    const mismatchedConfig = {
      ...validConfigJson,
      id: 'proj-123',
      agentConfig: {
        ...validConfigJson.agentConfig,
        projectId: 'proj-456', // Mismatched!
      },
    };
    mockedReadFile.mockResolvedValue(JSON.stringify(mismatchedConfig));

    const result = await loadProjectConfig('/path/to/config.json');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Configuration validation failed');
    }
  });

  it('returns error when env var resolution fails', async () => {
    const configWithMissingEnvVar = {
      ...validConfigJson,
      agentConfig: {
        ...validConfigJson.agentConfig,
        provider: {
          ...validConfigJson.agentConfig.provider,
          apiKeyEnvVar: '${MISSING_ENV_VAR}',
        },
      },
    };
    mockedReadFile.mockResolvedValue(JSON.stringify(configWithMissingEnvVar));

    const result = await loadProjectConfig('/path/to/config.json');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('MISSING_ENV_VAR');
    }
  });

  it('handles file read permission errors', async () => {
    const error = new Error('EACCES') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    mockedReadFile.mockRejectedValue(error);

    const result = await loadProjectConfig('/protected/config.json');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain('Failed to read configuration file');
    }
  });
});

// ─── ConfigError Tests ──────────────────────────────────────────

describe('ConfigError', () => {
  it('has correct error code', () => {
    const error = new ConfigError('test message');
    expect(error.code).toBe('CONFIG_ERROR');
  });

  it('has correct status code', () => {
    const error = new ConfigError('test message');
    expect(error.statusCode).toBe(400);
  });

  it('includes context when provided', () => {
    const error = new ConfigError('test message', { filePath: '/test/path' });
    expect(error.context).toEqual({ filePath: '/test/path' });
  });

  it('has correct name', () => {
    const error = new ConfigError('test message');
    expect(error.name).toBe('ConfigError');
  });
});

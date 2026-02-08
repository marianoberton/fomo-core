import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMProviderConfig } from '@/core/types.js';
import { ProviderError } from '@/core/errors.js';

// Mock the provider constructors to avoid real SDK initialization
vi.mock('./anthropic.js', () => ({
  createAnthropicProvider: vi.fn(() => ({
    id: 'anthropic:claude-sonnet-4-5-20250929',
    displayName: 'Anthropic claude-sonnet-4-5-20250929',
  })),
}));

vi.mock('./openai.js', () => ({
  createOpenAIProvider: vi.fn(() => ({
    id: 'openai:gpt-4o',
    displayName: 'OpenAI gpt-4o',
  })),
}));

// Import after mocks are set up
const { createProvider } = await import('./factory.js');
const { createAnthropicProvider } = await import('./anthropic.js');
const { createOpenAIProvider } = await import('./openai.js');

describe('createProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates an Anthropic provider when configured', () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const config: LLMProviderConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    };

    createProvider(config);

    expect(createAnthropicProvider).toHaveBeenCalledWith({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-5-20250929',
      baseUrl: undefined,
    });
  });

  it('creates an OpenAI provider when configured', () => {
    process.env['OPENAI_API_KEY'] = 'test-key';

    const config: LLMProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKeyEnvVar: 'OPENAI_API_KEY',
    };

    createProvider(config);

    expect(createOpenAIProvider).toHaveBeenCalledWith({
      apiKey: 'test-key',
      model: 'gpt-4o',
      baseUrl: undefined,
      providerLabel: 'openai',
    });
  });

  it('creates a Google provider via OpenAI-compatible adapter', () => {
    process.env['GOOGLE_API_KEY'] = 'test-key';

    const config: LLMProviderConfig = {
      provider: 'google',
      model: 'gemini-2.5-pro',
      apiKeyEnvVar: 'GOOGLE_API_KEY',
    };

    createProvider(config);

    expect(createOpenAIProvider).toHaveBeenCalledWith({
      apiKey: 'test-key',
      model: 'gemini-2.5-pro',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      providerLabel: 'google',
    });
  });

  it('creates an Ollama provider without requiring an API key', () => {
    const config: LLMProviderConfig = {
      provider: 'ollama',
      model: 'llama3',
    };

    createProvider(config);

    expect(createOpenAIProvider).toHaveBeenCalledWith({
      apiKey: 'ollama',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
      providerLabel: 'ollama',
    });
  });

  it('uses custom baseUrl for Ollama when provided', () => {
    const config: LLMProviderConfig = {
      provider: 'ollama',
      model: 'llama3',
      baseUrl: 'http://my-server:11434/v1',
    };

    createProvider(config);

    expect(createOpenAIProvider).toHaveBeenCalledWith({
      apiKey: 'ollama',
      model: 'llama3',
      baseUrl: 'http://my-server:11434/v1',
      providerLabel: 'ollama',
    });
  });

  it('throws ProviderError when apiKeyEnvVar is not configured', () => {
    const config: LLMProviderConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
    };

    expect(() => createProvider(config)).toThrow(ProviderError);
  });

  it('throws ProviderError when env var is not set', () => {
    delete process.env['MISSING_KEY'];

    const config: LLMProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKeyEnvVar: 'MISSING_KEY',
    };

    expect(() => createProvider(config)).toThrow(ProviderError);
    expect(() => createProvider(config)).toThrow('not set or empty');
  });
});

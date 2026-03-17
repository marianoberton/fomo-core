/**
 * Tests for provisioning Zod schemas — validates input rejection and acceptance.
 */
import { describe, it, expect } from 'vitest';
import {
  CreateClientRequestSchema,
  ProvisioningResultSchema,
  ClientContainerStatusSchema,
  AgentConfigSchema,
} from '@/provisioning/provisioning-types.js';

// ─── AgentConfig Schema ─────────────────────────────────────────

describe('AgentConfigSchema', () => {
  it('accepts valid config with required fields', () => {
    const result = AgentConfigSchema.safeParse({ model: 'gpt-4o' });
    expect(result.success).toBe(true);
  });

  it('accepts config with all optional fields', () => {
    const result = AgentConfigSchema.safeParse({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: 'You are helpful',
      maxTokens: 4096,
      temperature: 0.7,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty model', () => {
    const result = AgentConfigSchema.safeParse({ model: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid provider', () => {
    const result = AgentConfigSchema.safeParse({ model: 'gpt-4o', provider: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects temperature above 2', () => {
    const result = AgentConfigSchema.safeParse({ model: 'gpt-4o', temperature: 3 });
    expect(result.success).toBe(false);
  });

  it('rejects negative maxTokens', () => {
    const result = AgentConfigSchema.safeParse({ model: 'gpt-4o', maxTokens: -1 });
    expect(result.success).toBe(false);
  });
});

// ─── CreateClientRequest Schema ─────────────────────────────────

describe('CreateClientRequestSchema', () => {
  const validRequest = {
    clientId: 'client-001',
    clientName: 'Acme Corp',
    channels: ['whatsapp', 'telegram'],
    agentConfig: { model: 'gpt-4o' },
  };

  it('accepts a valid request', () => {
    const result = CreateClientRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it('accepts single channel', () => {
    const result = CreateClientRequestSchema.safeParse({
      ...validRequest,
      channels: ['slack'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty clientId', () => {
    const result = CreateClientRequestSchema.safeParse({
      ...validRequest,
      clientId: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty clientName', () => {
    const result = CreateClientRequestSchema.safeParse({
      ...validRequest,
      clientName: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty channels array', () => {
    const result = CreateClientRequestSchema.safeParse({
      ...validRequest,
      channels: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channel value', () => {
    const result = CreateClientRequestSchema.safeParse({
      ...validRequest,
      channels: ['email'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing agentConfig', () => {
    const { agentConfig: _, ...withoutConfig } = validRequest;
    const result = CreateClientRequestSchema.safeParse(withoutConfig);
    expect(result.success).toBe(false);
  });

  it('rejects clientId exceeding 128 chars', () => {
    const result = CreateClientRequestSchema.safeParse({
      ...validRequest,
      clientId: 'a'.repeat(129),
    });
    expect(result.success).toBe(false);
  });
});

// ─── ProvisioningResult Schema ──────────────────────────────────

describe('ProvisioningResultSchema', () => {
  it('accepts success result with containerId', () => {
    const result = ProvisioningResultSchema.safeParse({
      success: true,
      containerId: 'abc123',
      containerName: 'fomo-client-001',
    });
    expect(result.success).toBe(true);
  });

  it('accepts failure result with error', () => {
    const result = ProvisioningResultSchema.safeParse({
      success: false,
      containerName: 'fomo-client-001',
      error: 'Image not found',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing containerName', () => {
    const result = ProvisioningResultSchema.safeParse({
      success: true,
      containerId: 'abc123',
    });
    expect(result.success).toBe(false);
  });
});

// ─── ClientContainerStatus Schema ───────────────────────────────

describe('ClientContainerStatusSchema', () => {
  it('accepts running status with uptime', () => {
    const result = ClientContainerStatusSchema.safeParse({
      clientId: 'client-001',
      containerId: 'abc123',
      status: 'running',
      uptime: 3600,
    });
    expect(result.success).toBe(true);
  });

  it('accepts stopped status without uptime', () => {
    const result = ClientContainerStatusSchema.safeParse({
      clientId: 'client-001',
      containerId: 'abc123',
      status: 'stopped',
    });
    expect(result.success).toBe(true);
  });

  it('accepts error status', () => {
    const result = ClientContainerStatusSchema.safeParse({
      clientId: 'client-001',
      containerId: 'abc123',
      status: 'error',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = ClientContainerStatusSchema.safeParse({
      clientId: 'client-001',
      containerId: 'abc123',
      status: 'restarting',
    });
    expect(result.success).toBe(false);
  });
});

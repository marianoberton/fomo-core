import { describe, it, expect, vi } from 'vitest';
import type { ProjectId, PromptLayerId } from '@/core/types.js';
import type { PromptLayer } from './types.js';
import { resolveActiveLayers, createPromptSnapshot, computeHash } from './layer-manager.js';
import type { LayerManagerRepository } from './layer-manager.js';

// ─── Helpers ─────────────────────────────────────────────────────

function makeMockLayer(layerType: 'identity' | 'instructions' | 'safety'): PromptLayer {
  return {
    id: `pl-${layerType}-1` as PromptLayerId,
    projectId: 'proj-1' as ProjectId,
    layerType,
    version: 1,
    content: `Content for ${layerType}`,
    isActive: true,
    createdAt: new Date('2025-01-01'),
    createdBy: 'test',
    changeReason: 'test',
  };
}

function createMockRepo(
  overrides?: Partial<Record<'identity' | 'instructions' | 'safety', PromptLayer | null>>,
): LayerManagerRepository {
  return {
    getActiveLayer: vi.fn().mockImplementation(
      (_projectId: ProjectId, layerType: string) => {
        void _projectId;
        const layers = {
          identity: overrides?.identity !== undefined ? overrides.identity : makeMockLayer('identity'),
          instructions: overrides?.instructions !== undefined ? overrides.instructions : makeMockLayer('instructions'),
          safety: overrides?.safety !== undefined ? overrides.safety : makeMockLayer('safety'),
        };
        return Promise.resolve(layers[layerType as keyof typeof layers] ?? null);
      },
    ),
  };
}

// ─── resolveActiveLayers ────────────────────────────────────────

describe('resolveActiveLayers', () => {
  it('returns all 3 layers when they exist', async () => {
    const repo = createMockRepo();
    const result = await resolveActiveLayers('proj-1' as ProjectId, repo);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.identity.layerType).toBe('identity');
      expect(result.value.instructions.layerType).toBe('instructions');
      expect(result.value.safety.layerType).toBe('safety');
    }
  });

  it('returns error when identity layer is missing', async () => {
    const repo = createMockRepo({ identity: null });
    const result = await resolveActiveLayers('proj-1' as ProjectId, repo);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_PROMPT_LAYERS');
      expect(result.error.message).toContain('identity');
    }
  });

  it('returns error when instructions layer is missing', async () => {
    const repo = createMockRepo({ instructions: null });
    const result = await resolveActiveLayers('proj-1' as ProjectId, repo);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('instructions');
    }
  });

  it('returns error when safety layer is missing', async () => {
    const repo = createMockRepo({ safety: null });
    const result = await resolveActiveLayers('proj-1' as ProjectId, repo);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('safety');
    }
  });

  it('returns error listing ALL missing layers', async () => {
    const repo = createMockRepo({ identity: null, safety: null });
    const result = await resolveActiveLayers('proj-1' as ProjectId, repo);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('identity');
      expect(result.error.message).toContain('safety');
    }
  });

  it('calls getActiveLayer for each layer type', async () => {
    const repo = createMockRepo();
    await resolveActiveLayers('proj-1' as ProjectId, repo);

    expect(repo.getActiveLayer).toHaveBeenCalledTimes(3);
    expect(repo.getActiveLayer).toHaveBeenCalledWith('proj-1', 'identity');
    expect(repo.getActiveLayer).toHaveBeenCalledWith('proj-1', 'instructions');
    expect(repo.getActiveLayer).toHaveBeenCalledWith('proj-1', 'safety');
  });
});

// ─── createPromptSnapshot ──────────────────────────────────────

describe('createPromptSnapshot', () => {
  it('creates a snapshot from resolved layers and hashes', () => {
    const layers = {
      identity: makeMockLayer('identity'),
      instructions: makeMockLayer('instructions'),
      safety: makeMockLayer('safety'),
    };

    const snapshot = createPromptSnapshot(layers, 'tool-hash', 'context-hash');

    expect(snapshot.identityLayerId).toBe('pl-identity-1');
    expect(snapshot.identityVersion).toBe(1);
    expect(snapshot.instructionsLayerId).toBe('pl-instructions-1');
    expect(snapshot.instructionsVersion).toBe(1);
    expect(snapshot.safetyLayerId).toBe('pl-safety-1');
    expect(snapshot.safetyVersion).toBe(1);
    expect(snapshot.toolDocsHash).toBe('tool-hash');
    expect(snapshot.runtimeContextHash).toBe('context-hash');
  });
});

// ─── computeHash ───────────────────────────────────────────────

describe('computeHash', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = computeHash('hello');
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it('is deterministic', () => {
    const hash1 = computeHash('same content');
    const hash2 = computeHash('same content');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inputs', () => {
    const hash1 = computeHash('content A');
    const hash2 = computeHash('content B');
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty string', () => {
    const hash = computeHash('');
    expect(hash).toHaveLength(64);
  });
});

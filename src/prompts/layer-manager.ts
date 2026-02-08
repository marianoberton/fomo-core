/**
 * Layer Manager — resolves active prompt layers and creates snapshots.
 *
 * This module provides the bridge between the PromptLayer repository
 * (database) and the PromptBuilder (runtime assembly). It:
 *  - Fetches the active layer for each of the 3 DB-persisted types.
 *  - Creates deterministic PromptSnapshot records for audit.
 *  - Computes SHA-256 content hashes for the 2 runtime layers.
 */
import { createHash } from 'node:crypto';
import type { ProjectId, PromptSnapshot, PromptLayerId } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { NexusError } from '@/core/errors.js';
import type { PromptLayerType, ResolvedPromptLayers } from './types.js';

// ─── Repository Interface ──────────────────────────────────────

/** Minimal repository interface consumed by the layer manager. */
export interface LayerManagerRepository {
  getActiveLayer(projectId: ProjectId, layerType: PromptLayerType): Promise<{
    id: PromptLayerId;
    version: number;
    content: string;
    layerType: PromptLayerType;
    projectId: ProjectId;
    isActive: boolean;
    createdAt: Date;
    createdBy: string;
    changeReason: string;
    performanceNotes?: string;
    metadata?: Record<string, unknown>;
  } | null>;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Resolve the 3 active DB-persisted layers for a project.
 *
 * Returns an error if any of the 3 required layer types is missing.
 */
export async function resolveActiveLayers(
  projectId: ProjectId,
  repo: LayerManagerRepository,
): Promise<Result<ResolvedPromptLayers, NexusError>> {
  const [identity, instructions, safety] = await Promise.all([
    repo.getActiveLayer(projectId, 'identity'),
    repo.getActiveLayer(projectId, 'instructions'),
    repo.getActiveLayer(projectId, 'safety'),
  ]);

  const missing: PromptLayerType[] = [];
  if (!identity) missing.push('identity');
  if (!instructions) missing.push('instructions');
  if (!safety) missing.push('safety');

  if (missing.length > 0) {
    return err(
      new NexusError({
        message: `Missing active prompt layers for project "${projectId}": ${missing.join(', ')}`,
        code: 'MISSING_PROMPT_LAYERS',
        statusCode: 400,
        context: { projectId, missingLayers: missing },
      }),
    );
  }

  return ok({
    identity: identity!,
    instructions: instructions!,
    safety: safety!,
  });
}

/**
 * Create a PromptSnapshot from resolved layers and runtime content hashes.
 *
 * The snapshot records exactly which layer versions + runtime content
 * were used for a given execution, enabling audit and A/B correlation.
 */
export function createPromptSnapshot(
  layers: ResolvedPromptLayers,
  toolDocsHash: string,
  runtimeContextHash: string,
): PromptSnapshot {
  return {
    identityLayerId: layers.identity.id,
    identityVersion: layers.identity.version,
    instructionsLayerId: layers.instructions.id,
    instructionsVersion: layers.instructions.version,
    safetyLayerId: layers.safety.id,
    safetyVersion: layers.safety.version,
    toolDocsHash,
    runtimeContextHash,
  };
}

/**
 * Compute a deterministic SHA-256 hex hash of the given content.
 *
 * Used to fingerprint the 2 runtime-generated prompt layers
 * (tool descriptions and runtime context) for snapshot tracking.
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

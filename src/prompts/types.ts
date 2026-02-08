import type { ProjectId, PromptLayerId } from '@/core/types.js';

// Re-export PromptSnapshot from core (lives there to avoid circular deps)
export type { PromptSnapshot } from '@/core/types.js';

// ─── Prompt Layer Types ────────────────────────────────────────

/** The three DB-persisted prompt layer types. */
export type PromptLayerType = 'identity' | 'instructions' | 'safety';

/**
 * A single versioned prompt layer.
 *
 * Each layer is independently versioned per project. A "prompt configuration"
 * is the combination of the active versions of all three layers.
 */
export interface PromptLayer {
  id: PromptLayerId;
  projectId: ProjectId;
  /** Which layer this belongs to. */
  layerType: PromptLayerType;
  /** Auto-incremented version number per (project, layerType). */
  version: number;
  /** The actual prompt content for this layer. */
  content: string;

  /** Only one layer can be active per (project, layerType). */
  isActive: boolean;
  createdAt: Date;
  createdBy: string;
  changeReason: string;
  performanceNotes?: string;
  /** Arbitrary metadata for performance correlation. */
  metadata?: Record<string, unknown>;
}

// ─── Prompt Build Params ───────────────────────────────────────

/**
 * Everything needed to assemble the final system prompt.
 * The 3 DB-persisted layers + 2 runtime-generated layers.
 */
export interface PromptBuildParams {
  /** Layer 1: Agent identity — tone, language, personality. */
  identity: PromptLayer;
  /** Layer 2: Business rules, workflows, restrictions. */
  instructions: PromptLayer;
  /** Layer 5: Safety boundaries. */
  safety: PromptLayer;
  /** Layer 3 (runtime): Tool descriptions + per-tool usage instructions. */
  toolDescriptions: { name: string; description: string }[];
  /** Per-tool usage instructions, keyed by tool name. */
  toolInstructions?: Record<string, string>;
  /** Layer 4 (runtime): Retrieved memories from long-term store. */
  retrievedMemories: { content: string; category: string }[];
  /** Optional project-level context variables for template interpolation. */
  projectContext?: Record<string, string>;
}

// ─── Resolved Layers ───────────────────────────────────────────

/** Convenience container for the 3 active DB layers. */
export interface ResolvedPromptLayers {
  identity: PromptLayer;
  instructions: PromptLayer;
  safety: PromptLayer;
}

// Prompt Layer system — 5-layer architecture
export type {
  PromptLayerType,
  PromptLayer,
  PromptBuildParams,
  PromptSnapshot,
  ResolvedPromptLayers,
} from './types.js';

export { buildPrompt, createDefaultLayers } from './prompt-builder.js';

export {
  resolveActiveLayers,
  createPromptSnapshot,
  computeHash,
} from './layer-manager.js';
export type { LayerManagerRepository } from './layer-manager.js';

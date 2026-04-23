/**
 * Legacy "role" shim for fomo-platform contract.
 *
 * fomo-platform expects the old 5-value `operatingMode` string in the
 * `role` field of agent payloads. After Track A migration A1, that field
 * is gone — agents now carry `type` (3 values) plus `metadata.archetype`.
 *
 * This shim collapses (type, archetype) back to a legacy role string so
 * fomo-platform keeps working without coordinated changes. Deprecate when
 * fomo-platform migrates to consume `type` + `archetype` directly.
 */
import type { AgentType } from '@/agents/types.js';

/** Legacy role values previously stored in `agents.operating_mode`. */
export type LegacyAgentRole =
  | 'customer-facing'
  | 'internal'
  | 'copilot'
  | 'manager'
  | 'admin';

/**
 * Map a new AgentType + metadata.archetype back to the legacy role string.
 *
 * Mapping (per Track A handoff with Track B/fomo-platform):
 * - conversational                                   → 'customer-facing'
 * - backoffice + metadata.archetype === 'manager'    → 'manager'
 * - backoffice + metadata.archetype === 'copilot'    → 'copilot'
 * - backoffice + metadata.archetype === 'admin'      → 'admin'
 * - backoffice (other)                               → 'internal'
 * - process                                          → 'internal'
 *
 * @param type - The agent's new type discriminator.
 * @param metadata - The agent's metadata blob (may be undefined or null).
 * @returns The legacy role string for backwards-compatible serialization.
 */
export function legacyRoleOf(
  type: AgentType,
  metadata: unknown,
): LegacyAgentRole {
  if (type === 'conversational') return 'customer-facing';
  if (type === 'process') return 'internal';

  // type === 'backoffice' — disambiguate via archetype
  const archetype = readArchetype(metadata);
  if (archetype === 'manager') return 'manager';
  if (archetype === 'copilot') return 'copilot';
  if (archetype === 'admin') return 'admin';
  return 'internal';
}

/** Safely read `metadata.archetype` from an unknown value. */
function readArchetype(metadata: unknown): string | undefined {
  if (metadata === null || typeof metadata !== 'object') return undefined;
  const value = (metadata as Record<string, unknown>)['archetype'];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Vertical Registry
 *
 * Carga y gestiona todos los verticales: configs JSON + adapters TypeScript.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { VerticalConfig } from './vertical-config.schema.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'vertical-registry' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIGS_DIR = join(__dirname, 'configs');

// ─── JSON Config Loader ──────────────────────────────────────────

function loadJsonVerticals(): VerticalConfig[] {
  const configs: VerticalConfig[] = [];

  let files: string[];
  try {
    files = readdirSync(CONFIGS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    // configs dir might not exist in some environments
    return configs;
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(CONFIGS_DIR, file), 'utf-8');
      const config = JSON.parse(raw) as VerticalConfig;
      configs.push(config);
    } catch (err) {
      logger.warn('Failed to load vertical config', { component: 'vertical-registry', file, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return configs;
}

// ─── Registry State ──────────────────────────────────────────────

let _registry: Map<string, VerticalConfig> | null = null;

function getRegistry(): Map<string, VerticalConfig> {
  if (_registry) return _registry;

  _registry = new Map<string, VerticalConfig>();

  // Load JSON-defined verticals
  const jsonVerticals = loadJsonVerticals();
  for (const v of jsonVerticals) {
    _registry.set(v.id, v);
  }

  // TypeScript-defined verticals are registered via registerVertical()
  // called from src/verticals/index.ts

  return _registry;
}

/**
 * Register a vertical programmatically (used by TypeScript adapters).
 */
export function registerVertical(config: VerticalConfig): void {
  const registry = getRegistry();
  registry.set(config.id, config);
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Returns all registered verticals (JSON configs + TypeScript adapters).
 */
export function getAllVerticals(): VerticalConfig[] {
  return Array.from(getRegistry().values());
}

/**
 * Returns a specific vertical by id, or undefined if not found.
 */
export function getVertical(id: string): VerticalConfig | undefined {
  return getRegistry().get(id);
}

/**
 * Returns all verticals matching a given industry tag.
 */
export function getVerticalsByIndustry(industry: string): VerticalConfig[] {
  return getAllVerticals().filter((v) => v.industry === industry);
}

// ─── Prompt Rendering ────────────────────────────────────────────

/**
 * Interpolates {placeholders} in a template string using the params map.
 * Unresolved placeholders are left as-is (not replaced with empty string).
 */
function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const val = params[key];
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') return val;
      if (typeof val === 'number' || typeof val === 'boolean') return String(val);
      return JSON.stringify(val);
    }
    return match; // leave unresolved placeholders intact
  });
}

/**
 * Generates the system prompt fragments for a vertical, interpolating
 * client-specific parameters into the template strings.
 */
export function renderVerticalPrompt(
  config: VerticalConfig,
  params: Record<string, unknown>,
): { identity: string; instructions: string } {
  return {
    identity: interpolate(config.identityFragment, params),
    instructions: interpolate(config.instructionsFragment, params),
  };
}

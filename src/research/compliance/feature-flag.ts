/**
 * Feature flag for the Research module.
 *
 * The entire module sits behind `RESEARCH_MODULE_ENABLED` so prod can
 * keep it dark until legal sign-off (see NEXUS_INTELLIGENCE_PLAN.md
 * §Compliance — Criterios de salida del módulo a prod).
 *
 * Pattern: read once at module load, but expose as a function so tests
 * can override via `process.env` reset between cases.
 */

/**
 * True when `RESEARCH_MODULE_ENABLED=true` (case-sensitive). Anything
 * else — unset, "false", "1", "yes" — returns false. Strict by design:
 * we want a single, unambiguous truthy value.
 */
export function isResearchModuleEnabled(): boolean {
  return process.env['RESEARCH_MODULE_ENABLED'] === 'true';
}

/**
 * List of email addresses authorized as super_admin for the research
 * module. Read from `SUPER_ADMIN_EMAILS` env var as a comma-separated
 * list, lowercased. Empty list means no one can access (combined with
 * master API key bypass — see super-admin-guard).
 */
export function getSuperAdminEmails(): readonly string[] {
  const raw = process.env['SUPER_ADMIN_EMAILS'] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

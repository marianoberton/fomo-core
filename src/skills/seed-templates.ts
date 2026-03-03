/**
 * Seed Official Skill Templates
 *
 * Esta función se llama desde el seed de la DB para insertar todos los
 * templates oficiales de FOMO como instancias reutilizables.
 */

import { getOfficialTemplates } from './official-templates.js';
import type { SkillRepository } from './types.js';

/**
 * Inserta todos los templates oficiales en el repositorio como instancias
 * de un proyecto de sistema (projectId: 'system').
 *
 * Diseñado para ser idempotente: si un template ya existe (mismo nombre),
 * se omite sin lanzar error.
 */
export async function seedOfficialTemplates(
  repository: SkillRepository,
  projectId: string = 'system',
): Promise<void> {
  const templates = getOfficialTemplates();

  // Obtener instancias existentes para evitar duplicados
  const existing = await repository.listInstances(projectId);
  const existingNames = new Set(existing.map((i) => i.name));

  const results = await Promise.allSettled(
    templates
      .filter((t) => !existingNames.has(t.name))
      .map((template) =>
        repository.createInstance({
          projectId,
          templateId: template.id,
          name: template.name,
          displayName: template.displayName,
          description: template.description,
          instructionsFragment: template.instructionsFragment,
          requiredTools: template.requiredTools,
          requiredMcpServers: template.requiredMcpServers,
          parameters: template.parametersSchema
            ? extractDefaultParameters(template.parametersSchema)
            : undefined,
        }),
      ),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected');

  if (failed.length > 0) {
    const errors = failed
      .map((r) => (r.status === 'rejected' ? r.reason : null))
      .filter(Boolean)
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join(', ');
    console.warn(`[seedOfficialTemplates] ${failed.length} template(s) fallaron: ${errors}`);
  }

  console.log(
    `[seedOfficialTemplates] ${succeeded} templates insertados, ${existingNames.size} ya existían.`,
  );
}

/**
 * Extrae los valores default del JSON Schema de parámetros.
 * Retorna un objeto con los valores por defecto de cada propiedad.
 */
function extractDefaultParameters(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const properties = schema['properties'];
  if (typeof properties !== 'object' || properties === null) return defaults;

  for (const [key, def] of Object.entries(properties as Record<string, unknown>)) {
    if (typeof def === 'object' && def !== null && 'default' in def) {
      defaults[key] = (def as Record<string, unknown>)['default'];
    }
  }

  return defaults;
}

/**
 * Schema de configuración para verticales de industria.
 * Permite definir nuevos verticales sin tocar TypeScript.
 */

export interface VerticalConfig {
  id: string; // 'restaurante', 'clinica', etc.
  name: string; // 'Restaurante / Bar'
  description: string;
  industry: string; // sector

  // Prompt fragments auto-incluidos en agentes de este vertical
  identityFragment: string; // "Sos el asistente de {businessName}..."
  instructionsFragment: string; // reglas específicas del vertical

  // Tools genéricos habilitados para este vertical
  tools: VerticalToolConfig[];

  // Parámetros configurables por cliente
  parametersSchema: Record<string, ParameterDef>;

  // Tags de skill templates que aplican a este vertical
  recommendedSkillTags: string[];
}

export interface VerticalToolConfig {
  // Usa un tool genérico existente con config específica
  toolId: string; // 'catalog-search', 'knowledge-search', etc.
  displayName?: string; // override del nombre en UI
  description?: string; // override de la descripción
  defaultEnabled: boolean;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ParameterDef {
  type: 'string' | 'number' | 'boolean' | 'enum';
  label: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  options?: string[]; // para type: 'enum'
}

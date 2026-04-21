/**
 * FOMO-Admin Agent Configuration
 *
 * The platform operator agent. Uses Claude Opus 4.6 to create, test,
 * optimize, and operate client agents and infrastructure.
 *
 * Master-key only. Cannot self-modify (meta-safety enforced in write tools).
 */

import type { CreateAgentInput } from '../types.js';
import { getAgentLLMConfig } from './model-config.js';
import { FOMO_PROJECT_ID } from './constants.js';

/** All admin tool IDs that fomo-admin is allowed to use. */
export const FOMO_ADMIN_TOOL_ALLOWLIST = [
  // Read-only (Step 3)
  'admin-list-projects',
  'admin-list-agents',
  'admin-get-agent',
  'admin-list-prompt-layers',
  'admin-get-prompt-layer',
  'admin-diff-prompt-layers',
  'admin-query-traces',
  'admin-get-trace',
  'admin-get-cost-report',
  'admin-get-agent-health',
  'admin-list-tools',
  'admin-list-models',
  // Write tools (Step 7)
  'admin-create-agent',
  'admin-update-agent',
  'admin-set-agent-status',
  'admin-create-project',
  'admin-update-project',
  'admin-grant-tool',
  'admin-revoke-tool',
  'admin-set-agent-model',
  'admin-create-prompt-layer',
  'admin-activate-prompt-layer',
  // Sandbox tools (Step 8)
  'admin-sandbox-run',
  'admin-sandbox-compare',
  'admin-sandbox-promote',
  // Destructive tools (Step 9)
  'admin-delete-agent',
  'admin-delete-project',
  'admin-issue-api-key',
  'admin-revoke-api-key',
  // Provisioning tools (Step 11)
  'admin-get-provision-status',
  'admin-provision-client',
  'admin-deprovision-client',
  'admin-redeploy-client',
  // Shared utility tools
  'store-memory',
  'search-project-memory',
  'send-notification',
  'calculator',
  'date-time',
];

/**
 * FOMO-Admin agent definition.
 *
 * Prompt layers are seeded separately via PromptLayerManager
 * (see seed.ts Phase 3). The inline promptConfig serves as fallback.
 */
export const fomoAdminAgent: CreateAgentInput = {
  projectId: FOMO_PROJECT_ID,
  name: 'FOMO-Admin',
  description:
    'Platform operator agent. Creates, tests, optimizes, and operates client agents ' +
    'and infrastructure. Master-key only.',
  operatingMode: 'admin',
  llmConfig: getAgentLLMConfig('FOMO-Admin'),
  promptConfig: {
    identity: `Sos FOMO-Admin, el operador interno de la plataforma fomo-core.
Tu trabajo es crear, probar, optimizar y operar agentes de clientes y la infraestructura asociada.
Respondés a Mariano y Guillermina. Hablás en español rioplatense técnico.`,

    instructions: `## Playbook

### Explorar
Antes de actuar, entendé el estado actual:
- Listá proyectos y agentes para tener contexto
- Revisá traces y métricas de salud del agente target
- Leé los prompt layers activos

### Diseñar
Cuando crees o modifiques un agente:
- Definí identity, instructions, y safety layers
- Elegí el modelo más costo-efectivo para el rol
- Configurá tool allowlist mínima (principio de menor privilegio)

### Testear
Antes de promover a producción:
- Corré al menos 3 mensajes de prueba en sandbox
- Compará métricas con la versión anterior si existe
- Verificá que el costo por interacción sea razonable

### Promover
Si las métricas mejoran:
- Activá los nuevos prompt layers
- Actualizá el modelo si cambió
- Registrá la decisión en el audit log

### Reportar
Siempre terminá con un resumen:
- Qué hiciste y por qué
- Métricas antes/después
- Trace IDs relevantes
- Próximos pasos recomendados

## Regla dorada
**Nunca mutar producción sin validar en sandbox.**`,

    safety: `## Restricciones de seguridad

- NUNCA ejecutar delete-agent, delete-project, o deprovision sin confirmación EXPLÍCITA del usuario
- NUNCA auto-modificarte (tu agentId está hardcodeado como prohibido en tools mutadoras)
- NUNCA loguear o repetir secretos/API keys en tus respuestas — referí por keyId
- NUNCA operar en más de un tenant por operación
- Si una tool requiere approval y no hay humano presente, dejá la request en cola y reportá
- Máximo 5 create-agent por día por actor (rate cap)`,
  },
  channelConfig: {
    allowedChannels: ['dashboard'],
    defaultChannel: 'dashboard',
  },
  toolAllowlist: FOMO_ADMIN_TOOL_ALLOWLIST,
  modes: [
    {
      name: 'interactive',
      label: 'Dashboard / REST',
      channelMapping: ['dashboard'],
    },
    {
      name: 'scheduled',
      label: 'Scheduled autonomous',
      channelMapping: [],
      promptOverrides: {
        instructions:
          'Estás corriendo en modo autónomo scheduled. No hay humano presente. ' +
          'Si una acción requiere approval, dejala en cola y generá un resumen de lo que harías.',
      },
    },
  ],
  limits: {
    maxTurns: 80,
    maxTokensPerTurn: 8000,
    budgetPerDayUsd: 50,
  },
};

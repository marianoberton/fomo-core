/**
 * FOMO Internal Agents — Seed Script
 *
 * Crea el proyecto FOMO interno y los 4 agentes en la DB.
 * Correr UNA SOLA VEZ en producción.
 *
 * Uso:
 *   npx tsx src/agents/fomo-internal/seed.ts
 *
 * Variables de entorno requeridas:
 *   DATABASE_URL, FOMO_INTERNAL_PROJECT_ID (opcional, default: fomo-internal)
 */

import { createLogger } from '@/observability/logger.js';
import { FOMO_INTERNAL_AGENTS, FOMO_PROJECT_ID, fomoAdminAgent } from './agents.config.js';

const logger = createLogger({ name: 'fomo-internal-seed' });

async function main(): Promise<void> {
  const API_BASE = process.env['FOMO_API_URL'] ?? 'http://localhost:3002';
  const API_KEY  = process.env['FOMO_API_KEY'] ?? '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };

  logger.info('FOMO Internal Agents Seed', { component: 'fomo-internal-seed', apiBase: API_BASE, projectId: FOMO_PROJECT_ID });

  // 1. Crear proyecto (si no existe)
  logger.info('Creating project fomo-internal', { component: 'fomo-internal-seed' });
  const projectRes = await fetch(`${API_BASE}/api/v1/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: FOMO_PROJECT_ID,
      name: 'FOMO Internal',
      description: 'Agentes internos de operación de FOMO',
    }),
  });

  if (projectRes.ok) {
    logger.info('Project created', { component: 'fomo-internal-seed' });
  } else if (projectRes.status === 409) {
    logger.info('Project already exists, continuing', { component: 'fomo-internal-seed' });
  } else {
    const err = await projectRes.text();
    logger.error('Error creating project', { component: 'fomo-internal-seed', error: err });
    process.exit(1);
  }

  // 2. Crear agentes (4 FAMA + 1 FOMO-Admin)
  const allAgents = [...FOMO_INTERNAL_AGENTS, fomoAdminAgent];
  logger.info('Creating agents', { component: 'fomo-internal-seed' });
  for (const agent of allAgents) {
    logger.info('Creating agent', { component: 'fomo-internal-seed', agentName: agent.name });
    const res = await fetch(`${API_BASE}/api/v1/projects/${FOMO_PROJECT_ID}/agents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(agent),
    });

    if (res.ok) {
      const data = await res.json() as { id: string };
      logger.info('Agent created', { component: 'fomo-internal-seed', agentName: agent.name, agentId: data.id });
    } else if (res.status === 409) {
      logger.warn('Agent already exists', { component: 'fomo-internal-seed', agentName: agent.name });
    } else {
      const err = await res.text();
      logger.error('Failed to create agent', { component: 'fomo-internal-seed', agentName: agent.name, error: err });
    }
  }

  // 3. Crear scheduled tasks para FOMO-Admin
  const scheduledTasks = [
    {
      name: 'weekly-fleet-health-review',
      description: 'Review all active agents, summarize health, notify anomalies',
      cronExpression: '0 8 * * 1', // Mon 08:00
      prompt: 'Revisá todos los agentes activos en la plataforma. Para cada uno: listá métricas de salud (error rate, costo, latencia) de los últimos 7 días. Si hay anomalías, reportalas con trace IDs.',
    },
    {
      name: 'daily-cost-anomaly-check',
      description: 'Check for cost anomalies across all projects',
      cronExpression: '0 7 * * *', // Daily 07:00
      prompt: 'Generá un reporte de costos de las últimas 24hs. Comparalo con el promedio de los últimos 7 días. Si algún proyecto superó 2x el baseline, notificá con detalle del desvío.',
    },
    {
      name: 'nightly-orphan-trace-sweep',
      description: 'Identify stuck/orphan traces and report',
      cronExpression: '0 3 * * *', // Daily 03:00
      prompt: 'Buscá traces con status "running" que tengan más de 1 hora de antigüedad. Reportá los IDs y el agente/proyecto asociado. Estos son traces huérfanos que probablemente necesitan cleanup.',
    },
  ];

  logger.info('Creating scheduled tasks for FOMO-Admin', { component: 'fomo-internal-seed' });
  for (const task of scheduledTasks) {
    const res = await fetch(`${API_BASE}/api/v1/projects/${FOMO_PROJECT_ID}/scheduled-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: task.name,
        description: task.description,
        cronExpression: task.cronExpression,
        taskPayload: {
          type: 'agent-prompt',
          agentName: 'FOMO-Admin',
          prompt: task.prompt,
        },
        origin: 'system',
        status: 'active',
      }),
    });

    if (res.ok) {
      logger.info('Scheduled task created', { component: 'fomo-internal-seed', taskName: task.name });
    } else if (res.status === 409) {
      logger.warn('Scheduled task already exists', { component: 'fomo-internal-seed', taskName: task.name });
    } else {
      const errText = await res.text();
      logger.error('Failed to create scheduled task', { component: 'fomo-internal-seed', taskName: task.name, error: errText });
    }
  }

  logger.info('Seed complete. FOMO agents + scheduled tasks ready.', { component: 'fomo-internal-seed' });
}

main().catch((e: unknown) => {
  logger.error('Seed failed', { component: 'fomo-internal-seed', error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});

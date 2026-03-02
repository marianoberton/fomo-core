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

import { FOMO_INTERNAL_AGENTS, FOMO_PROJECT_ID } from './agents.config.js';

async function main() {
  const API_BASE = process.env.FOMO_API_URL ?? 'http://localhost:3002';
  const API_KEY  = process.env.FOMO_API_KEY ?? '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };

  console.log(`\n🚀 FOMO Internal Agents Seed`);
  console.log(`   API: ${API_BASE}`);
  console.log(`   Project: ${FOMO_PROJECT_ID}\n`);

  // 1. Crear proyecto (si no existe)
  console.log('1️⃣  Creando proyecto fomo-internal...');
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
    console.log('   ✅ Proyecto creado');
  } else if (projectRes.status === 409) {
    console.log('   ℹ️  Proyecto ya existe, continuando...');
  } else {
    const err = await projectRes.text();
    console.error(`   ❌ Error creando proyecto: ${err}`);
    process.exit(1);
  }

  // 2. Crear agentes
  console.log('\n2️⃣  Creando agentes...\n');
  for (const agent of FOMO_INTERNAL_AGENTS) {
    process.stdout.write(`   → ${agent.name}... `);
    const res = await fetch(`${API_BASE}/api/v1/projects/${FOMO_PROJECT_ID}/agents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(agent),
    });

    if (res.ok) {
      const data = await res.json() as { id: string };
      console.log(`✅  (id: ${data.id})`);
    } else if (res.status === 409) {
      console.log(`⚠️  ya existe`);
    } else {
      const err = await res.text();
      console.log(`❌  ${err}`);
    }
  }

  console.log('\n✅ Seed completo. Agentes FOMO listos.\n');
  console.log('Próximos pasos:');
  console.log('  1. Conectar canal WhatsApp para FAMA-Sales y FAMA-CS');
  console.log('  2. Configurar Telegram para FAMA-Manager (modo mobile)');
  console.log('  3. Activar schedules de FAMA-Ops (follow-ups, reportes)');
  console.log('  4. Agregar knowledge base de FOMO a FAMA-CS\n');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});

/**
 * seed-templates.ts — Production-safe template seeder
 *
 * Seeds ONLY global catalog templates (MCP Server Templates + Skill Templates).
 * Safe to run on production: uses upsert on both tables, never touches
 * projects, agents, sessions, or any per-project data.
 *
 * Usage:
 *   pnpm db:seed-templates
 */
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding catalog templates (production-safe)...\n');

  // ═══════════════════════════════════════════════════════════════
  // MCP SERVER TEMPLATES
  // ═══════════════════════════════════════════════════════════════

  const mcpTemplates = [
    {
      name: 'odoo-erp',
      displayName: 'Odoo ERP',
      description: 'Odoo ERP — customers, products, invoices, inventory management',
      category: 'erp',
      transport: 'sse',
      url: 'http://localhost:8069/mcp',
      toolPrefix: 'odoo',
      requiredSecrets: ['ODOO_URL', 'ODOO_API_KEY', 'ODOO_DB'],
      isOfficial: true,
    },
    {
      name: 'salesforce-crm',
      displayName: 'Salesforce CRM',
      description: 'Salesforce — contacts, opportunities, cases, accounts',
      category: 'crm',
      transport: 'sse',
      url: 'https://your-instance.salesforce.com/mcp',
      toolPrefix: 'sf',
      requiredSecrets: ['SF_INSTANCE_URL', 'SF_CLIENT_ID', 'SF_CLIENT_SECRET'],
      isOfficial: true,
    },
    {
      name: 'hubspot-crm',
      displayName: 'HubSpot CRM',
      description: 'HubSpot — contacts, deals, companies, notes, tasks via API v3',
      category: 'crm',
      transport: 'stdio',
      command: 'node',
      args: ['dist/mcp/servers/hubspot-crm/index.js'],
      toolPrefix: 'hs',
      requiredSecrets: ['HUBSPOT_ACCESS_TOKEN'],
      isOfficial: true,
    },
    {
      name: 'sap-business-one',
      displayName: 'SAP Business One',
      description: 'SAP B1 — orders, inventory, financials, business partners',
      category: 'erp',
      transport: 'sse',
      url: 'https://your-sap-server/mcp',
      toolPrefix: 'sap',
      requiredSecrets: ['SAP_URL', 'SAP_COMPANY_DB', 'SAP_USERNAME', 'SAP_PASSWORD'],
      isOfficial: true,
    },
    {
      name: 'google-workspace',
      displayName: 'Google Workspace',
      description: 'Google — Calendar, Drive, Gmail, Sheets integration',
      category: 'productivity',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@anthropic/google-workspace-mcp'],
      toolPrefix: 'gw',
      requiredSecrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
      isOfficial: true,
    },
    {
      name: 'microsoft-365',
      displayName: 'Microsoft 365',
      description: 'Microsoft — Teams, Outlook, SharePoint, OneDrive',
      category: 'productivity',
      transport: 'sse',
      url: 'https://graph.microsoft.com/mcp',
      toolPrefix: 'ms',
      requiredSecrets: ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET'],
      isOfficial: true,
    },
    {
      name: 'notion',
      displayName: 'Notion',
      description: 'Notion — pages, databases, search, content management',
      category: 'productivity',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@anthropic/notion-mcp'],
      toolPrefix: 'notion',
      requiredSecrets: ['NOTION_API_KEY'],
      isOfficial: true,
    },
    {
      name: 'generic-rest-api',
      displayName: 'Generic REST API',
      description: 'Generic REST API connector — configure any HTTP-based service',
      category: 'custom',
      transport: 'sse',
      toolPrefix: 'api',
      requiredSecrets: ['API_BASE_URL', 'API_KEY'],
      isOfficial: false,
    },
    {
      name: 'github',
      displayName: 'GitHub',
      description: 'GitHub — repos, issues, pull requests, code search',
      category: 'productivity',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      toolPrefix: 'gh',
      requiredSecrets: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
      isOfficial: true,
    },
    {
      name: 'slack-mcp',
      displayName: 'Slack (MCP)',
      description: 'Slack — channels, messages, users, search via MCP protocol',
      category: 'communication',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      toolPrefix: 'slack',
      requiredSecrets: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
      isOfficial: true,
    },
    {
      name: 'postgres',
      displayName: 'PostgreSQL',
      description: 'PostgreSQL — query databases, inspect schemas, read data',
      category: 'custom',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      toolPrefix: 'pg',
      requiredSecrets: ['POSTGRES_CONNECTION_STRING'],
      isOfficial: true,
    },
    {
      name: 'twenty-crm',
      displayName: 'Twenty CRM',
      description: 'Twenty CRM — open-source CRM contacts, companies, opportunities',
      category: 'crm',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'twenty-mcp-server'],
      toolPrefix: 'twenty',
      requiredSecrets: ['TWENTY_API_URL', 'TWENTY_API_KEY'],
      isOfficial: true,
    },
  ];

  let mcpCount = 0;
  for (const tmpl of mcpTemplates) {
    await prisma.mCPServerTemplate.upsert({
      where: { name: tmpl.name },
      update: {
        displayName: tmpl.displayName,
        description: tmpl.description,
        category: tmpl.category,
        transport: tmpl.transport,
        command: tmpl.command ?? null,
        args: tmpl.args ?? [],
        defaultEnv: {},
        url: tmpl.url ?? null,
        toolPrefix: tmpl.toolPrefix ?? null,
        requiredSecrets: tmpl.requiredSecrets,
        isOfficial: tmpl.isOfficial,
      },
      create: {
        name: tmpl.name,
        displayName: tmpl.displayName,
        description: tmpl.description,
        category: tmpl.category,
        transport: tmpl.transport,
        command: tmpl.command ?? null,
        args: tmpl.args ?? [],
        defaultEnv: {},
        url: tmpl.url ?? null,
        toolPrefix: tmpl.toolPrefix ?? null,
        requiredSecrets: tmpl.requiredSecrets,
        isOfficial: tmpl.isOfficial,
      },
    });
    mcpCount++;
  }
  console.log(`✓ MCP Server Templates: ${mcpCount} upserted`);

  // ═══════════════════════════════════════════════════════════════
  // SKILL TEMPLATES
  // ═══════════════════════════════════════════════════════════════

  const skillTemplates = [
    {
      name: 'lead-scoring',
      displayName: 'Lead Scoring',
      description: 'Evaluate buying intent and qualify leads based on conversation signals',
      category: 'sales',
      instructionsFragment: `Cuando un potencial cliente contacte, evaluá su intención de compra considerando estos criterios:
- **Presupuesto**: ¿Mencionó un rango de precios o tiene capacidad de pago?
- **Urgencia**: ¿Necesita el producto/servicio pronto o está explorando?
- **Autoridad**: ¿Es quien toma la decisión de compra?
- **Necesidad**: ¿Tiene un problema concreto que resolver?

Usá la herramienta de lead scoring para calcular un puntaje. Si el puntaje supera {{threshold}}, notificá al equipo de ventas inmediatamente.
Registrá cada evaluación para seguimiento futuro.`,
      requiredTools: ['vehicle-lead-score', 'catalog-search', 'send-notification'],
      requiredMcpServers: [],
      parametersSchema: {
        type: 'object',
        properties: {
          threshold: { type: 'number', default: 70, description: 'Puntaje mínimo para notificar al equipo' },
        },
      },
      tags: ['sales', 'automotive', 'qualification'],
      icon: 'Target',
      isOfficial: true,
    },
    {
      name: 'appointment-scheduling',
      displayName: 'Appointment Scheduling',
      description: 'Help customers book visits, test drives, and appointments',
      category: 'sales',
      instructionsFragment: `Ayudá a los clientes a agendar citas siguiendo este flujo:
1. Preguntá qué tipo de cita necesitan (visita, test drive, consulta, etc.)
2. Ofrecé opciones de fecha y hora dentro del horario de atención: {{businessHours}}
3. Confirmá nombre, teléfono y email del cliente
4. Creá la tarea programada con recordatorio
5. Enviá confirmación al cliente

Zona horaria: {{timezone}}. Siempre confirmá la cita antes de finalizarla.`,
      requiredTools: ['date-time', 'propose-scheduled-task', 'send-notification'],
      requiredMcpServers: [],
      parametersSchema: {
        type: 'object',
        properties: {
          timezone: { type: 'string', default: 'America/Argentina/Buenos_Aires', description: 'Zona horaria' },
          businessHours: { type: 'string', default: 'Lunes a Viernes 9:00-18:00, Sábados 9:00-13:00', description: 'Horario de atención' },
        },
      },
      tags: ['sales', 'scheduling'],
      icon: 'CalendarCheck',
      isOfficial: true,
    },
    {
      name: 'catalog-browsing',
      displayName: 'Product Catalog',
      description: 'Search products, suggest complements, and take orders',
      category: 'sales',
      instructionsFragment: `Sos un experto en el catálogo de productos. Cuando un cliente pregunte:
- Buscá en el catálogo usando términos relevantes
- Mostrá los resultados de forma clara: nombre, precio, disponibilidad
- Sugerí productos complementarios cuando sea apropiado
- Si el cliente quiere comprar, guialo por el proceso de pedido
- Siempre confirmá cantidades y precios antes de procesar

Moneda: {{currency}}. Pedido mínimo: {{minOrder}}.`,
      requiredTools: ['catalog-search', 'catalog-order'],
      requiredMcpServers: [],
      parametersSchema: {
        type: 'object',
        properties: {
          currency: { type: 'string', default: 'ARS', description: 'Moneda' },
          minOrder: { type: 'string', default: 'Sin mínimo', description: 'Pedido mínimo' },
        },
      },
      tags: ['sales', 'ecommerce', 'catalog'],
      icon: 'ShoppingBag',
      isOfficial: true,
    },
    {
      name: 'follow-up-automation',
      displayName: 'Follow-up Automation',
      description: 'Automated follow-up sequences for leads and customers',
      category: 'operations',
      instructionsFragment: `Gestioná el seguimiento automático de leads y clientes:
- Después de cada interacción importante, programá un seguimiento
- Revisá el historial de seguimientos pendientes
- Cuando se active un seguimiento, contactá al cliente con un mensaje personalizado
- Si el cliente no responde después de {{maxAttempts}} intentos, escalá al equipo

Intervalo entre seguimientos: {{intervalDays}} días.`,
      requiredTools: ['vehicle-check-followup', 'send-channel-message', 'propose-scheduled-task'],
      requiredMcpServers: [],
      parametersSchema: {
        type: 'object',
        properties: {
          maxAttempts: { type: 'number', default: 3, description: 'Intentos máximos de contacto' },
          intervalDays: { type: 'number', default: 3, description: 'Días entre cada seguimiento' },
        },
      },
      tags: ['operations', 'follow-up', 'automation'],
      icon: 'RefreshCw',
      isOfficial: true,
    },
    {
      name: 'knowledge-base',
      displayName: 'Knowledge Base',
      description: 'Answer questions from documents and knowledge base',
      category: 'support',
      instructionsFragment: `Tenés acceso a la base de conocimiento del negocio. Cuando te pregunten algo:
1. Buscá en la base de conocimiento usando búsqueda semántica
2. Si encontrás información relevante, respondé basándote en ella
3. Citá la fuente cuando sea posible
4. Si no encontrás la respuesta, decilo honestamente y ofrecé alternativas
5. Podés leer archivos adjuntos para obtener más contexto

Nunca inventes información que no esté respaldada por la base de conocimiento.`,
      requiredTools: ['knowledge-search', 'read-file'],
      requiredMcpServers: [],
      parametersSchema: null,
      tags: ['support', 'knowledge', 'faq'],
      icon: 'BookOpen',
      isOfficial: true,
    },
    {
      name: 'email-communication',
      displayName: 'Email Communication',
      description: 'Send professional emails on behalf of the business',
      category: 'communication',
      instructionsFragment: `Podés enviar emails profesionales en nombre del negocio.
- Usá un tono {{tone}} y profesional
- Incluí saludo personalizado con el nombre del destinatario
- Estructura clara: saludo, cuerpo, despedida
- Firmá como "{{senderName}}"
- Nunca envíes emails sin confirmar el contenido con el usuario primero si es la primera vez`,
      requiredTools: ['send-email', 'date-time'],
      requiredMcpServers: [],
      parametersSchema: {
        type: 'object',
        properties: {
          tone: { type: 'string', default: 'cordial', description: 'Tono de los emails (cordial, formal, casual)' },
          senderName: { type: 'string', default: 'El equipo', description: 'Nombre del remitente' },
        },
      },
      tags: ['communication', 'email'],
      icon: 'Mail',
      isOfficial: true,
    },
    {
      name: 'web-research',
      displayName: 'Web Research',
      description: 'Search the web and fetch data from APIs',
      category: 'operations',
      instructionsFragment: `Podés buscar información en la web y consultar APIs externas.
- Usá búsqueda web para información actualizada
- Podés hacer requests HTTP a APIs públicas o autorizadas
- Siempre verificá la fuente de la información
- Resumí los hallazgos de forma clara y concisa
- Si necesitás datos sensibles de una API, asegurate de tener las credenciales configuradas`,
      requiredTools: ['web-search', 'http-request'],
      requiredMcpServers: [],
      parametersSchema: null,
      tags: ['operations', 'research', 'web'],
      icon: 'Globe',
      isOfficial: true,
    },
    {
      name: 'multi-agent-coordination',
      displayName: 'Agent Coordination',
      description: 'Manager skill: coordinate sub-agents, review conversations, delegate tasks',
      category: 'operations',
      instructionsFragment: `Sos el coordinador de un equipo de agentes. Tus capacidades:
- **Delegar tareas**: Usá delegate-to-agent para asignar tareas a agentes especializados
- **Listar agentes**: Consultá qué agentes están disponibles en el proyecto
- **Revisar conversaciones**: Leé el historial de sesiones para entender el contexto
- **Supervisar**: Monitoreá las conversaciones activas y detectá problemas

Principios:
1. Delegá al agente más apropiado según la tarea
2. Proporcioná contexto suficiente al delegar
3. Si ningún agente puede manejar la tarea, resolvela vos mismo
4. Reportá problemas o patrones que detectes`,
      requiredTools: ['delegate-to-agent', 'list-project-agents', 'query-sessions', 'read-session-history'],
      requiredMcpServers: [],
      parametersSchema: null,
      tags: ['operations', 'manager', 'coordination'],
      icon: 'Crown',
      isOfficial: true,
    },
    {
      name: 'crm-integration',
      displayName: 'CRM Integration',
      description: 'Connect to CRM systems for customer data and pipeline management',
      category: 'sales',
      instructionsFragment: `Tenés acceso al CRM del negocio via MCP. Podés:
- Buscar y consultar datos de clientes
- Ver el pipeline de oportunidades
- Actualizar el estado de deals
- Agregar notas a contactos y oportunidades
- Crear tareas de seguimiento en el CRM

Siempre actualizá el CRM después de interacciones importantes con clientes.
Respetá la privacidad: nunca compartas datos de un cliente con otro.`,
      requiredTools: ['http-request'],
      requiredMcpServers: ['hubspot-crm'],
      parametersSchema: null,
      tags: ['sales', 'crm', 'hubspot'],
      icon: 'Users',
      isOfficial: true,
    },
    {
      name: 'fomo-manager',
      displayName: 'FOMO Manager · Chief of Staff',
      description: 'AI Chief of Staff que reporta al dueño del negocio via WhatsApp. Sin dashboards.',
      category: 'management',
      instructionsFragment: `Sos el Chief of Staff de {{companyName}}. Trabajás directamente para {{ownerName}}.

TU ROL:
- Reportar el estado del negocio cuando te lo pidan
- Alertar proactivamente ante situaciones importantes
- Ejecutar comandos del dueño sobre los demás agentes
- Nunca inventar datos — siempre usar las herramientas disponibles

TONO:
- Directo y claro, sin rodeos
- Profesional pero cercano
- Usás emojis cuando ayudan a la claridad (✅ ⚠️ 📊)
- Nunca decís "como IA" — sos el asistente del dueño`,
      requiredTools: [
        'get-operations-summary',
        'review-agent-activity',
        'query-sessions',
        'list-project-agents',
        'send-notification',
        'propose-scheduled-task',
      ],
      requiredMcpServers: [],
      parametersSchema: {
        type: 'object',
        properties: {
          companyName: { type: 'string', title: 'Nombre de la empresa' },
          ownerName: { type: 'string', title: 'Nombre del dueño' },
          dailyReportTime: { type: 'string', default: '20:00', title: 'Hora del resumen diario (HH:MM)' },
          ownerWhatsApp: { type: 'string', title: 'WhatsApp del dueño (para alertas)' },
        },
        required: ['companyName', 'ownerName'],
      },
      tags: ['management', 'reporting', 'chief-of-staff', 'alerts'],
      icon: 'Crown',
      isOfficial: true,
    },
    {
      name: 'seasonal-pricing',
      displayName: 'Seasonal Pricing',
      description: 'Dynamic pricing based on season and demand',
      category: 'operations',
      instructionsFragment: `Gestioná precios dinámicos basados en temporada y demanda:
- Consultá la herramienta de pricing estacional para obtener tarifas actualizadas
- Aplicá los ajustes de temporada automáticamente
- Informá al cliente sobre promociones o tarifas especiales vigentes
- Si el cliente pregunta por descuentos fuera de temporada, ofrecé alternativas

Temporada alta: {{highSeason}}. Temporada baja: {{lowSeason}}.`,
      requiredTools: ['hotel-seasonal-pricing', 'date-time'],
      requiredMcpServers: [],
      parametersSchema: {
        type: 'object',
        properties: {
          highSeason: { type: 'string', default: 'Diciembre-Marzo', description: 'Meses de temporada alta' },
          lowSeason: { type: 'string', default: 'Abril-Noviembre', description: 'Meses de temporada baja' },
        },
      },
      tags: ['operations', 'hotel', 'pricing'],
      icon: 'DollarSign',
      isOfficial: true,
    },
  ];

  let skillCount = 0;
  for (const tpl of skillTemplates) {
    await prisma.skillTemplate.upsert({
      where: { name: tpl.name },
      update: {
        displayName: tpl.displayName,
        description: tpl.description,
        category: tpl.category,
        instructionsFragment: tpl.instructionsFragment,
        requiredTools: tpl.requiredTools,
        requiredMcpServers: tpl.requiredMcpServers,
        parametersSchema: tpl.parametersSchema ?? Prisma.JsonNull,
        tags: tpl.tags,
        icon: tpl.icon,
        isOfficial: tpl.isOfficial,
      },
      create: {
        name: tpl.name,
        displayName: tpl.displayName,
        description: tpl.description,
        category: tpl.category,
        instructionsFragment: tpl.instructionsFragment,
        requiredTools: tpl.requiredTools,
        requiredMcpServers: tpl.requiredMcpServers,
        parametersSchema: tpl.parametersSchema ?? Prisma.JsonNull,
        tags: tpl.tags,
        icon: tpl.icon,
        isOfficial: tpl.isOfficial,
      },
    });
    skillCount++;
  }
  console.log(`✓ Skill Templates: ${skillCount} upserted`);

  console.log('\nDone. No projects or agents were touched.');
}

main()
  .catch((e: unknown) => {
    console.error('seed-templates failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

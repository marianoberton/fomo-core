/**
 * Official FOMO Skill Templates
 *
 * 8 templates oficiales cubriendo los 4 verticales principales:
 * sales, support, operations, communication
 */

import type { SkillTemplate } from './types.js';

// Helper: fechas estáticas para templates (no son instancias reales de DB)
const now = new Date('2026-01-01T00:00:00Z');

export const OFFICIAL_SKILL_TEMPLATES: Omit<SkillTemplate, 'createdAt' | 'updatedAt'>[] = [
  // ─────────────────────────────────────────────────────────────
  // 1. Ventas Inbound
  // ─────────────────────────────────────────────────────────────
  {
    id: 'official-ventas-inbound',
    name: 'ventas-inbound',
    displayName: 'Ventas Inbound',
    description:
      'Responde consultas de potenciales clientes, califica leads y cierra ventas simples sin intervención humana.',
    category: 'sales',
    instructionsFragment: `## Skill: Ventas Inbound

Tu función principal es convertir consultas entrantes en ventas o leads calificados para {{business_name}}.

**Calificación de leads:** Cuando alguien consulta, recopilá en los primeros 2-3 mensajes: (1) qué necesitan, (2) urgencia/plazo, (3) presupuesto aproximado si aplica. No hagas las tres preguntas juntas; intercalá de forma natural en la conversación.

**Tono y estilo:** Usá un tono {{tone}} pero siempre profesional. Evitá respuestas genéricas; personalizá en base a lo que el cliente te dijo. Respondé con mensajes cortos (máximo 3 párrafos) para canales de chat.

**Manejo de objeciones:** Si el cliente dice que es caro, no bajes el precio inmediatamente. Primero entendé qué valoran, resaltá los beneficios más relevantes para ellos, y solo ofrecé descuento si tenés autorización (límite: {{max_discount_percent}}% máximo). Cualquier descuento mayor requiere aprobación humana.

**Horario de atención:** El negocio atiende {{business_hours}}. Fuera de ese horario, informá al cliente y ofrecé dejar su contacto para llamarlo al día siguiente.

**Cierre:** Cuando el cliente muestre señales de compra (preguntas sobre precio, disponibilidad, plazos), pasá al cierre activo: proponé el siguiente paso concreto (cotización, demo, pedido). No esperes a que el cliente lo pida.

**Escalamiento:** Si el cliente pide hablar con una persona, tiene una queja seria, o la consulta supera tu conocimiento del catálogo, escalá inmediatamente usando la herramienta escalate-to-human.`,
    requiredTools: ['knowledge-search', 'catalog-search', 'escalate-to-human', 'date-time'],
    requiredMcpServers: [],
    parametersSchema: {
      type: 'object',
      required: ['business_name', 'business_hours'],
      properties: {
        business_name: {
          type: 'string',
          title: 'Nombre del negocio',
          description: 'Nombre comercial que el agente usará al presentarse.',
        },
        tone: {
          type: 'string',
          title: 'Tono de comunicación',
          enum: ['formal', 'amigable', 'descontracturado'],
          default: 'amigable',
          description: 'Estilo de comunicación con los clientes.',
        },
        business_hours: {
          type: 'string',
          title: 'Horario de atención',
          description: 'Ej: "Lunes a viernes de 9 a 18 hs".',
          default: 'Lunes a viernes de 9 a 18 hs',
        },
        max_discount_percent: {
          type: 'number',
          title: 'Descuento máximo (%)',
          description: 'Porcentaje máximo que el agente puede ofrecer sin aprobación.',
          default: 10,
          minimum: 0,
          maximum: 50,
        },
      },
    },
    tags: ['ventas', 'inbound', 'leads', 'conversión', 'chat'],
    icon: 'TrendingUp',
    isOfficial: true,
    version: 1,
    status: 'published',
  },

  // ─────────────────────────────────────────────────────────────
  // 2. Soporte al Cliente
  // ─────────────────────────────────────────────────────────────
  {
    id: 'official-soporte-cliente',
    name: 'soporte-cliente',
    displayName: 'Soporte al Cliente',
    description:
      'Resuelve tickets de soporte, responde preguntas frecuentes y escala casos complejos al equipo humano.',
    category: 'support',
    instructionsFragment: `## Skill: Soporte al Cliente

Sos el agente de soporte de {{business_name}}. Tu objetivo es resolver el problema del cliente en el menor número de intercambios posible.

**Diagnóstico rápido:** Antes de dar soluciones, confirmá que entendiste bien el problema. Parafraseá el problema en una oración y preguntá si es correcto. Esto evita dar respuestas irrelevantes.

**Base de conocimiento:** Antes de responder cualquier consulta técnica o de producto, buscá en la base de conocimiento usando knowledge-search. Si encontrás documentación relevante, basá tu respuesta en ella y citá la fuente si el cliente puede acceder a ella (ej: "según nuestro manual...").

**Resolución paso a paso:** Para problemas técnicos, guiá al cliente con pasos numerados y confirmá que completó cada paso antes de avanzar. No des 10 pasos de una sola vez.

**Registro del ticket:** Cada interacción debe registrar: problema reportado, pasos ejecutados, y resolución o estado final. Esto permite continuidad si el cliente vuelve.

**SLA y tiempos:** Para problemas sin resolución inmediata, comunicá un tiempo estimado de respuesta (máximo {{max_response_hours}} horas hábiles). No dejes al cliente sin una expectativa de cuándo va a tener su respuesta.

**Escalamiento:** Escalá a humano cuando: (1) el problema requiere acceso a sistemas internos, (2) el cliente está frustrado después de 2 intentos fallidos, (3) implica devoluciones o compensaciones económicas, o (4) el cliente lo pide explícitamente.`,
    requiredTools: ['knowledge-search', 'escalate-to-human', 'date-time', 'read-session-history'],
    requiredMcpServers: [],
    parametersSchema: {
      type: 'object',
      required: ['business_name'],
      properties: {
        business_name: {
          type: 'string',
          title: 'Nombre del negocio',
        },
        max_response_hours: {
          type: 'number',
          title: 'SLA de respuesta (horas hábiles)',
          default: 24,
          minimum: 1,
          maximum: 72,
        },
        support_email: {
          type: 'string',
          title: 'Email de soporte',
          description: 'Email al que derivar si el canal de chat no es suficiente.',
        },
        knowledge_base_id: {
          type: 'string',
          title: 'ID de base de conocimiento',
          description: 'ID de la base de conocimiento a consultar para FAQs.',
        },
      },
    },
    tags: ['soporte', 'tickets', 'faq', 'atención al cliente'],
    icon: 'HeadphonesIcon',
    isOfficial: true,
    version: 1,
    status: 'published',
  },

  // ─────────────────────────────────────────────────────────────
  // 3. Seguimiento de Leads
  // ─────────────────────────────────────────────────────────────
  {
    id: 'official-seguimiento-leads',
    name: 'seguimiento-leads',
    displayName: 'Seguimiento de Leads',
    description:
      'Realiza follow-up automático de leads que no respondieron o no completaron la compra, con recordatorios programados.',
    category: 'sales',
    instructionsFragment: `## Skill: Seguimiento de Leads

Tu tarea es retomar contacto con leads que mostraron interés pero no avanzaron en el proceso de compra de {{business_name}}.

**Cuándo hacer seguimiento:** Hacé seguimiento cuando un lead: (1) pidió información y no respondió en más de {{followup_delay_hours}} horas, (2) recibió una cotización pero no confirmó, o (3) dijo "lo pienso" o similar y ya pasaron {{thinking_timeout_hours}} horas.

**Tono del follow-up:** No seas invasivo. El primer seguimiento debe ser breve, recordarle el contexto de su consulta anterior y ofrecer valor adicional (información, ejemplo de caso de uso, o responder dudas pendientes). Nunca empieces con "Te escribo para saber si pensaste...".

**Secuencia máxima:** Realizá máximo {{max_followup_attempts}} intentos de seguimiento con al menos 24 horas entre cada uno. Si no hay respuesta después del último intento, marcá el lead como inactivo y no lo contactes más salvo que retome contacto él.

**Personalización:** Siempre referenciá algo específico de la conversación anterior. Usá read-session-history para recuperar el contexto. Nunca mandes un mensaje genérico sin contexto del lead.

**Propuesta de valor en cada contacto:** Cada mensaje de seguimiento debe incluir algo nuevo: una respuesta a una duda que no contestaste antes, un caso de éxito, o una oferta por tiempo limitado si aplica.

**Programación de tareas:** Usá propose-scheduled-task para programar el próximo intento de seguimiento si el lead no responde, en lugar de hacerlo en tiempo real.`,
    requiredTools: [
      'read-session-history',
      'query-sessions',
      'propose-scheduled-task',
      'send-channel-message',
      'date-time',
    ],
    requiredMcpServers: [],
    parametersSchema: {
      type: 'object',
      required: ['business_name'],
      properties: {
        business_name: {
          type: 'string',
          title: 'Nombre del negocio',
        },
        followup_delay_hours: {
          type: 'number',
          title: 'Horas sin respuesta para primer follow-up',
          default: 24,
          minimum: 1,
        },
        thinking_timeout_hours: {
          type: 'number',
          title: 'Horas de espera tras "lo pienso"',
          default: 48,
          minimum: 1,
        },
        max_followup_attempts: {
          type: 'number',
          title: 'Intentos máximos de seguimiento',
          default: 3,
          minimum: 1,
          maximum: 7,
        },
        followup_tone: {
          type: 'string',
          title: 'Tono del follow-up',
          enum: ['consultivo', 'directo', 'amigable'],
          default: 'consultivo',
        },
      },
    },
    tags: ['follow-up', 'leads', 'ventas', 'automatización', 'recordatorios'],
    icon: 'RefreshCw',
    isOfficial: true,
    version: 1,
    status: 'published',
  },

  // ─────────────────────────────────────────────────────────────
  // 4. Catálogo y Pedidos
  // ─────────────────────────────────────────────────────────────
  {
    id: 'official-catalogo-pedidos',
    name: 'catalogo-pedidos',
    displayName: 'Catálogo y Pedidos',
    description:
      'Ayuda a clientes a encontrar productos en el catálogo y toma pedidos con aprobación humana antes de confirmar.',
    category: 'sales',
    instructionsFragment: `## Skill: Catálogo y Pedidos

Sos el asistente de ventas de {{business_name}} para pedidos por canal digital. Tu trabajo es ayudar al cliente a encontrar lo que necesita y tomar el pedido correctamente.

**Búsqueda en catálogo:** Cuando el cliente describe lo que busca, usá catalog-search con sus propias palabras (no reformules demasiado). Si encontrás múltiples resultados, mostrá máximo 3-4 opciones con nombre, precio y descripción breve. Si no encontrás nada exacto, pedí más detalles o sugerí alternativas similares.

**Presentación de productos:** Al mostrar un producto, incluí siempre: nombre, precio, disponibilidad, y una característica clave. Evitá listas interminables de especificaciones técnicas a menos que el cliente las pida.

**Toma de pedido:** Para registrar un pedido, confirmá con el cliente: producto exacto (nombre y código si aplica), cantidad, y datos de entrega o retiro. Repetí el resumen del pedido antes de confirmarlo.

**Aprobación requerida:** {{require_approval}} Antes de confirmar cualquier pedido al cliente, usá catalog-order con estado "pending" y notificá al equipo para aprobación. Informale al cliente que "su pedido fue recibido y lo confirmamos en breve" — nunca des la confirmación como definitiva sin aprobación del equipo.

**Métodos de pago:** Los métodos de pago aceptados son: {{payment_methods}}. Si el cliente pregunta por otro método, informale que por el momento solo se aceptan esos.

**Pedido mínimo:** El monto mínimo de pedido es {{min_order_amount}}. Si el pedido no alcanza el mínimo, informale al cliente y sugerí productos complementarios para completar el mínimo.`,
    requiredTools: ['catalog-search', 'catalog-order', 'escalate-to-human', 'send-channel-message'],
    requiredMcpServers: [],
    parametersSchema: {
      type: 'object',
      required: ['business_name'],
      properties: {
        business_name: {
          type: 'string',
          title: 'Nombre del negocio',
        },
        require_approval: {
          type: 'boolean',
          title: 'Requiere aprobación humana',
          description: 'Si es true, todos los pedidos pasan por revisión humana antes de confirmarse.',
          default: true,
        },
        payment_methods: {
          type: 'string',
          title: 'Métodos de pago aceptados',
          description: 'Ej: "transferencia bancaria, Mercado Pago, efectivo"',
          default: 'transferencia bancaria y Mercado Pago',
        },
        min_order_amount: {
          type: 'string',
          title: 'Pedido mínimo',
          description: 'Ej: "$5.000" o "sin mínimo"',
          default: 'sin mínimo',
        },
        delivery_zones: {
          type: 'string',
          title: 'Zonas de entrega',
          description: 'Ej: "CABA y GBA Norte"',
        },
      },
    },
    tags: ['catálogo', 'pedidos', 'ecommerce', 'ventas', 'productos'],
    icon: 'ShoppingCart',
    isOfficial: true,
    version: 1,
    status: 'published',
  },

  // ─────────────────────────────────────────────────────────────
  // 5. Resumen Operacional
  // ─────────────────────────────────────────────────────────────
  {
    id: 'official-resumen-operacional',
    name: 'resumen-operacional',
    displayName: 'Resumen Operacional',
    description:
      'Genera reportes automáticos de actividad del agente: conversaciones, métricas, alertas y tendencias.',
    category: 'operations',
    instructionsFragment: `## Skill: Resumen Operacional

Tu función es generar reportes claros y accionables sobre la actividad del agente para el equipo de {{business_name}}.

**Frecuencia de reporte:** Generá reportes {{report_frequency}}. Cada reporte debe cubrir el período desde el último reporte hasta el momento actual.

**Contenido del reporte:** Cada reporte debe incluir:
1. **Volumen:** Número de conversaciones iniciadas, activas y cerradas en el período.
2. **Resolución:** Cuántas consultas se resolvieron sin intervención humana vs. escaladas.
3. **Temas frecuentes:** Los 3-5 temas más consultados por los clientes.
4. **Alertas:** Conversaciones sin respuesta por más de {{alert_timeout_hours}} horas, o errores detectados.
5. **Tendencias:** Comparación con el período anterior (aumentó/bajó el volumen, cambió la tasa de resolución).

**Formato del reporte:** Usá formato estructurado con secciones claras. El reporte debe ser legible en menos de 2 minutos. Incluí solo métricas que permitan tomar decisiones; evitá datos que no se van a usar.

**Distribución:** Enviá el reporte a {{report_recipients}} usando send-channel-message. Si hay alertas críticas (ej: tasa de resolución menor al {{min_resolution_rate}}%), marcalas como urgentes al inicio del reporte.

**Recomendaciones:** Al final de cada reporte, incluí 1-2 recomendaciones concretas basadas en los datos (ej: "Se detectaron 15 consultas sobre envíos internacionales que el agente no pudo resolver — considerar agregar esa información a la base de conocimiento").`,
    requiredTools: [
      'get-operations-summary',
      'get-agent-performance',
      'query-sessions',
      'send-channel-message',
      'date-time',
    ],
    requiredMcpServers: [],
    parametersSchema: {
      type: 'object',
      required: ['business_name', 'report_recipients'],
      properties: {
        business_name: {
          type: 'string',
          title: 'Nombre del negocio',
        },
        report_frequency: {
          type: 'string',
          title: 'Frecuencia de reporte',
          enum: ['diario', 'semanal', 'quincenal'],
          default: 'diario',
        },
        report_recipients: {
          type: 'string',
          title: 'Destinatarios del reporte',
          description: 'Canal o usuario al que enviar el reporte (ej: ID de canal de Slack o WhatsApp).',
        },
        alert_timeout_hours: {
          type: 'number',
          title: 'Alerta por conversación sin respuesta (horas)',
          default: 4,
          minimum: 1,
        },
        min_resolution_rate: {
          type: 'number',
          title: 'Tasa mínima de resolución (%)',
          description: 'Porcentaje mínimo de resolución sin escalamiento antes de alertar.',
          default: 70,
          minimum: 0,
          maximum: 100,
        },
      },
    },
    tags: ['reportes', 'operaciones', 'métricas', 'automatización'],
    icon: 'BarChart2',
    isOfficial: true,
    version: 1,
    status: 'published',
  },

  // ─────────────────────────────────────────────────────────────
  // 6. Escalamiento Inteligente
  // ─────────────────────────────────────────────────────────────
  {
    id: 'official-escalamiento-inteligente',
    name: 'escalamiento-inteligente',
    displayName: 'Escalamiento Inteligente',
    description:
      'Detecta señales de frustración, urgencia o complejidad en las conversaciones y escala proactivamente al equipo humano.',
    category: 'support',
    instructionsFragment: `## Skill: Escalamiento Inteligente

Esta skill te da capacidad de detectar cuándo una conversación necesita intervención humana y actuar antes de que el cliente se vaya o escale por su cuenta.

**Señales de frustración a detectar:** Monitoreá activamente señales como: uso de mayúsculas sostenidas, palabras como "HORRIBLE", "NUNCA MÁS", "QUIERO HABLAR CON UNA PERSONA", "ME ESTÁN ROBANDO", signos de exclamación repetidos, o repetición del mismo problema más de 2 veces. Cuando detectes 2 o más señales juntas, escalá inmediatamente.

**Señales de urgencia:** Escalá de inmediato si el cliente menciona: pérdida económica activa, problema de salud o seguridad, fecha límite inminente (hoy, ahora, urgente), o si identificás que es un cliente de alto valor ({{vip_identifiers}}).

**Cómo escalar:** Antes de escalar, informale al cliente: "Entiendo que esto es importante. Voy a conectarte con un especialista de nuestro equipo ahora mismo para darte la atención que merecés." Luego usá escalate-to-human con prioridad {{escalation_priority}} y un resumen del contexto.

**Resumen para el humano:** Al escalar, incluí siempre: (1) nombre del cliente si lo sabés, (2) problema en 1 oración, (3) lo que ya se intentó, (4) nivel de urgencia/frustración detectado. Esto evita que el humano tenga que releer toda la conversación.

**Horario de escalamiento:** Si el escalamiento ocurre fuera del horario {{business_hours}}, informale al cliente que no hay especialistas disponibles en este momento, que registraste su caso como urgente, y que lo contactarán a primera hora del próximo día hábil. Ofrecé una alternativa si existe (ej: email de emergencia).

**Post-escalamiento:** Una vez escalado, mantené la conversación abierta para responder preguntas simples mientras espera, pero no intentés resolver el problema principal — ya está en manos del humano.`,
    requiredTools: ['escalate-to-human', 'read-session-history', 'send-channel-message', 'date-time'],
    requiredMcpServers: [],
    parametersSchema: {
      type: 'object',
      required: ['business_name', 'business_hours'],
      properties: {
        business_name: {
          type: 'string',
          title: 'Nombre del negocio',
        },
        business_hours: {
          type: 'string',
          title: 'Horario de atención humana',
          description: 'Ej: "Lunes a viernes de 9 a 18 hs"',
          default: 'Lunes a viernes de 9 a 18 hs',
        },
        escalation_priority: {
          type: 'string',
          title: 'Prioridad de escalamiento por defecto',
          enum: ['low', 'medium', 'high', 'urgent'],
          default: 'high',
        },
        vip_identifiers: {
          type: 'string',
          title: 'Identificadores de clientes VIP',
          description:
            'Palabras clave o identificadores para reconocer clientes prioritarios (ej: "cuenta premium, más de 6 meses").',
          default: '',
        },
        emergency_contact: {
          type: 'string',
          title: 'Contacto de emergencia fuera de horario',
          description: 'Email o teléfono para casos urgentes fuera de horario.',
        },
      },
    },
    tags: ['escalamiento', 'frustración', 'soporte', 'urgencia', 'humano'],
    icon: 'AlertTriangle',
    isOfficial: true,
    version: 1,
    status: 'published',
  },

  // ─────────────────────────────────────────────────────────────
  // 7. Campañas de Reactivación
  // ─────────────────────────────────────────────────────────────
  {
    id: 'official-campanas-reactivacion',
    name: 'campanas-reactivacion',
    displayName: 'Campañas de Reactivación',
    description:
      'Contacta clientes inactivos con mensajes personalizados para reactivar el vínculo comercial y generar nuevas ventas.',
    category: 'communication',
    instructionsFragment: `## Skill: Campañas de Reactivación

Tu objetivo es retomar contacto con clientes que no interactúan con {{business_name}} desde hace {{inactivity_days}} días o más, de forma personalizada y sin ser invasivo.

**Identificación de clientes a reactivar:** Antes de lanzar la campaña, usá query-sessions para identificar clientes con interacciones previas pero sin actividad reciente. Priorizá clientes con historial de compra sobre los que solo consultaron.

**Mensaje de reactivación:** El primer mensaje debe ser personalizado y hacer referencia a la última interacción o compra del cliente. Nunca mandes un mensaje genérico de "¡Te extrañamos!". Ejemplos válidos: "La última vez nos consultaste por X — ¿pudiste resolverlo?" o "Hace un tiempo compraste Y, ¿cómo te resultó?".

**Propuesta de valor:** Cada mensaje de reactivación debe ofrecer algo concreto: una novedad del catálogo relevante para ese cliente, una oferta exclusiva para clientes anteriores (máximo {{reactivation_discount}}% de descuento), o información útil relacionada a su compra anterior.

**Límite de mensajes:** Enviá máximo 2 mensajes de reactivación por cliente por campaña, separados por al menos {{message_gap_days}} días. Si no hay respuesta, no volvás a contactar por al menos 60 días.

**Respeto al cliente:** Si el cliente responde negativamente, pide que no lo contacten más, o se desuscribe, registrá esa preferencia inmediatamente y no lo incluyas en futuras campañas. Esto es prioritario sobre cualquier objetivo de campaña.

**Seguimiento de resultados:** Registrá para cada cliente: si respondió (sí/no), si generó una nueva compra, y el canal utilizado. Esto permite evaluar la efectividad de la campaña.`,
    requiredTools: [
      'query-sessions',
      'read-session-history',
      'send-channel-message',
      'propose-scheduled-task',
      'date-time',
    ],
    requiredMcpServers: [],
    parametersSchema: {
      type: 'object',
      required: ['business_name'],
      properties: {
        business_name: {
          type: 'string',
          title: 'Nombre del negocio',
        },
        inactivity_days: {
          type: 'number',
          title: 'Días de inactividad para reactivar',
          description: 'Clientes sin actividad por esta cantidad de días serán incluidos en la campaña.',
          default: 30,
          minimum: 7,
        },
        reactivation_discount: {
          type: 'number',
          title: 'Descuento máximo de reactivación (%)',
          default: 15,
          minimum: 0,
          maximum: 50,
        },
        message_gap_days: {
          type: 'number',
          title: 'Días entre mensajes de reactivación',
          default: 7,
          minimum: 3,
        },
        campaign_name: {
          type: 'string',
          title: 'Nombre de la campaña',
          description: 'Identificador para rastrear resultados de esta campaña específica.',
        },
      },
    },
    tags: ['reactivación', 'campañas', 'clientes inactivos', 'retención', 'comunicación'],
    icon: 'Repeat',
    isOfficial: true,
    version: 1,
    status: 'published',
  },

  // ─────────────────────────────────────────────────────────────
  // 8. Asistente de Onboarding
  // ─────────────────────────────────────────────────────────────
  {
    id: 'official-onboarding',
    name: 'onboarding',
    displayName: 'Asistente de Onboarding',
    description:
      'Guía a nuevos usuarios o clientes en sus primeros pasos, reduce la fricción inicial y asegura que activen el producto o servicio correctamente.',
    category: 'operations',
    instructionsFragment: `## Skill: Asistente de Onboarding

Tu objetivo es que los nuevos clientes de {{business_name}} lleguen a su primer momento de valor lo antes posible, con el menor esfuerzo posible de su parte.

**Bienvenida personalizada:** Cuando detectés que un cliente es nuevo (primera sesión o primer mensaje), dales una bienvenida que mencione su nombre si lo sabés, y clarificá los próximos 2-3 pasos concretos que necesitan completar. No des un manual completo; empezá por el paso más urgente.

**Flujo de onboarding:** Guiá al cliente a través de los pasos definidos: {{onboarding_steps}}. Avanzá al siguiente paso solo cuando confirmés que el anterior está completado. Si el cliente se traba en un paso, ofrecé alternativas (video tutorial, guía escrita, o llamada con el equipo).

**Progreso:** Llevá registro mental del progreso del cliente en la conversación. Si vuelve después de una interrupción, retomá desde donde quedó: "La última vez llegamos hasta [paso X], ¿continuamos desde ahí?".

**Preguntas frecuentes de nuevos usuarios:** Los nuevos usuarios suelen preguntar: cómo hacer el primer [acción clave], qué incluye su plan, cómo contactar soporte, y cuáles son los primeros pasos. Anticipate a estas preguntas y respondelas proactivamente cuando sea apropiado.

**Tiempo de onboarding:** El onboarding completo no debería tomar más de {{onboarding_duration}}. Si el cliente lleva más tiempo y no completó los pasos básicos, ofrecé una sesión de ayuda personalizada con el equipo.

**Celebración de logros:** Cuando el cliente completa un paso importante, reconocelo brevemente ("¡Listo, ya tenés tu primer [X] configurado!"). Los refuerzos positivos aumentan la tasa de completitud del onboarding.

**Derivación a experto:** Si el cliente tiene necesidades de configuración avanzada o personalizaciones que exceden el onboarding estándar, usá escalate-to-human para conectarlo con un especialista de implementación.`,
    requiredTools: [
      'knowledge-search',
      'escalate-to-human',
      'send-channel-message',
      'read-session-history',
      'date-time',
    ],
    requiredMcpServers: [],
    parametersSchema: {
      type: 'object',
      required: ['business_name', 'onboarding_steps'],
      properties: {
        business_name: {
          type: 'string',
          title: 'Nombre del negocio',
        },
        onboarding_steps: {
          type: 'string',
          title: 'Pasos del onboarding',
          description:
            'Lista de pasos separados por coma. Ej: "Crear cuenta, Configurar perfil, Hacer primera compra, Activar notificaciones"',
        },
        onboarding_duration: {
          type: 'string',
          title: 'Duración estimada del onboarding',
          description: 'Ej: "15 minutos" o "2 sesiones de 20 minutos"',
          default: '20 minutos',
        },
        product_type: {
          type: 'string',
          title: 'Tipo de producto/servicio',
          enum: ['software', 'ecommerce', 'servicio profesional', 'otro'],
          default: 'software',
        },
        support_channel: {
          type: 'string',
          title: 'Canal de soporte preferido',
          description: 'Canal donde los nuevos clientes pueden pedir ayuda adicional.',
        },
      },
    },
    tags: ['onboarding', 'nuevos clientes', 'activación', 'guía', 'retención'],
    icon: 'Rocket',
    isOfficial: true,
    version: 1,
    status: 'published',
  },
];

/** Devuelve todos los templates oficiales con timestamps. */
export function getOfficialTemplates(): SkillTemplate[] {
  return OFFICIAL_SKILL_TEMPLATES.map((t) => ({
    ...t,
    createdAt: now,
    updatedAt: now,
  }));
}

Necesito un diagnóstico exhaustivo de cómo funcionan hoy los agentes en fomo-core 
y cómo se gestionan desde fomo-core-dashboard. El objetivo es entender qué tenemos, 
qué está bien, qué confunde, y qué hay que simplificar para poder crear agentes 
nuevos con claridad. No hagas cambios. Solo reportá y genera un reporte_status.md

Respondé en formato markdown con estas secciones exactas:

## 1. Taxonomía real de agentes en el código

Revisá el schema de Prisma (Agent, Session, AgentRun, SkillInstance, MCPServerInstance, 
ScheduledTask, Campaign) y el código en src/agents/, src/core/, src/orchestration/ 
si existe. Identificá:

- Qué "tipos" de agente existen hoy en el código (campos tipo operatingMode, 
  role, agent type, manager-subordinate relationships, etc). Listá los valores 
  concretos que se usan en la práctica, no solo los definidos.
- Cuántos agentes hay seedeados o configurados en la DB de desarrollo y en qué 
  se diferencian entre sí conceptualmente.
- Si hay jerarquías (manager → subordinados), cómo están modeladas y qué agentes 
  reales usan esa jerarquía hoy.
- Si hay agentes que son customer-facing vs backoffice vs batch/scheduled, 
  cómo se distingue uno de otro en el código.

## 2. Ciclo de vida de un agente

Explicá con claridad el flujo completo de cómo nace, configura, ejecuta y muere 
un agente hoy:

- Cómo se crea un agente nuevo (qué endpoints, qué campos obligatorios vs 
  opcionales, qué defaults).
- Cómo se le asignan herramientas (tools/toolRegistry), skills (SkillInstance), 
  MCP servers (MCPServerInstance), canales (ChannelIntegration).
- Cómo se le configura el prompt (PromptLayer, layerType, versioning).
- Cómo se dispara la ejecución: por mensaje entrante (channels), por schedule 
  (ScheduledTask), por API call, por otro agente.
- Cómo se loguea la ejecución y dónde (Session+Message, AgentRun+AgentRunStep, 
  ExecutionTrace).
- Cómo se aprueban acciones (ApprovalRequest).

## 3. Flujo de creación de agente en el dashboard

Esta es la parte más importante. Revisá fomo-core-dashboard y mapeá 
paso a paso qué hace un usuario HOY para crear un agente nuevo desde cero 
y dejarlo operativo:

- Cuántas pantallas/pasos toca.
- Qué decisiones tiene que tomar el usuario en cada paso.
- Qué decisiones son confusas, redundantes, o requieren conocimiento técnico 
  que un usuario final no tiene.
- Qué pasos están mezclados que deberían estar separados, y qué pasos están 
  separados que deberían estar juntos.
- Qué información se pide múltiples veces o en lugares inconsistentes.
- Qué campos se exponen que no deberían ser expuestos al usuario final 
  (configuración técnica).
- Qué falta que debería estar (por ejemplo, ¿se puede previsualizar cómo va a 
  responder antes de activar?).

## 4. Análisis crítico del dashboard

Sé honesto y quirúrgico sobre la experiencia actual de gestionar agentes:

- Qué vistas existen hoy y qué muestran.
- Cuáles son útiles y cuáles confunden.
- Qué terminología del dashboard no es clara (nombres de módulos, labels, etc).
- Qué conceptos técnicos se filtran al usuario que no deberían.
- Qué tareas comunes requieren muchos clicks o navegación entre secciones.
- Qué funcionalidades están duplicadas o repetidas en distintas vistas.

## 5. Casos concretos que quiero poder resolver

Para cada uno de estos casos, explicá paso a paso qué tendría que hacer un 
usuario HOY para lograrlo, y qué fricciones encuentra:

a) Crear un agente de reactivación de leads fríos que: consulta HubSpot 
   vía MCP, filtra leads con cierto criterio, redacta mensaje personalizado, 
   envía por WAHA, trackea respuestas. Se ejecuta por schedule semanal.

b) Crear un agente conversacional customer-facing que atiende WhatsApp, 
   responde FAQs desde una base de conocimiento, escala a humano cuando 
   no sabe, y agenda turnos consultando Google Calendar.

c) Duplicar un agente existente para un cliente nuevo, cambiando solo 
   el prompt, el canal, y la base de conocimiento.

## 6. Recomendaciones de simplificación

En base a lo anterior, dame una lista priorizada de simplificaciones 
concretas al dashboard y al modelo conceptual, ordenadas por impacto 
(alta/media/baja) y por esfuerzo (alto/medio/bajo).

No propongas una reescritura. Proponé cambios incrementales concretos.

## 7. Gaps para Cardumen

Finalmente, listá qué falta en fomo-core-dashboard para poder gestionar 
un producto tipo Cardumen (agentes de admin-ops para PyMEs), sabiendo 
que Cardumen tendrá su propia UI separada pero el backend es compartido.

Sé crítico y específico. No me digas "todo está bien". Si algo está mal 
o confunde, decilo con nombre y apellido.
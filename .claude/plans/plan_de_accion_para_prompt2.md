Tenés el reporte de status completo del sistema de agentes (adjunto). 
Ahora necesito el plan de acción ejecutable.

## Decisiones ya tomadas (no cuestionar, son input)

**Decisión 1 — Cliente de reactivación de leads**: vamos con Opción B. 
Construimos el fix mínimo antes de entregar. Plan aproximado:
- Agregar archetype "outbound_campaign" al wizard.
- UI básica de Campañas (list + create + detail + replies tracking).
- Vincular ScheduledTask ↔ Agent en UI.
- Después configurar al cliente real sobre esta base.

**Decisión 2 — Qué dashboard servimos**: Opción C. Coexisten.
- fomo-core-dashboard queda como admin interno FOMO, limpiado y 
  ordenado para que los consultores puedan configurar agentes de 
  clientes sin fricción.
- Cardumen es un frontend nuevo separado (cardumen-app) que consume 
  la misma API, diseñado con Claude Design aparte. No es parte de 
  este plan.
- Tanto Cardumen como el dashboard comparten fomo-core backend.

**Decisión 3 — Alcance del backend**: Inversión estratégica.
- Formalizar G1 (enum de tipos de agente).
- Agregar G3 (AgentTemplate como modelo persistido).
- Implementar G12 (RBAC básico: owner/operator/viewer).
- Dejar listados los demás gaps (G2, G4-G11, G13) como backlog documentado.

**Restricción crítica sobre preservar lo que funciona**:
La página `/projects/[id]/agents/[id]/chat` con WS real-time y 
visualización de tool calls está siendo usada activamente por la QA 
del equipo. NO se toca, NO se rompe, NO se refactoriza salvo para 
mejoras aditivas. Ese chat de testing se queda intacto.

## Lo que necesito que entregues

Un plan ejecutable en formato markdown que incluya:

### Sección 1 — Resumen ejecutivo
3-5 bullets. Qué vamos a lograr, en cuánto tiempo, y qué queda afuera.

### Sección 2 — Plan temporal con entregables

Quiero entregables concretos por semana, no "trabajar en X".
Asumí que tengo capacidad de correr 3 Claude Code en paralelo bien 
coordinados (un agente por scope: backend, dashboard UI, feature nueva).

Estructurá en 4 semanas:
- Semana 1: fundamentos (migraciones de schema, RBAC, limpieza crítica).
- Semana 2: Campañas UI + wizard fix (desbloqueo del cliente).
- Semana 3: simplificaciones UI restantes.
- Semana 4: configuración del cliente real + docs + loose ends.

Para cada semana:
- Entregables concretos (lo que debe estar andando al final).
- División en tracks paralelos (cuáles se pueden correr simultáneo 
  y cuáles tienen dependencias).
- Tiempo estimado por track.

### Sección 3 — Frente A: backend fomo-core

Detalle de cada cambio propuesto con:
- Archivos específicos tocados.
- Nuevo schema de Prisma si aplica (dame el DDL concreto).
- Migraciones necesarias (en qué orden, si afectan datos existentes).
- Endpoints nuevos o modificados.
- Tests que se deberían agregar.
- Estimación en horas.
- Dependencias (qué tiene que estar antes).

Focus específico en:
- **G1 — Taxonomía formal de agentes**: proponé un enum Prisma 
  concreto. Mi sugerencia inicial es 3 tipos (conversational / 
  process / backoffice) pero podés proponer otra segmentación si 
  el código te sugiere algo mejor. Plan de migración: cómo traducir 
  `operatingMode` + `metadata.archetype` actuales al nuevo enum sin 
  romper los agentes ya corriendo.
- **G3 — AgentTemplate como modelo**: schema de Prisma, endpoints 
  CRUD, y flow "crear agente desde template" en el wizard. El 
  template debe soportar: nombre, descripción, tipo, tools 
  sugeridas, MCP sugeridos, prompt base, scheduled task opcional.
- **G12 — RBAC básico**: 3 roles (owner/operator/viewer), middleware 
  de autorización, endpoints para gestionar members por proyecto. 
  Sin over-engineering.
- **Modelo Campaign enriquecido**: revisá si Campaign/CampaignSend/
  CampaignReply actuales necesitan ajustes para soportar el caso de 
  reactivación de leads (source audience desde MCP, tracking de 
  replies entrantes, estados de lead: contacted/replied/converted/
  unsubscribed).

### Sección 4 — Frente B: dashboard UI

Detalle de cambios con:
- Archivos/componentes específicos tocados o creados.
- Antes/después conceptual.
- Estimación en horas.
- Dependencias del backend.

Focus específico en:

**4.1 — Limpieza de basura (rápido, alto impacto)**:
- Matar duplicados: `/conversations` (global) vs `/inbox` — decidir 
  cuál queda y migrar links.
- Matar duplicados: `/approvals` global vs por-proyecto — idem.
- Eliminar páginas vacías/mock: `/projects/[id]/prompts`, 
  `/agents/[id]/logs` (mock), `/traces`, `/cost` global. 
  Decidir por cada una: terminar o quitar del navigation.
- Renombrar labels jergosos en toda la UI según la tabla del reporte.
- Unificar idioma del dashboard a español.
- Sidebar agrupado: Configuración / Operación / Observabilidad / Admin.

**4.2 — Agent detail con tabs**:
- Partir `/agents/[id]/page.tsx` (400+ líneas) en tabs: Overview, 
  Prompt, Tools & MCP, Channels, Runs.
- IMPORTANTE: la tab de "Chat de testing" actual NO se toca. Se 
  mantiene como está. Se expone como tab separada o como link 
  externo.

**4.3 — Wizard de creación linealizado**:
- Paso 1: Plantilla (ahora desde AgentTemplate real, no hardcoded).
- Paso 2: Nombre + canales + tipo formal (nuevo enum G1).
- Paso 3: Conexiones (alerta si el canal no tiene credenciales).
- Paso 4: Preview + test rápido antes de activar.
- Status `draft` hasta que el usuario apruebe en preview.

**4.4 — UI de Campañas** (sección nueva):
- `/projects/[id]/campaigns` listing.
- `/projects/[id]/campaigns/new` wizard.
- `/projects/[id]/campaigns/[id]` detail con: audience, mensajes 
  enviados, replies entrantes, métricas de conversión, controles 
  (pausar/reanudar/cancelar).
- Vincular a un agente del proyecto (selector).
- Vincular a un ScheduledTask si es recurrente.

**4.5 — Vincular ScheduledTask ↔ Agent en UI**:
- Al crear task, dropdown de agentes del proyecto.
- Mostrar tasks dentro del agent detail (nueva tab o sección 
  Overview).

### Sección 5 — Backlog documentado (lo que queda afuera)

Listá los gaps que NO se abordan en este plan:
- G2 — managerAgentId operativo.
- G4 — vínculos por FK en lugar de strings.
- G5 — MCPServerInstance portable entre tenants.
- G6 — export/import de agente.
- G7 — knowledge base versionado/export.
- G8 — PromptLayers versionados en UI.
- G9 — métricas de salud agregadas.
- G11 — webhooks salientes.
- G13 — readOnly/managedByPlatform flags.

Para cada uno:
- Por qué queda afuera ahora.
- Cuándo tendría sentido abordarlo (trigger: cantidad de clientes, 
  feedback concreto, integración Cardumen avanzada, etc.).
- Esfuerzo estimado si se aborda.

### Sección 6 — Coordinación de agentes paralelos

Dado que voy a correr 3 Claude Code en paralelo, proponé:
- Cómo dividir el trabajo en 3 tracks que no se pisen.
- Qué archivos/carpetas son "propiedad exclusiva" de cada track.
- Puntos de sincronización (momentos donde los 3 tracks tienen que 
  converger antes de seguir).
- Cómo manejar migraciones de Prisma (solo un track debería tocarlas).
- Orden correcto de mergeo al final de cada semana.

### Sección 7 — Decisiones pendientes que necesito tomar

Listá máximo 5 decisiones que necesitás que yo tome antes de 
ejecutar. No me hagas preguntas genéricas; solo las que tengan 
impacto real en el plan.

## Formato

Markdown completo, con headers claros. No resumas: quiero detalle 
accionable. Si algo no es suficientemente claro en el reporte para 
planificarlo bien, decime explícitamente qué más necesitás saber 
del código antes de planificar.

No propongas más de 20 cambios totales. Focus en impacto alto.
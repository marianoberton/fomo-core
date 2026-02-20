# Plan de Testing Manual Completo — Nexus Core Dashboard

## Contexto

Se completaron las 7 fases del sistema "Empleado Digital Dual". Este plan cubre **todos los tests manuales** necesarios para verificar que cada página, formulario, botón e interacción del dashboard funciona correctamente contra el backend real (Nexus Core en localhost:3002).

## Pre-requisitos

- Backend corriendo: `pnpm dev` en fomo-core (puerto 3002)
- Docker: PostgreSQL (5433) + Redis (6380) levantados
- DB seeded: `pnpm db:seed` (5 proyectos con datos)
- Dashboard corriendo: `pnpm dev` en fomo-core-dashboard (puerto 3000)
- API key válida configurada en `.env` del backend
- Al menos 1 proyecto con agente activo para tests de chat

---

## 1. LOGIN (`/login`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 1.1 | Login exitoso | Ingresar API key válida → Click "Sign In" | Redirige a `/`, toast de éxito, sidebar visible |
| 1.2 | Login fallido | Ingresar API key inválida → Click "Sign In" | Toast de error, queda en `/login` |
| 1.3 | Campo vacío | Dejar campo vacío → Click "Sign In" | Botón deshabilitado o toast de validación |
| 1.4 | Toggle visibilidad | Click icono ojo en campo API key | Alterna entre `password` y `text` type |
| 1.5 | Redirección sin auth | Ir a `/projects` sin estar logueado | Redirige a `/login` |
| 1.6 | Persistencia de sesión | Login → cerrar pestaña → reabrir dashboard | Sesión persiste (localStorage) |

---

## 2. DASHBOARD HOME (`/`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 2.1 | Carga de stats | Navegar a `/` | 4 stat cards con datos: Projects, Agents, Sessions, Cost Today |
| 2.2 | Approvals pendientes | Tener approvals pendientes en DB | Sección muestra hasta 5, con botones Approve/Deny |
| 2.3 | Aprobar desde dashboard | Click "Approve" en approval card | Toast éxito, card cambia estado a "approved" |
| 2.4 | Denegar desde dashboard | Click "Deny" en approval card | Toast éxito, card cambia estado a "denied" |
| 2.5 | Link "View All" approvals | Click "View All" en sección approvals | Navega a `/approvals` |
| 2.6 | Proyectos recientes | Tener proyectos en DB | Muestra hasta 5 project cards con nombre, descripción, status |
| 2.7 | Click en proyecto | Click en project card | Navega a `/projects/{id}` |
| 2.8 | Botón "New Project" | Click "New Project" | Navega a `/projects/new` |
| 2.9 | Loading state | Recargar página | Skeletons visibles durante carga |
| 2.10 | Empty state | Sin proyectos ni approvals | Mensajes de estado vacío con CTAs |

---

## 3. PROJECTS (`/projects`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 3.1 | Lista de proyectos | Navegar a `/projects` | Grid de project cards con nombre, descripción, status, agents count, budget |
| 3.2 | Búsqueda | Escribir en search bar | Filtra proyectos por nombre/descripción en tiempo real |
| 3.3 | Búsqueda sin resultados | Buscar texto que no existe | Grid vacío o mensaje "no results" |
| 3.4 | Click en proyecto | Click en card de proyecto | Navega a `/projects/{id}` |
| 3.5 | Loading state | Recargar página | Skeleton cards visibles |
| 3.6 | Empty state | Sin proyectos | Mensaje "Create your first project" con botón |

---

## 4. CREAR PROYECTO (`/projects/new`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 4.1 | Wizard — Step 1 | Llenar nombre, seleccionar industria y template | Botón "Next" habilitado |
| 4.2 | Validación Step 1 | Intentar avanzar sin nombre | Botón "Next" deshabilitado |
| 4.3 | Wizard — Step 2 | Llenar agent name, seleccionar estilo, role | Avanza a Step 3 |
| 4.4 | Wizard — Step 3 | Activar toggles de canales (WhatsApp, Telegram, Email) | Toggles cambian estado visual |
| 4.5 | Wizard — Step 4 | Configurar budgets y límites | Campos numéricos aceptan valores |
| 4.6 | Wizard — Step 5 Review | Verificar resumen | Muestra todos los datos ingresados en Steps 1-4 |
| 4.7 | Crear proyecto | Click "Create Project" en Step 5 | Loading en botón → toast éxito → redirige a `/projects/{newId}` |
| 4.8 | Error de creación | Backend apagado o error de red | Toast de error, permanece en wizard |
| 4.9 | Navegación backward | Click "Previous" en cualquier step | Vuelve al step anterior con datos preservados |
| 4.10 | Step indicator | Navegar entre steps | Indicador visual marca step actual |

---

## 5. DETALLE DE PROYECTO (`/projects/[projectId]`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 5.1 | Carga de datos | Navegar a proyecto existente | Nombre, descripción, status badge, quick stats (agents, sessions, costs) |
| 5.2 | Pausar proyecto | Click "Pause" | Status cambia a "paused", badge se actualiza |
| 5.3 | Reanudar proyecto | Click "Resume" en proyecto pausado | Status cambia a "active" |
| 5.4 | Sección Agents | Verificar grid de agents | Cards con nombre, status, descripción |
| 5.5 | Click "Add Agent" | Click botón | Navega a `/projects/{id}/agents/new` |
| 5.6 | Click "Configure" agent | Click en agent card | Navega a `/projects/{id}/agents/{agentId}` |
| 5.7 | Quick links grid | Verificar 11 cards de configuración | Click cada card navega a la sección correcta |
| 5.8 | Empty agents | Proyecto sin agentes | Empty state con "Create Agent" CTA |

---

## 6. CREAR AGENTE (`/projects/[projectId]/agents/new`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 6.1 | Campos básicos | Llenar nombre y descripción | Valores se actualizan |
| 6.2 | Selección de modelo | Cambiar provider → modelo se actualiza | Dropdown de modelos cambia según provider (OpenAI, Anthropic, Google, Ollama) |
| 6.3 | Temperature slider | Mover slider de 0 a 2 | Valor se refleja |
| 6.4 | Prompt config | Llenar Identity (requerido), Instructions, Safety | Textareas aceptan texto multilinea |
| 6.5 | Validación Identity | Intentar crear sin Identity | Toast "Identity prompt is required" |
| 6.6 | Validación nombre | Intentar crear sin nombre | Toast "Please enter an agent name" |
| 6.7 | Sección Tools | Expandir → marcar/desmarcar tools | Checkboxes togglean, muestra risk level badge |
| 6.8 | Sección MCP Servers | Add MCP Server → llenar campos | Nuevo server aparece, campos dinámicos según transport (stdio: command+args, sse: url) |
| 6.9 | Eliminar MCP Server | Click trash en un MCP server | Server se remueve de la lista |
| 6.10 | Dual Mode Preset | Click "Dual Mode Preset" | Se crean 2 modos (public + internal) con config predefinida, toast de confirmación |
| 6.11 | Agregar modo manual | Click "Add Mode" → llenar campos | Modo con nombre, label, channel mapping, tool allowlist, prompt override |
| 6.12 | Editar channel mapping | Escribir "whatsapp, telegram" | Se parsea a array separado por comas |
| 6.13 | Eliminar modo | Click trash en un modo | Modo se remueve |
| 6.14 | Límites | Configurar maxTurns, maxTokens, budget | Campos numéricos |
| 6.15 | Crear agente exitoso | Llenar datos mínimos → Click "Create Agent" | Toast éxito → redirige a `/projects/{id}/agents/{newAgentId}` |
| 6.16 | Error colisión canales | Crear agente con canal ya usado por otro agente | Toast con mensaje "Channel X is already claimed by agent Y" |
| 6.17 | Collapse/expand secciones | Click en header de sección colapsable | Alterna entre expandido y colapsado |

---

## 7. DETALLE DE AGENTE (`/projects/[projectId]/agents/[agentId]`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 7.1 | Carga de datos | Navegar a agente existente | Todos los campos pre-llenados con datos del agente |
| 7.2 | Editar nombre | Cambiar nombre → Save Changes | Toast "Agent updated", nombre actualizado en reload |
| 7.3 | Cambiar provider/modelo | Seleccionar nuevo provider → modelo | Dropdown de modelos se actualiza |
| 7.4 | Editar prompts | Modificar Identity/Instructions/Safety → Save | Cambios persistidos |
| 7.5 | Editar tools | Marcar/desmarcar tools → Save | Tool allowlist actualizada |
| 7.6 | Editar MCP Servers | Agregar/editar/eliminar → Save | Cambios persistidos |
| 7.7 | Editar Operating Modes | Agregar/editar/eliminar modos → Save | Modos actualizados |
| 7.8 | Error colisión canales | Asignar canal ya ocupado por otro agente → Save | Toast "Channel X is already claimed by agent Y" |
| 7.9 | Editar límites | Cambiar maxTurns/tokens/budget → Save | Valores actualizados |
| 7.10 | Pausar agente | Click "Pause" en header | Status cambia a "paused", badge se actualiza |
| 7.11 | Reanudar agente | Click "Resume" en header | Status cambia a "active" |
| 7.12 | Quick Actions — Test Chat | Click "Test Chat" | Navega a `/projects/{id}/agents/{agentId}/chat` |
| 7.13 | Quick Actions — View Logs | Click "View Logs" | Navega a `/projects/{id}/agents/{agentId}/logs` |
| 7.14 | Quick Actions — Edit Prompts | Click "Edit Prompts" | Navega a `/projects/{id}/prompts` |
| 7.15 | Agent Info card | Verificar card derecha | Muestra Agent ID (copiable), tool count, MCP count, mode count, fecha creación |

---

## 8. CHAT TEST (`/projects/[projectId]/agents/[agentId]/chat`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 8.1 | Conexión WebSocket | Navegar a chat con API key configurada | Indicador "connected" (punto verde) en stats bar |
| 8.2 | Crear sesión | Automático al conectar | Session ID aparece en stats bar |
| 8.3 | Enviar mensaje | Escribir texto → Enter o click Send | Mensaje user aparece a la derecha (violeta), agent responde a la izquierda |
| 8.4 | Streaming | Enviar mensaje | Dots animados mientras agent piensa → texto aparece progresivamente |
| 8.5 | Tool calls | Enviar mensaje que active un tool | ToolCallCard aparece: nombre, status (pending→success), input/output expandible |
| 8.6 | Tool call expandir | Click en ToolCallCard | Muestra JSON de input y output, duración |
| 8.7 | Tool call error | Tool que falla | ToolCallCard rojo con status "error" |
| 8.8 | Approval inline | Tool de alto riesgo que requiere aprobación | ApprovalCard con botones Approve/Deny |
| 8.9 | Aprobar inline | Click "Approve" en approval card | Ejecución continúa, status "approved" |
| 8.10 | Denegar inline | Click "Deny" en approval card | Agent notificado de denegación |
| 8.11 | Shift+Enter | Shift+Enter en input | Nueva línea (no envía) |
| 8.12 | Input deshabilitado | Durante streaming | Input y botón Send deshabilitados |
| 8.13 | Clear chat | Click "Clear" | Mensajes borrados, chat limpio |
| 8.14 | Stats bar | Durante conversación | Turns count se incrementa, Cost se actualiza |
| 8.15 | Auto-scroll | Enviar varios mensajes | Scroll automático al último mensaje |
| 8.16 | Empty state | Chat recién abierto | "Test your agent" message con ícono bot |
| 8.17 | sourceChannel | Verificar en backend logs | Mensajes WS incluyen `sourceChannel: "dashboard"` |
| 8.18 | Desconexión | Apagar backend | Indicador cambia a "disconnected" (punto gris), input deshabilitado |
| 8.19 | Reconexión | Encender backend de nuevo | Auto-reconexión, indicador vuelve a "connected" |

---

## 9. AGENT LOGS (`/projects/[projectId]/agents/[agentId]/logs`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 9.1 | Carga de eventos | Navegar a logs de agente con trazas | Timeline de eventos con íconos y colores |
| 9.2 | Filtro por tipo | Seleccionar "Tool Calls" en dropdown | Solo se muestran eventos de tool calls |
| 9.3 | Filtro "All Events" | Seleccionar "All Events" | Se muestran todos los tipos de eventos |
| 9.4 | Refresh | Click botón refresh | Lista se recarga, spinner visible durante fetch |
| 9.5 | Test Chat link | Click "Test Chat" | Navega a página de chat del agente |
| 9.6 | Empty state | Agente sin trazas | Mensaje "No events recorded" |
| 9.7 | Detalle de evento | Verificar event row | Ícono correcto por tipo, session ID badge, detalles contextuales, timestamp |

---

## 10. APPROVALS (`/approvals`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 10.1 | Lista de approvals | Navegar con approvals pendientes | Cards con tool ID, status badge, action preview, timestamps |
| 10.2 | Filtro Pending | Seleccionar "Pending" | Solo muestra approvals pendientes |
| 10.3 | Filtro Approved | Seleccionar "Approved" | Solo muestra aprobados, botones deshabilitados |
| 10.4 | Filtro Denied | Seleccionar "Denied" | Solo muestra denegados |
| 10.5 | Aprobar | Click "Approve" en approval pendiente | Toast éxito, card actualiza status |
| 10.6 | Denegar | Click "Deny" en approval pendiente | Toast éxito, card actualiza status |
| 10.7 | Refresh | Click botón refresh | Lista se recarga |
| 10.8 | Empty pending | Sin approvals pendientes | "All caught up!" message |
| 10.9 | Count display | Verificar header | Muestra número total de approvals en filtro actual |

---

## 11. TEMPLATES (`/templates`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 11.1 | Lista de templates | Navegar a `/templates` | Grid de template cards con nombre, descripción, tool count, layer count |
| 11.2 | Click "Use This Template" | Click en botón de template | Navega a `/projects/new?template={id}` |
| 11.3 | Loading state | Recargar | Skeleton cards visibles |
| 11.4 | Empty state | Sin templates en DB | "No templates available" |

---

## 12. SETTINGS (`/settings`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 12.1 | Info de API | Navegar a settings | Muestra API Base URL y WebSocket URL |
| 12.2 | Mock Data mode | Verificar toggle | Read-only, muestra estado actual |
| 12.3 | System info | Verificar sección | Version, Environment, Data Source |
| 12.4 | Sign Out | Click "Sign Out" | Limpia localStorage, redirige a `/login` |
| 12.5 | Post-logout | Intentar navegar a `/projects` | Redirige a `/login` |

---

## 13. PROMPTS (`/projects/[projectId]/prompts`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 13.1 | Tab Identity | Click tab Identity | Editor carga contenido de la versión activa de Identity |
| 13.2 | Tab Instructions | Click tab Instructions | Editor carga versión activa de Instructions |
| 13.3 | Tab Safety | Click tab Safety | Editor carga versión activa de Safety |
| 13.4 | Editar contenido | Modificar texto en Monaco editor | Badge "Unsaved changes" aparece |
| 13.5 | Guardar nueva versión | Llenar change reason → Click "Save as New Version" | Toast éxito, versión nueva aparece en historial con número incrementado |
| 13.6 | Version history | Verificar panel derecho | Lista de versiones con v#, badge "active", timestamp, change reason |
| 13.7 | Rollback | Click "Rollback" en versión anterior | Versión anterior se activa, badge "active" se mueve |
| 13.8 | Sin change reason | Guardar sin llenar change reason | Funciona (campo es opcional) |
| 13.9 | Versión activa badge | Verificar tab badge | Muestra número de versión activa (v1, v2, etc.) |

---

## 14. CHANNEL INTEGRATIONS (`/projects/[projectId]/integrations`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 14.1 | Agregar Telegram | Click "Add Channel" → seleccionar Telegram → llenar Bot Token Secret → Create | Integración aparece en lista con status active |
| 14.2 | Agregar WhatsApp | Seleccionar WhatsApp → llenar Access Token + Phone Number ID | Integración creada |
| 14.3 | Agregar Slack | Seleccionar Slack → llenar Bot Token Secret | Integración creada |
| 14.4 | Agregar Chatwoot | Seleccionar Chatwoot → llenar API URL + API Token secrets | Integración creada |
| 14.5 | Campos dinámicos | Cambiar provider en dialog | Campos del formulario cambian según provider |
| 14.6 | Copiar webhook URL | Click botón copy en integración | URL copiada al clipboard, feedback visual |
| 14.7 | Health check | Click botón refresh en integración | Spinner visible, resultado de health check |
| 14.8 | Eliminar integración | Click trash → confirmar | Integración eliminada, toast éxito |
| 14.9 | Empty state | Sin integraciones | Empty state con icono y CTA |
| 14.10 | Status indicator | Verificar dot de status | Verde para active, gris para inactive |

---

## 15. CONTACTS (`/projects/[projectId]/contacts`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 15.1 | Crear contacto | Click "Add Contact" → llenar nombre → Create | Contacto aparece en lista |
| 15.2 | Campos opcionales | Llenar email, phone, telegram ID, slack ID | Badges de canales visibles en la row |
| 15.3 | Metadata JSON | Ingresar JSON válido en metadata | Contacto creado con metadata |
| 15.4 | Metadata inválido | Ingresar JSON inválido | Error de validación |
| 15.5 | Set as Owner | Click icono shield en contacto | Badge "Owner" aparece (ámbar), toast "Contact set as owner" |
| 15.6 | Remove Owner | Click icono shield en contacto owner | Badge desaparece, toast "Owner role removed" |
| 15.7 | Eliminar contacto | Click trash → confirmar | Contacto eliminado |
| 15.8 | Channel badges | Contacto con telegram + email | Badges "Telegram" y "Email" visibles |
| 15.9 | Empty state | Sin contactos | "No contacts yet" con descripción |
| 15.10 | Loading state | Recargar | Skeleton rows visibles |

---

## 16. INBOX (`/projects/[projectId]/inbox`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 16.1 | Lista de sesiones | Navegar con sesiones activas | Panel izquierdo muestra lista con nombre contacto, canal, último mensaje, timestamp |
| 16.2 | Seleccionar sesión | Click en sesión | Panel derecho muestra thread completo de mensajes |
| 16.3 | Mensajes user/bot | Verificar thread | User messages izquierda (zinc), bot messages derecha (violet) |
| 16.4 | Buscar | Escribir en search | Filtra sesiones por contenido |
| 16.5 | Filtro por canal | Seleccionar "WhatsApp" | Solo sesiones de WhatsApp |
| 16.6 | Filtro por status | Seleccionar "Active" | Solo sesiones activas |
| 16.7 | Detalle de sesión | Verificar header de sesión seleccionada | Contact name, canal, phone, email, agent ID |
| 16.8 | Traces summary | Verificar en detalle de sesión | Token count, cost |
| 16.9 | Count total | Verificar footer | Número total de conversaciones |
| 16.10 | Empty inbox | Sin sesiones | "No conversations yet" message |
| 16.11 | No session selected | Navegar sin seleccionar | "Select a conversation to view" placeholder |

---

## 17. KNOWLEDGE (`/projects/[projectId]/knowledge`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 17.1 | Crear entrada | Click "Add Entry" → llenar contenido → Add | Entry card aparece en grid |
| 17.2 | Categoría default | Crear sin llenar categoría | Category badge muestra "general" |
| 17.3 | Categoría custom | Llenar categoría "pricing" | Badge muestra "pricing" |
| 17.4 | Importance levels | Crear entries con low/medium/high | Badges con colores correctos (green/amber/red) |
| 17.5 | Eliminar entrada | Click trash en entry | Entry eliminada, toast éxito |
| 17.6 | Contenido truncado | Crear entry con texto largo (>200 chars) | Card muestra solo primeros 200 chars |
| 17.7 | Empty state | Sin entries | "No knowledge entries" con CTA |

---

## 18. FILES (`/projects/[projectId]/files`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 18.1 | Upload file | Click "Upload File" → seleccionar archivo → Upload | File aparece en lista |
| 18.2 | Filename override | Llenar campo de filename override | Archivo guardado con nombre custom |
| 18.3 | Download file | Click botón download | Archivo se descarga / abre en nueva pestaña |
| 18.4 | Eliminar file | Click trash en archivo | Archivo eliminado |
| 18.5 | MIME type badges | Subir imagen, PDF, JSON | Badges con colores correctos (blue, red, green, amber) |
| 18.6 | File size display | Verificar lista | Tamaño del archivo formateado |
| 18.7 | Empty state | Sin archivos | Empty state con ícono upload |

---

## 19. CATALOG (`/projects/[projectId]/catalog`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 19.1 | Upload CSV | Seleccionar archivo CSV → Upload | Stats se actualizan: product count, category count |
| 19.2 | Upload Excel | Seleccionar archivo .xlsx → Upload | Stats se actualizan |
| 19.3 | Formato selector | Cambiar entre CSV y Excel | Dropdown funciona |
| 19.4 | Replace mode | Marcar checkbox "Replace" → upload | Catálogo anterior reemplazado |
| 19.5 | Append mode | Dejar checkbox sin marcar → upload | Productos nuevos se agregan |
| 19.6 | Stats display | Verificar stats cards | Total Products, Categories, Top 5 categories con counts |
| 19.7 | Clear catalog | Click "Clear Catalog" → confirmar en dialog | Catálogo vacío, stats en 0 |
| 19.8 | Danger zone visibility | Sin productos | Sección "Danger Zone" oculta |
| 19.9 | Danger zone con datos | Con productos | Sección "Danger Zone" visible |

---

## 20. WEBHOOKS (`/projects/[projectId]/webhooks`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 20.1 | Crear webhook | Click "Add Webhook" → llenar nombre + trigger prompt → Create | Webhook aparece en lista |
| 20.2 | Mustache template | Trigger prompt con `{{variable}}` | Se guarda correctamente |
| 20.3 | Secret opcional | Crear con y sin secret | Secret masked en display (últimos 4 chars) |
| 20.4 | IP Allowlist | Agregar IPs en formato CIDR | Se guardan correctamente |
| 20.5 | Toggle active/paused | Click switch en webhook | Status cambia, badge se actualiza |
| 20.6 | Copy webhook ID | Click botón copy | ID copiado al clipboard |
| 20.7 | Test webhook | Click Test → llenar JSON payload → Send | Resultado del test en UI o toast |
| 20.8 | Eliminar webhook | Click trash | Webhook eliminado |
| 20.9 | Empty state | Sin webhooks | Empty state con CTA |

---

## 21. MCP SERVERS (`/projects/[projectId]/mcp-servers`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 21.1 | Template catalog | Navegar a MCP Servers | Grid de template cards con nombre, descripción, categoría, transport |
| 21.2 | Filtro por categoría | Seleccionar "ERP" en dropdown | Solo templates de categoría ERP |
| 21.3 | Crear desde template | Click template → llenar campos → Create | Instance aparece en "My Servers" |
| 21.4 | Crear custom server | Click "Custom Server" → llenar campos → Create | Instance aparece con transport badge |
| 21.5 | Campos dinámicos transport | Seleccionar stdio vs sse en custom dialog | Campos cambian: stdio muestra command/args, sse muestra URL |
| 21.6 | Pausar instance | Click Pause en instance | Status cambia a "paused" |
| 21.7 | Reanudar instance | Click Resume en instance pausada | Status cambia a "active" |
| 21.8 | Eliminar instance | Click Delete → confirmar | Instance eliminada |
| 21.9 | Required secrets | Template con required secrets | Se muestra lista de secrets requeridos en dialog |
| 21.10 | Official badge | Templates oficiales | Badge "Official" visible |
| 21.11 | Empty My Servers | Sin instances | Empty state message |

---

## 22. TASKS (`/projects/[projectId]/tasks`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 22.1 | Crear task | Click "New Task" → llenar nombre, cron, prompt → Create | Task card aparece en grid |
| 22.2 | Cron expression | Ingresar `*/5 * * * *` (cada 5 min) | Se muestra next run time calculado |
| 22.3 | Aprobar task propuesto | Task con status "proposed" → Click "Approve" | Status cambia a "active" |
| 22.4 | Pausar task | Task activo → Click "Pause" | Status cambia a "paused" |
| 22.5 | Reanudar task | Task pausado → Click "Resume" | Status cambia a "active" |
| 22.6 | Run history | Seleccionar task con ejecuciones | Lista de últimas 5 ejecuciones con status, timestamp, duración |
| 22.7 | Status badges | Verificar badges de diferentes status | Colores correctos: active (green), proposed (amber), paused (gray) |
| 22.8 | Empty state | Sin tasks | Empty state con CTA |

---

## 23. TRACES (`/projects/[projectId]/traces`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 23.1 | Lista de sesiones | Navegar con sesiones existentes | Panel izquierdo con session IDs, status badges, timestamps |
| 23.2 | Seleccionar sesión | Click en session | Panel derecho muestra trace timeline |
| 23.3 | Trace summary | Verificar barra de resumen | Duration, tokens, cost, event count |
| 23.4 | Timeline de eventos | Verificar eventos | Íconos por tipo (LLM, tool, error), timestamps, contenido |
| 23.5 | Tipos de eventos | Verificar colores/iconos | llm_request, llm_response, tool_call, tool_result, error — cada uno con estilo propio |
| 23.6 | Clear selection | Click Clear | Vuelve a estado "Select a session" |
| 23.7 | Empty sessions | Sin sesiones | Empty state |
| 23.8 | Empty traces | Sesión sin trazas | "No execution traces" message |

---

## 24. COSTS (`/projects/[projectId]/costs`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 24.1 | Stat cards | Navegar a Costs | 4 cards: Cost Today, Cost Week, Sessions, Avg Cost/Session |
| 24.2 | Period selector | Cambiar entre 24h/7d/30d/90d | Datos se actualizan según período |
| 24.3 | Budget bars | Verificar barras de progreso | Daily + Monthly budget con porcentaje |
| 24.4 | Budget warning | Budget >80% consumido | Barra ámbar |
| 24.5 | Budget danger | Budget >100% consumido | Barra roja |
| 24.6 | Chart — Cost Over Time | Verificar gráfico de línea | 7 días de datos |
| 24.7 | Chart — Cost by Agent | Verificar barras horizontales | Agentes con sus costos |
| 24.8 | Usage table | Verificar tabla | Date, Agent, Sessions, Tokens In/Out, Cost |

---

## 25. SECRETS (`/projects/[projectId]/secrets`)

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 25.1 | Crear secret | Click "Add Secret" → llenar key + value → Add | Secret aparece en lista |
| 25.2 | Validación key format | Ingresar "invalid-key" (con guiones) | Error "Key must be uppercase..." |
| 25.3 | Key válido | Ingresar "MY_API_KEY" | Sin error, botón habilitado |
| 25.4 | Value oculto | Verificar después de crear | Value nunca se muestra post-creación |
| 25.5 | Editar descripción | Click pencil → cambiar descripción → Save | Descripción actualizada |
| 25.6 | Eliminar secret | Click trash → confirmar en dialog | Secret eliminado, warning visible sobre dependencias |
| 25.7 | Empty state | Sin secrets | Empty state con CTA |
| 25.8 | Encrypted badge | Verificar lista | Badge "Encrypted" visible |

---

## 26. SIDEBAR NAVIGATION

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 26.1 | Nav global | Verificar items: Dashboard, Projects, Templates, Approvals, Settings | Todos navegan correctamente |
| 26.2 | Nav proyecto | Entrar a un proyecto | Sub-nav completa: Overview, Agents, Inbox, Prompts, Knowledge, Contacts, Files, Catalog, Webhooks, Channels, MCP Servers, Tasks, Traces, Costs, Secrets |
| 26.3 | Active state | Verificar item activo | Item actual resaltado visualmente |
| 26.4 | Approvals badge | Tener approvals pendientes | Badge con count en item Approvals |
| 26.5 | Back to Projects | Click "Back to All Projects" | Navega a `/projects` |
| 26.6 | Responsive | Verificar en diferentes anchos | Sidebar se comporta correctamente |

---

## 27. FLUJOS END-TO-END CRITICOS

| # | Test | Pasos | Esperado |
|---|------|-------|----------|
| 27.1 | Crear proyecto + agente + chat | New Project wizard → Add Agent → Test Chat → Enviar mensaje | Flujo completo funcional, agente responde |
| 27.2 | Dual mode agent | Crear agente con Dual Mode Preset → verificar modos guardados → abrir chat (dashboard mode) | Chat funciona con sourceChannel "dashboard" |
| 27.3 | Owner workflow | Crear contacto → Set as Owner → verificar badge | Role persiste en refresh |
| 27.4 | Approval flow | Activar tool de alto riesgo en chat → Approve inline → verificar resultado | Tool ejecuta después de aprobación |
| 27.5 | Prompt versioning | Crear v2 de Identity → verificar en chat → Rollback a v1 | Agent usa versión correcta |
| 27.6 | Knowledge → Chat | Crear knowledge entry → preguntar al agente sobre ese tema | Agent usa conocimiento inyectado |
| 27.7 | File upload → Chat | Subir archivo → preguntar al agente sobre archivo | read-file tool accede al archivo |
| 27.8 | Secret → Integration | Crear secret → usar en integración de canal | Integración se conecta usando secret |
| 27.9 | Webhook trigger | Crear webhook → enviar POST al endpoint → verificar trace | Agent ejecuta con trigger prompt |
| 27.10 | MCP Server workflow | Crear MCP instance → asignar a agente → chat usa MCP tools | Tools del MCP server disponibles en chat |
| 27.11 | Scheduled task lifecycle | Crear task manual → ver ejecución → pausar → reanudar | Task corre según cron, se puede controlar |
| 27.12 | Catalog search | Subir catálogo CSV → preguntar al agente por producto | catalog-search tool encuentra productos |
| 27.13 | Inbox view | Crear sesión via chat → verificar en Inbox | Sesión aparece con mensajes completos |

---

## Verificacion Final

Después de ejecutar todos los tests:
- [ ] Todas las páginas cargan sin errores de consola
- [ ] Todos los formularios validan inputs correctamente
- [ ] Todos los CRUD operations persisten en el backend
- [ ] Todos los toast notifications se muestran apropiadamente
- [ ] Todos los loading states se ven durante fetches
- [ ] Todos los empty states se muestran cuando no hay datos
- [ ] La navegación entre páginas funciona sin broken links
- [ ] El WebSocket se conecta y reconecta correctamente
- [ ] Los datos se refrescan al volver a una página
- [ ] Sign out limpia la sesión completamente

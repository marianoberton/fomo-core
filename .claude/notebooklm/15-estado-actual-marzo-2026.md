# Estado Actual del Proyecto - Marzo 2026

## Estadisticas generales

- **0 errores TypeScript** (typecheck limpio)
- **1534+ tests unitarios** pasando
- **30 herramientas built-in** registradas
- **6 proyectos seeded** en la base de datos
- **5 verticales** configuradas
- **8 skill templates oficiales**
- **12 MCP templates** seeded

## Herramientas disponibles (30)

### Utilidades generales
1. calculator - operaciones matematicas
2. date-time - fechas, zonas horarias
3. json-transform - transformaciones JSON/JMESPath
4. http-request - llamadas HTTP externas (SecretService)
5. read-file - lectura de archivos del proyecto
6. web-search - busqueda web via API
7. scrape-webpage - scraping con Puppeteer (JS rendering, SSRF protection)

### Comunicacion
8. send-email - envio de emails via Resend API
9. send-notification - notificaciones internas
10. send-channel-message - envio por WhatsApp/Telegram/Slack
11. escalate-to-human - escalamiento HITL

### Conocimiento y memoria
12. knowledge-search - busqueda semantica en knowledge base (pgvector)
13. store-memory - persistir informacion en memoria del agente
14. search-project-memory - buscar en memoria del proyecto

### Sesiones e historial
15. query-sessions - buscar sesiones por filtros
16. read-session-history - leer historial de una sesion

### Scheduling
17. propose-scheduled-task - proponer tarea recurrente (requiere aprobacion)

### Catalogo y ordenes
18. catalog-search - buscar en catalogo de productos
19. catalog-order - crear orden de compra

### CRM
20. create-twenty-lead - crear lead en Twenty CRM (Company + Person + Opportunity)
21. contact-score - scoring automatico de contactos (5 presets)

### Campanas
22. trigger-campaign - disparar campana outbound desde un agente

### Manager / Orquestacion
23. delegate-to-agent - delegar tarea a sub-agente
24. list-project-agents - listar agentes del proyecto
25. get-operations-summary - resumen operativo
26. get-agent-performance - metricas de performance de un agente
27. review-agent-activity - revisar actividad reciente
28. control-agent - controlar (pausar/reanudar) un agente
29. export-conversations - exportar conversaciones
30. create-alert-rule - crear regla de alerta

### Verticales especializadas
- vehicle-lead-score - scoring de leads automotor
- vehicle-check-followup - seguimiento de vehiculos
- wholesale-update-stock - actualizar stock mayorista
- wholesale-order-history - historial de ordenes mayorista
- hotel-detect-language - deteccion de idioma hoteleria
- hotel-seasonal-pricing - precios estacionales hotel

## Sistema de campanas (completo)

- CRUD completo de campanas + ejecucion
- A/B testing con seleccion ponderada deterministica por contactId
- Chi-square test para determinar ganador con significancia estadistica (p < 0.05)
- Auto-select winner despues de N horas configurables
- Reply tracking: cuando un contacto responde, se marca el send como 'replied'
- Conversion tracking: agente marca conversion con nota
- Metricas agregadas: reply rate, conversion rate, avg response time, breakdown diario
- Status flow: queued -> sent -> replied -> converted (o failed)
- DB models: Campaign, CampaignSend (con variantId), CampaignReply

## FOMO Internal Agents

4 agentes internos de FOMO configurados en `src/agents/fomo-internal/agents.config.ts`:

### FAMA-Sales
- Agente de ventas inbound
- Califica leads, presenta servicios, agenda reuniones
- Canal: WhatsApp
- Tools: send-channel-message, create-twenty-lead, contact-score, trigger-campaign

### FAMA-Manager
- Orquestador principal
- Monitorea agentes, genera reportes, toma decisiones estrategicas
- Canal: Telegram
- Tools: delegate-to-agent, get-operations-summary, get-agent-performance, review-agent-activity

### FAMA-Ops
- Operaciones y automatizacion
- Follow-ups automaticos, reportes programados, alertas
- Tools: propose-scheduled-task, create-alert-rule, export-conversations

### FAMA-CS (Customer Service)
- Soporte al cliente de FOMO
- Responde consultas, resuelve problemas, escala si necesario
- Canal: WhatsApp + Web
- Tools: knowledge-search, escalate-to-human, send-email

## Integraciones externas

### Twenty CRM
- Self-hosted en VPS de FOMO
- Tool nativo: create-twenty-lead
- Crea Company + Person + Opportunity automaticamente
- Deduplica por nombre de empresa y email

### MCP Servers
- 12 templates seeded (HubSpot, FOMO Platform, etc.)
- CRUD API + dashboard UI para gestionar conexiones
- Auto-discovery de herramientas via protocolo MCP
- Soporte SSE y stdio transport

### Licitaciones (MCP externo)
- Python FastMCP server en VPS separado
- 6 herramientas: list_upcoming_tenders, get_tender_details, download_document, search_tenders, get_tender_from_catalog, get_process_lifecycle
- Jurisdicciones: CABA, Nacion, PBA
- Conecta via SSE

### OpenRouter
- Provider unificado para 300+ modelos (GPT-4o, Claude, Gemini, Llama, etc.)
- Cost monitoring automatico via openrouter.ai
- 16 modelos registrados directamente
- ModelRouter para routing inteligente por costo/capacidad

## Proximos pasos

1. Market Paper: configurar HubSpot token + WAHA outbound
2. Dashboard UX: wizard flows, catalogo visual MCP/tools
3. WAHA Docker bundled: auto-configuracion, scan QR
4. Prisma migrations pendientes en VPS
5. Agente de licitaciones: conectar MCP server, crear skill template, knowledge base con perfil de empresa
6. Agente web FOMO: chat widget + Twenty CRM lead capture

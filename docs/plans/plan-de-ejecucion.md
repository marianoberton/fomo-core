Decisiones tomadas, ejecutá con estas calibraciones:

TIMELINE: 4 semanas (no extender). Aceptamos riesgo de apretado.

DECISIONES D1-D5:
- D1: conversational | process | backoffice (default propuesto).
- D2: Opción B simplificada. Wizard en localStorage, crear agente 
  solo en submit final. SIN job nocturno de limpieza. SIN status 
  draft en schema.
- D3: RBAC aplazado a backlog. NO implementar ProjectMember ni 
  middleware requireProjectRole en este plan. Recuperar 18h del 
  Track A y redirigir a buffer + tests adicionales.
- D4: Opción B con TTL cache configurable. Default 24h. Configurable 
  por campaña. Documentar en el schema de AudienceSource.
- D5: Drop de operatingMode en la misma migración de A1. 
  Refactorizar los 8 archivos que lo referencian en el mismo PR. 
  Sin período deprecated.

GAPS IDENTIFICADOS:

Gap marketpaper-demo: sigue corriendo durante refactor. Reconfigurar 
marketpaper-demo para consumir el fomo-core actualizado con los 
nuevos cambios. Agregar smoke test de marketpaper-demo a cada sync 
point (S1, S2, S3, S4).

Gap agentes FAMA: los agentes FAMA son mock/nunca implementados en 
prod. Ignorar en migración. Los agentes reales en prod son otros 
(más viejos). Validar migración de `operatingMode` → `type` con esos 
agentes reales, no con FAMA.

Gap circuit breaker: agregar criterios de decisión a cada sync point 
según lista provista (ver más abajo).

CASO DE USO CLIENTE REACTIVACIÓN (input para UI audience + wizard):

Filtro HubSpot:
- Deals en un determinado pipeline (seleccionable).
- En una determinada stage de ese pipeline (seleccionable).
- Con última actividad superior a N días (configurable, default 30).

Mensaje: TBD. Estructura: calentar el lead, hacer preguntas iniciales, 
luego handoff a humano. La redacción exacta se define antes de 
semana 2. Agregar a plan: ventana de validación con cliente al 
inicio de semana 2, antes de ejecutar track C.

Métricas de éxito de campaña:
- Leads en "seguimiento" (en curso, agente respondió, esperando).
- Leads "perdidos" (no respondieron, opted out, cerrados).
- Leads "ganados" (convertidos, pasados a humano con éxito).
Esto va al componente `campaign-stats.tsx` del Track C.

CIRCUIT BREAKERS POR SYNC POINT:

S1 falla → rollback Prisma. Track A extiende 1 semana. Tracks B/C 
siguen con schema viejo adaptándose a merge posterior. Cliente 
reactivación se posterga 1 semana.

S2 falla → si backend: suspender Track C frontend hasta fix, 
extender semana 2 a 2.5. Si frontend: Track A sigue, Track C 
arregla UI en semana 3. Cliente se evalúa config manual por API.

S3 falla → no es breaker. Priorizar 3 problemas más graves, resto 
a backlog. NO retrasar por cosméticos.

S4 falla → extender 1 semana. Debugging priority 1. Resto del plan 
se considera completo.

SCOPE DE CARDUMEN:

Este plan NO incluye las capas conceptuales para Cardumen (Workers 
como primitivas, Case como entidad, Policies, Handoffs estructurados).
Dichas capas se especificarán en un ADR aparte ubicado en 
`docs/adr/002-cardumen-backend-extensions.md` al final del plan. 
El ADR documenta las entidades tentativas, modelos de datos, y 
endpoints que necesitará Cardumen cuando arranque su construcción 
(estimado: 40-60 horas adicionales post-Claude-Design de los 
primeros flujos Cardumen).

Agregar a Track C de Semana 4, entregable "Docs": redactar este ADR.

EJECUCIÓN:

Arrancar Track A (fomo-core backend) y Track B (dashboard limpieza) 
en paralelo desde lunes semana 1. Track C (AgentTemplate + 
Campaigns) arranca también semana 1 en la parte de backend, dashboard 
de templates/campaigns arranca semana 2.

Primer entregable para validar antes de proceder: migración Prisma 
A1 + AgentTemplate A2 aplicadas en dev, con smoke test manual 
(crear agente via API con nuevo enum, listar templates seed, validar 
marketpaper-demo sigue funcionando contra fomo-core).
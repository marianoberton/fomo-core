# Sistema de Campanas - A/B Testing + Tracking + Metricas

## Overview

El sistema de campanas de Nexus Core permite enviar mensajes outbound a audiencias filtradas, con soporte completo para A/B testing estadistico, tracking de respuestas, y metricas de conversion.

## Ubicacion de archivos

```
src/campaigns/
  types.ts           # Tipos: Campaign, CampaignSend, CampaignReply, CampaignMetrics, ABTestConfig
  campaign-runner.ts  # Ejecucion de campanas (envio masivo con variant selection)
  campaign-tracker.ts # Tracking de replies y conversiones
  ab-test-engine.ts   # Motor A/B: seleccion de variantes + chi-square winner
  index.ts            # Barrel exports
src/api/routes/campaigns.ts  # Endpoints REST
src/tools/definitions/trigger-campaign.ts  # Tool para que agentes disparen campanas
```

## Tipos principales

### Campaign
- `id`: CampaignId (branded type)
- `projectId`: ProjectId
- `name`, `status` (draft | active | paused | completed)
- `template`: Mustache-style ("Hola {{name}}, ...")
- `channel`: whatsapp | telegram | slack
- `audienceFilter`: { tags?: string[], role?: string }
- `abTest?`: ABTestConfig (configuracion de variantes)
- `scheduledFor?`, `completedAt?`, `metadata?`

### CampaignSend
- `id`: CampaignSendId
- `campaignId`, `contactId`
- `status`: queued | sent | failed | replied | converted
- `variantId?`: string (para A/B test sends)
- `sentAt?`, `error?`

### CampaignReply
- Registra cuando un contacto responde a un mensaje de campana
- `campaignSendId`, `contactId`, `sessionId`
- `repliedAt`, `messageCount` (mensajes intercambiados en la sesion)
- `converted`: boolean, `conversionNote?`

### CampaignMetrics
- Metricas agregadas: `totalSent`, `totalFailed`, `totalReplied`, `totalConverted`
- `replyRate`, `conversionRate` (0-1)
- `avgResponseTimeMs`: promedio de tiempo hasta primera respuesta
- `breakdown.byDay`: array de { date, sent, replied, converted }

## A/B Testing

### Configuracion
```typescript
interface ABTestConfig {
  enabled: boolean;
  variants: CampaignVariant[];  // cada una con id, name, template, weight, isControl
  autoSelectWinnerAfterHours?: number;
  winnerMetric: 'reply_rate' | 'conversion_rate';
}
```

### Seleccion de variantes
- `selectVariant(variants, seed)`: seleccion ponderada deterministica
- Usa hash del contactId como seed -> mismo contacto siempre recibe misma variante
- Los weights deben sumar 100

### Calculo de ganador (Chi-Square)
- Test chi-cuadrado 2x2 para comparar reply rates entre variantes
- Umbrales hardcodeados (df=1):
  - chi2 > 6.63 -> p < 0.01 -> confidence = 0.99
  - chi2 > 3.84 -> p < 0.05 -> confidence = 0.95
  - else -> no hay ganador significativo
- `calculateWinner(variantMetrics)`: retorna { winner: variantId | null, confidence }
- `checkAndSelectWinner(prisma, campaign)`: persiste ganador en metadata si hay significancia

### Auto-select
- Si `autoSelectWinnerAfterHours` esta configurado, despues de N horas se calcula automaticamente
- Se persiste el ganador en `campaign.metadata.abTest.winner`

## Reply Tracking

### markCampaignReply(prisma, campaignId, contactId, sessionId, options?)
1. Busca el CampaignSend mas reciente con status 'sent' para ese campaignId + contactId
2. Actualiza status a 'replied' (transaccion)
3. Crea registro CampaignReply
4. Retorna { campaignSend, reply } o null si no hay send elegible

### markConversion(prisma, campaignSendId, note?)
1. Busca el CampaignSend + su reply
2. Actualiza status a 'converted' (transaccion)
3. Marca reply.converted = true, agrega conversionNote
4. Retorna boolean

## Metricas

### getCampaignMetrics(prisma, campaignId)
- Carga todos los CampaignSend con sus CampaignReply (JOIN)
- Calcula totales (sent, failed, replied, converted) en un solo pass
- Calcula response time promedio (sentAt -> repliedAt)
- Genera breakdown diario

### getVariantMetrics(prisma, campaignId)
- Agrupa CampaignSend por variantId
- Calcula reply rate por variante
- Inicializa desde la config de variantes del campaign.metadata.abTest

## API Endpoints

- `POST /api/v1/campaigns` - crear campana
- `GET /api/v1/campaigns` - listar campanas del proyecto
- `GET /api/v1/campaigns/:id` - detalle
- `POST /api/v1/campaigns/:id/execute` - ejecutar envio
- `GET /api/v1/campaigns/:id/ab-results` - metricas A/B por variante + winner
- `GET /api/v1/campaigns/:id/metrics` - metricas de reply/conversion

## Modelo de datos (Prisma)

```prisma
model CampaignSend {
  id         String   @id @default(cuid())
  campaignId String
  contactId  String
  status     String   @default("queued")  // queued | sent | failed | replied | converted
  variantId  String?                       // para A/B testing
  error      String?
  sentAt     DateTime?
  createdAt  DateTime @default(now())
  campaign   Campaign @relation(...)
  contact    Contact  @relation(...)
  reply      CampaignReply?
}

model CampaignReply {
  id             String   @id @default(cuid())
  campaignSendId String   @unique
  contactId      String
  sessionId      String
  repliedAt      DateTime
  messageCount   Int      @default(1)
  converted      Boolean  @default(false)
  conversionNote String?
  campaignSend   CampaignSend @relation(...)
}
```

## Flujo tipico de una campana

1. **Crear campana** (draft) con template, audienceFilter, channel, opcionalmente abTest
2. **Activar** (status -> active)
3. **Ejecutar** -> campaign-runner selecciona contactos, aplica variante A/B, envia por canal
4. **Tracking** -> cuando un contacto responde, markCampaignReply actualiza el send
5. **Conversion** -> agente marca conversion via markConversion
6. **Metricas** -> getCampaignMetrics y getVariantMetrics para dashboards
7. **A/B Winner** -> si autoSelect configurado, se calcula ganador automaticamente

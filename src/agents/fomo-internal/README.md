# FOMO Internal Agents

Los 4 agentes que usa FOMO como empresa para operar.

## Arquitectura

```
Lead inbound (WhatsApp/Telegram)
        ↓
  FAMA-Sales          → Califica leads, agenda demos
        ↓ (lead calificado)
  notifica a Mariano/Guille

  FAMA-Manager        → Chief of Staff en dashboard
  (copilot)             Pipeline, performance, briefings
        ↓ (delega)
  FAMA-Ops            → Background: follow-ups, reportes, alertas
  (internal)

  FAMA-CS             → Onboarding y soporte de clientes activos
  (customer-facing)
```

## Los 4 agentes

| Agente | Modo | Canal | Modelo | Función |
|--------|------|-------|--------|---------|
| **FAMA-Sales** | customer-facing | WhatsApp + Telegram | Haiku | Califica leads inbound, agenda demos |
| **FAMA-Manager** | manager/copilot | Dashboard + Telegram | Sonnet | Chief of Staff, visibilidad del negocio |
| **FAMA-Ops** | internal | background | Haiku | Follow-ups, reportes, monitor de errores |
| **FAMA-CS** | customer-facing | WhatsApp + Dashboard | Haiku | Onboarding y soporte de clientes |

## Setup inicial

```bash
# 1. Con fomo-core corriendo en localhost:3002
npx tsx src/agents/fomo-internal/seed.ts

# 2. Con API key
FOMO_API_KEY=tu-key FOMO_API_URL=https://core.fomo.com.ar npx tsx src/agents/fomo-internal/seed.ts
```

## Post-setup (manual)

1. **FAMA-Sales**: Conectar número de WhatsApp Business de FOMO en el dashboard → Channels
2. **FAMA-Manager**: Conectar Telegram bot para acceso mobile de Mariano/Guille  
3. **FAMA-Ops**: Configurar schedules desde el dashboard → el agente corre noche (follow-ups) y mañana (reportes)
4. **FAMA-CS**: Cargar knowledge base con docs de FOMO (preguntas frecuentes, guía de onboarding, manual del dashboard)

## ICP para FAMA-Sales

Cliente ideal de FOMO:
- Ya decidió implementar IA (no hay que convencerlo)
- Se trabó en lo técnico o no sabe por dónde empezar  
- PyME 5-50 empleados, servicios/retail/distribución
- Budget $300-1500 USD/mes

No ICP: quieren solo FAQ bot, empresa <5 empleados sin budget, quieren construir in-house.

## Costos estimados/día

| Agente | USD/día (estimado) |
|--------|--------------------|
| FAMA-Sales | $2-5 |
| FAMA-Manager | $5-15 |
| FAMA-Ops | $2-5 |
| FAMA-CS | $2-5 |
| **Total** | **$11-30/día** |

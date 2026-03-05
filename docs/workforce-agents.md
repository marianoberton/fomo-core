# FOMO Workforce — Agentes de Producción

Proyecto creado en producción: **FOMO Workforce** (`4SqKBrE3GDwfCRsdxVmYC`)

## Agentes Creados

| Agente | ID | Provider | Modelo | Canales |
|--------|-----|---------|--------|---------|
| Elena (Atención al Cliente) | `cmmcvw12o0001ns016abtbzzs` | openai | gpt-4o | web, whatsapp |
| Diego (Ventas Outbound) | `cmmcvw1hv0003ns01lde6y8yb` | openai | gpt-4o | email, whatsapp |
| Marcos (Análisis de Datos) | `cmmcvw1xc0005ns01b1khh2h9` | anthropic | claude-sonnet-4-5 | whatsapp |
| Lucas (Cobranzas) | `cmmcvw2k50007ns01bgpcsz9j` | openai | gpt-4o | whatsapp |
| Valentina (Licitaciones) | `cmmcvw36c0009ns01x5g86brc` | anthropic | claude-sonnet-4-5 | whatsapp |
| Sofía (RRHH) | `cmmcvw3on000bns01agupykiw` | openai | gpt-4o | whatsapp |
| El Gerente | `cmmcvw4ad000dns01khy35ed5` | anthropic | claude-sonnet-4-5 | whatsapp |
| Agente Concesionaria (Template) | `cmmcvw4ue000fns01mbs9tptb` | openai | gpt-4o | whatsapp |
| Agente Mayorista/Ferretería (Template) | `cmmcvw5hh000hns01uk3gibc6` | openai | gpt-4o | whatsapp |
| Agente Hotelero (Template) | `cmmcvw5wk000jns01x18g71gb` | openai | gpt-4o | whatsapp |

## Estado de Providers

El soporte para Google Gemini ya estaba implementado en fomo-core:
- `src/providers/google.ts` — implementación completa del provider Gemini
- `src/providers/factory.ts` — registrado como `google` con `GOOGLE_AI_API_KEY`
- `src/providers/models.ts` — modelos Gemini 1.5, 2.0, 2.5 definidos
- Dashboard UI — selector ya incluye Google/Gemini en `new/page.tsx` y `[agentId]/page.tsx`

Solo falta configurar la env var `GOOGLE_AI_API_KEY` en producción para activar los modelos Gemini.

## Knowledge Base

Se cargaron 9 entradas en el proyecto Workforce con información sobre:
- Identidad y propuesta de valor de FOMO
- Planes y precios
- Canales y verticales
- El equipo de agentes Workforce
- FAQ, instrucciones de derivación, restricciones de seguridad
- Información del equipo FOMO

## Pendientes

1. **Conectar canales reales**: Los agentes necesitan ser conectados a números de WhatsApp, inboxes, etc.
2. **Configurar `GOOGLE_AI_API_KEY`** en el servidor de producción para habilitar Gemini.
3. **Asignar El Gerente como manager** de los otros agentes (campo `managerAgentId`) cuando la funcionalidad esté disponible en la UI.
4. **Knowledge base específica por agente**: Actualmente el KB es del proyecto. Evaluar si conviene knowledge específica por rol (ej. Valentina con info de licitaciones).
5. **Templates de concesionaria/mayorista/hotelero**: Duplicar y personalizar para cada cliente que lo necesite.
6. **Channels de Elena**: Conectar canal web (widget) al agente.
7. **Revisión con Mariano**: Confirmar prompts, límites de budget y comportamiento esperado antes de activar en producción real.

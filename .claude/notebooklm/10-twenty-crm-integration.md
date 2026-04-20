# Twenty CRM Integration Tool

## Overview

`create-twenty-lead` es una herramienta nativa de Nexus Core que crea leads directamente en una instancia self-hosted de Twenty CRM (open source CRM deployado en el VPS de FOMO).

## Ubicacion

- Tool: `src/tools/definitions/create-twenty-lead.ts`
- Tests: `src/tools/definitions/create-twenty-lead.test.ts` (18 tests)
- Registrado en: `src/tools/definitions/index.ts`

## Configuracion requerida

| Item | Donde se configura |
|------|-------------------|
| `TWENTY_API_KEY` | SecretService del proyecto (Settings > Secrets) |
| `twentyBaseUrl` | Parametro del factory al registrar el tool |

La API key NUNCA se pasa al LLM ni se hardcodea. Se obtiene de SecretService en runtime.

## Flujo de ejecucion

1. **Buscar empresa por nombre** (case-insensitive, like `%nombre%`) -> evitar duplicados
2. Si no existe -> **Crear Company** en Twenty
3. **Buscar contacto por email** -> evitar duplicados
4. Si no existe -> **Crear Person** vinculada a la Company
5. **Crear Opportunity** siempre nueva, en stage "NEW", vinculada a Person y Company
6. Retornar IDs creados/encontrados + URL directa al CRM

## Schema de entrada (Zod)

```
firstName: string (requerido, 1-100 chars)
lastName: string (opcional, default '')
email: string email (opcional)
phone: string (opcional, max 50)
company: string (requerido, 1-200 chars)
source: enum ['web', 'whatsapp', 'telegram', 'referral', 'email', 'cold_outreach', 'other'] (default 'web')
notes: string (opcional, max 2000)
opportunityName: string (opcional, max 200) -> si no se provee se usa "[empresa] - [fecha]"
```

## Output de ejecucion

```json
{
  "opportunityId": "uuid",
  "companyId": "uuid",
  "personId": "uuid",
  "companyCreated": true,
  "personCreated": true,
  "opportunityName": "Acme SA - 2026-03-04",
  "crmUrl": "https://crm.fomo.com.ar/crm/opportunities/uuid"
}
```

## API de Twenty CRM

El tool usa la REST API de Twenty (`/rest/` prefix):

- `GET /rest/companies?filter=...&limit=1` - buscar empresa
- `POST /rest/companies` - crear empresa
- `GET /rest/people?filter=...&limit=1` - buscar persona por email
- `POST /rest/people` - crear persona (con name, emails, phones, companyId)
- `POST /rest/opportunities` - crear oportunidad (con stage, companyId, pointOfContactId)

Headers: `Authorization: Bearer <TWENTY_API_KEY>`, `Content-Type: application/json`

## Propiedades del Tool

- **Category**: crm
- **Risk Level**: medium
- **Side Effects**: true (crea registros en CRM externo)
- **Supports Dry Run**: true (retorna lo que crearia sin ejecutar)
- **Requires Approval**: false

## Casos de uso

### Agente de atencion al cliente web
Un agente en el chat web de FOMO captura datos del visitante durante la conversacion y usa `create-twenty-lead` para registrar el lead automaticamente en el CRM.

### Agente de ventas WhatsApp
Cuando un contacto muestra interes en un producto/servicio, el agente usa el tool para crear la oportunidad con las notas de calificacion.

### Campanas outbound
Despues de una campana exitosa, el agente puede crear leads en el CRM para los contactos que respondieron positivamente.

## Integracion con Twenty

Twenty CRM es un CRM open-source que FOMO tiene deployado en su VPS. Ventajas:
- Self-hosted: datos en infraestructura propia
- REST API completa
- Modelo de datos flexible (Company, Person, Opportunity)
- UI web para el equipo comercial
- Sin costos de licencia

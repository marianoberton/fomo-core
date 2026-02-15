# Vehicle Sales Vertical

Features for automotive sales, dealerships, and vehicle marketplaces.

## Features

### 1. Lead Scoring

Automatically calculate lead quality scores based on:
- **Budget** (40% weight) - Higher budgets = higher scores
- **Urgency** (40% weight) - Immediate buyers > Browsers
- **Vehicle Type** (15% weight) - Preference signals
- **Bonus factors** (5% weight) - Trade-in, cash buyers

#### Lead Tiers
- **🔥 URGENT** (75-100): Contact immediately (within 1 hour)
- **🌡️ HOT** (55-74): Contact within 4 hours
- **📈 WARM** (35-54): Contact within 24 hours
- **❄️ COLD** (0-34): Add to nurture sequence

#### Usage

```typescript
import { calculateLeadScore } from './lead-scoring.js';

const score = calculateLeadScore({
  urgency: 'urgent',
  budgetRange: 'premium',
  vehicleType: 'sports',
  hasTradeIn: true,
  financingNeeded: false, // Cash buyer bonus
});

console.log(score.tier); // 'urgent'
console.log(score.score); // 95
console.log(score.suggestedActions);
// ['Contact immediately (within 1 hour)', ...]
```

#### Tool: `vehicle-lead-score`

```json
{
  "tool": "vehicle-lead-score",
  "input": {
    "contactId": "contact-123",
    "urgency": "ready",
    "budgetRange": "high",
    "vehicleType": "suv",
    "hasTradeIn": true
  }
}
```

Returns:
```json
{
  "success": true,
  "score": 68,
  "tier": "hot",
  "reasoning": "Lead score: 68/100 (HOT). Ready to purchase soon. High budget range. Has trade-in vehicle.",
  "suggestedActions": [
    "Contact within 4 hours",
    "Send vehicle options matching criteria",
    "Offer test drive",
    "Follow up in 24 hours if no response"
  ]
}
```

### 2. Automated Follow-up

Smart follow-up scheduling based on lead tier and last interaction:

| Tier | 1st Follow-up | 2nd Follow-up | 3rd Follow-up | Max Time |
|------|---------------|---------------|---------------|----------|
| Urgent | 6 hours | 12 hours | 24 hours | 48 hours |
| Hot | 24 hours | 48 hours | 96 hours | 1 week |
| Warm | 48 hours | 5 days | 7 days | 2 weeks |
| Cold | 7 days | 14 days | 21 days | 30 days |

#### Usage

```typescript
import { calculateFollowUp } from './follow-up.js';

const schedule = calculateFollowUp({
  tier: 'hot',
  lastInteractionAt: '2025-01-10T10:00:00Z',
  followUpCount: 0,
});

console.log(schedule.shouldFollowUp); // true/false
console.log(schedule.suggestedMessage);
// "Hola! ¿Cómo va todo? Quería saber si seguís interesado/a..."
```

#### Tool: `vehicle-check-followup`

```json
{
  "tool": "vehicle-check-followup",
  "input": {
    "contactId": "contact-123",
    "updateMetadata": true
  }
}
```

### 3. Daily Reports

Generate summary reports for sales team:

```typescript
import { generateDailyReport } from './daily-report.js';

const leads = [
  // Array of LeadSummary objects
];

const report = generateDailyReport(leads);

console.log(report.summary);
// Multi-line text report with stats and action items
```

Output example:
```
📊 REPORTE DIARIO - 2025-01-15

Total de leads: 42
Leads nuevos (últimas 24hs): 8
Score promedio: 52/100

Distribución por nivel:
🔥 URGENTES: 3
🌡️  HOT: 12
📈 WARM: 20
❄️  COLD: 7

⚡ LEADS URGENTES (requieren atención inmediata):
  - Juan Pérez (95/100) - última interacción: hace 8h
  - María González (88/100) - última interacción: hace 12h
  ...
```

## Scheduled Tasks

Create a daily report task:

```json
{
  "tool": "propose-scheduled-task",
  "input": {
    "name": "Daily Vehicle Leads Report",
    "cronExpression": "0 9 * * *",
    "taskPayload": {
      "action": "generate_vehicle_report",
      "sendTo": "sales@example.com"
    }
  }
}
```

## Contact Metadata Structure

```typescript
{
  "vertical": "vehicles",
  "leadData": {
    "urgency": "urgent",
    "budgetRange": "premium",
    "vehicleType": "sports",
    "hasTradeIn": true,
    "financingNeeded": false
  },
  "leadScore": {
    "score": 95,
    "tier": "urgent",
    "lastCalculated": "2025-01-15T10:30:00Z",
    "factors": {
      "budget": 38,
      "urgency": 36,
      "vehicleType": 14,
      "bonus": 5
    },
    "followUpCount": 1,
    "lastFollowUpAt": "2025-01-15T11:00:00Z"
  },
  "lastInteraction": "2025-01-15T10:00:00Z"
}
```

## Integration with ProactiveMessenger

For automated follow-ups via WhatsApp/Telegram:

```typescript
// In a scheduled task or webhook
const followUp = await vehicleCheckFollowupTool.execute({
  contactId: 'contact-123',
  updateMetadata: true,
}, context);

if (followUp.shouldFollowUp) {
  // Use ProactiveMessenger or send-notification tool
  await sendNotification({
    contactId: 'contact-123',
    message: followUp.suggestedMessage,
    channel: 'whatsapp',
  });
}
```

## Best Practices

1. **Run lead scoring on every significant interaction** - Budget mention, vehicle preference, etc.
2. **Schedule daily follow-up checks** - Use cron task to check all active leads
3. **Update lead data incrementally** - Re-run scoring when new info is collected
4. **Monitor conversion rates by tier** - Track which tiers convert best
5. **Customize follow-up messages** - The suggested messages are templates, personalize them

## Testing

```bash
pnpm test src/verticals/vehicles
```

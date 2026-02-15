# Vertical Templates

Pre-configured agent setups for common business verticals. These templates include:

- **Identity layer**: Who the agent is (personality, tone, language)
- **Instructions layer**: Business rules, workflows, what to do
- **Safety layer**: Boundaries, constraints, what NOT to do
- **Agent config**: Allowed tools, memory settings, cost limits
- **Sample data**: Example catalog data for testing

## Available Templates

### 🚗 Car Dealership (`car-dealership`)

**Use case:** Auto dealerships (concesionarias de vehículos)

**What it does:**
- Search vehicle catalog
- Qualify leads
- Schedule test drives and visits
- Capture customer data for sales follow-up

**Tools:** `catalog-search`, `send-notification`, `propose-scheduled-task`, `date-time`

**Workflow:**
1. Ask about vehicle preferences
2. Search catalog and present options
3. Discuss financing/trade-ins (capture data only, no commitments)
4. Schedule visit or test drive
5. Notify sales team of qualified leads

**Sample data:** 4 vehicles (sedan, SUV, pickup) with specs and pricing

---

### 🔧 Wholesale/Hardware Store (`wholesale-hardware`)

**Use case:** Mayoristas y ferreterías

**What it does:**
- Search product catalog
- Suggest complementary products
- Take draft orders
- Calculate material quantities

**Tools:** `catalog-search`, `catalog-order`, `send-notification`, `calculator`, `date-time`

**Workflow:**
1. Identify customer needs
2. Search catalog for products
3. Suggest complementary items
4. Calculate quantities (paint coverage, cable length, etc)
5. Create draft order for approval

**Sample data:** 6 products (construction materials, paint, tools, electrical, hardware, tiles)

---

### 🏨 Boutique Hotel (`boutique-hotel`)

**Use case:** Small hotels and accommodations

**What it does:**
- Information about rooms and services
- Local recommendations (restaurants, attractions)
- Capture reservation data
- Manage guest requests during stay

**Tools:** `catalog-search`, `send-notification`, `date-time`, `http-request`

**Workflow:**
1. Greet and identify guest type (current/future/inquiry)
2. Show available rooms with upgrade suggestions
3. Provide local recommendations
4. Capture reservation data (not confirm)
5. Assist during stay (room service, late checkout, etc)

**Sample data:** 3 room types + 3 services (transfer, late checkout, breakfast)

---

## Usage

### Via API

#### 1. List available templates

```bash
GET /templates
```

Response:
```json
{
  "templates": [
    {
      "id": "car-dealership",
      "name": "Concesionaria de Vehículos",
      "description": "..."
    },
    // ...
  ]
}
```

#### 2. Get template details

```bash
GET /templates/{templateId}
```

#### 3. Create project from template

```bash
POST /templates/{templateId}/create-project
Content-Type: application/json

{
  "projectName": "Mi Concesionaria ABC",
  "projectDescription": "Asistente virtual para concesionaria",
  "environment": "production",
  "owner": "admin@myconcesionaria.com",
  "tags": ["argentina", "automotor"],
  "provider": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "temperature": 0.7,
    "apiKeyEnvVar": "ANTHROPIC_API_KEY"
  },
  "includeSampleData": true
}
```

Response:
```json
{
  "projectId": "abc123xyz",
  "message": "Project created successfully from template car-dealership",
  "sampleData": {
    "catalog": [...]
  }
}
```

#### 4. Update existing project prompts from template

```bash
POST /projects/{projectId}/update-prompts-from-template
Content-Type: application/json

{
  "templateId": "car-dealership",
  "updatedBy": "admin@example.com"
}
```

This creates new versions of all 3 prompt layers (identity, instructions, safety) and activates them, while keeping old versions for rollback.

---

### Via Code

```typescript
import { TemplateManager } from '@/templates';
import { prisma } from '@/infrastructure/prisma';

const templateManager = new TemplateManager(prisma);

// List templates
const templates = templateManager.listTemplates();

// Create project
const result = await templateManager.createProjectFromTemplate({
  templateId: 'car-dealership',
  projectName: 'Mi Concesionaria',
  environment: 'production',
  owner: 'admin@example.com',
  provider: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
  },
  includeSampleData: true,
});

console.log(result.projectId);
console.log(result.sampleData);
```

---

## Adding a New Template

1. **Create template file:** `src/templates/my-vertical.ts`

```typescript
import type { PromptLayer } from '@/prompts/types.js';
import type { AgentConfig } from '@/core/types.js';

export const myVerticalIdentity: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'identity',
  content: `...`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const myVerticalInstructions: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'instructions',
  content: `...`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const myVerticalSafety: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'safety',
  content: `...`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const myVerticalConfig: Partial<AgentConfig> = {
  agentRole: 'my-vertical-assistant',
  allowedTools: ['catalog-search', 'send-notification'],
  // ... memory, cost config
};

export const myVerticalSampleData = {
  catalog: [
    // ... sample items
  ],
};
```

2. **Register in template manager:** Add to `VERTICAL_TEMPLATES` object in `template-manager.ts`

3. **Export from index:** Add export to `src/templates/index.ts`

4. **Test:** Create a project via API and verify all layers are created

---

## Customization

After creating a project from a template, you can:

1. **Edit prompt layers** via API: `POST /prompt-layers` (creates new version)
2. **Modify agent config** via API: `PATCH /projects/{projectId}`
3. **Add/remove tools** in the project's `agentConfig.allowedTools`
4. **Adjust budgets** in `agentConfig.costConfig`

Templates are just starting points — customize freely for your specific use case.

---

## Deployment Time Comparison

**Before templates (manual setup):**
- Write prompts: 2-4 hours
- Configure tools: 1-2 hours
- Test and iterate: 4-8 hours
- **Total: 1-2 days**

**With templates:**
- Select template: 2 minutes
- Create project via API: 30 seconds
- Customize (optional): 1-2 hours
- **Total: 1-2 hours**

**Time saved: 80-90%**

---

## Future Templates

Planned templates for future releases:

- 📦 E-commerce / Retail
- 🏥 Medical Clinic
- 🍕 Restaurant / Food Delivery
- 🏋️ Gym / Fitness Center
- 🏢 Real Estate
- 📚 Educational Institution
- 💼 Professional Services (accounting, legal, consulting)

Want to contribute a template? See `CONTRIBUTING.md`

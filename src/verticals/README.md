# Vertical-Specific Features

This directory contains business logic and tools specific to different industry verticals.
Each vertical has its own subdirectory with services, tools, and tests.

## Available Verticals

### 🚗 Vehicles (`vehicles/`)
Features for vehicle sales and dealerships:
- **Lead Scoring**: Automatically score leads based on budget, urgency, and preferences
- **Follow-up Management**: Automated follow-up scheduling based on lead tier
- **Daily Reports**: Summary reports of leads, follow-ups, and action items

**Tools:**
- `vehicle-lead-score` - Calculate and store lead quality score
- `vehicle-check-followup` - Determine if follow-up is needed

### 📦 Wholesale (`wholesale/`)
Features for wholesale/distributor businesses:
- **Stock Management**: CSV-based inventory updates
- **Order History**: Track customer purchase patterns
- **Tiered Pricing**: Differentiated pricing based on customer tier (Bronze/Silver/Gold/Platinum)

**Tools:**
- `wholesale-update-stock` - Update inventory from CSV
- `wholesale-order-history` - Retrieve customer order history and analytics

### 🏨 Hotels (`hotels/`)
Features for hotels and hospitality:
- **Seasonal Pricing**: Dynamic room rates based on high/medium/low season
- **Multi-Language**: Auto-detect and maintain consistent language per guest

**Tools:**
- `hotel-detect-language` - Auto-detect customer language (ES/EN/PT/FR/DE/IT)
- `hotel-seasonal-pricing` - Calculate room prices by season

## Architecture

Each vertical follows a consistent structure:

```
verticals/
├── vehicles/
│   ├── lead-scoring.ts           # Service logic
│   ├── lead-scoring.test.ts      # Unit tests
│   ├── follow-up.ts
│   ├── follow-up.test.ts
│   └── README.md                  # Vertical-specific docs
├── wholesale/
│   ├── stock-manager.ts
│   ├── order-history.ts
│   ├── pricing-tiers.ts
│   └── ...
└── hotels/
    ├── seasonal-pricing.ts
    ├── multi-language.ts
    └── ...
```

## Adding a New Vertical

1. Create a new subdirectory under `verticals/`
2. Implement service logic (business rules, calculations)
3. Create corresponding tools in `src/tools/definitions/`
4. Export tools in `src/tools/definitions/index.ts`
5. Write unit tests for services and tools
6. Document usage in vertical's README.md

## Contact Metadata

Vertical-specific data is stored in `Contact.metadata` as JSON:

```typescript
// Vehicle lead metadata
{
  "vertical": "vehicles",
  "leadData": { ... },
  "leadScore": {
    "score": 75,
    "tier": "hot",
    "lastCalculated": "2025-01-15T10:00:00Z"
  }
}

// Wholesale customer metadata
{
  "vertical": "wholesale",
  "pricing": {
    "tier": "gold",
    "discount": 30,
    "totalSpent": 350000
  },
  "orders": [ ... ]
}

// Hotel guest metadata
{
  "vertical": "hotels",
  "language": {
    "preferred": "en",
    "confidence": "high"
  },
  "reservation": { ... }
}
```

## Testing

Run tests for all verticals:
```bash
pnpm test src/verticals
```

Run tests for specific vertical:
```bash
pnpm test src/verticals/vehicles
pnpm test src/verticals/wholesale
pnpm test src/verticals/hotels
```

## Best Practices

1. **Keep vertical logic isolated** - Don't cross-reference between verticals
2. **Store data in Contact.metadata** - Use structured JSON for vertical-specific data
3. **Follow schema validation** - Use Zod for all inputs/outputs
4. **Write comprehensive tests** - Test edge cases and error handling
5. **Document assumptions** - Clear comments on business rules
6. **Use type safety** - Export types for external consumers

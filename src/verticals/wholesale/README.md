# Wholesale / Distributor Vertical

Features for wholesale businesses, distributors, and B2B sales.

## Features

### 1. Stock Management

CSV-based inventory updates with automatic sync.

#### CSV Format

```csv
SKU,STOCK,PRICE
PROD-001,100,5000
PROD-002,50,3500
PROD-003,0,2800
```

**Required columns:**
- `SKU` or `sku` - Product identifier
- `STOCK` or `CANTIDAD` or `cantidad` - Stock quantity
- `PRICE` or `PRECIO` or `precio` - Price (optional)

#### Usage

```typescript
import { parseStockCSV, applyStockUpdates } from './stock-manager.js';

const csvContent = `SKU,STOCK,PRICE
PROD-001,100,5000
PROD-002,50,3500`;

const updates = parseStockCSV(csvContent);
const result = applyStockUpdates(existingProducts, updates);

console.log(result.updated.length); // Products updated
console.log(result.notFound); // SKUs not in catalog
```

#### Tool: `wholesale-update-stock`

```json
{
  "tool": "wholesale-update-stock",
  "input": {
    "csvContent": "SKU,STOCK,PRICE\nPROD-001,100,5000",
    "projectId": "project-123"
  }
}
```

#### Stock Alerts

```typescript
import { getLowStockAlerts, getOutOfStockProducts } from './stock-manager.js';

const lowStock = getLowStockAlerts(products);
// Returns products below minStock threshold

const outOfStock = getOutOfStockProducts(products);
// Returns products with 0 stock
```

### 2. Order History & Analytics

Track customer purchase patterns for personalized service.

#### Usage

```typescript
import { buildOrderHistory, calculateLTV } from './order-history.js';

const history = buildOrderHistory(orders);

console.log(history.totalOrders);
console.log(history.totalSpent);
console.log(history.topProducts); // Most purchased items

const ltv = calculateLTV(orders);
console.log(ltv.totalValue);
console.log(ltv.averageDaysBetweenOrders);
```

#### Tool: `wholesale-order-history`

```json
{
  "tool": "wholesale-order-history",
  "input": {
    "contactId": "contact-123",
    "limit": 10
  }
}
```

Returns:
```json
{
  "success": true,
  "totalOrders": 15,
  "totalSpent": 450000,
  "averageOrderValue": 30000,
  "topProducts": [
    {
      "sku": "PROD-001",
      "productName": "Product Name",
      "totalQuantity": 50,
      "totalSpent": 150000
    }
  ],
  "ltv": {
    "totalValue": 450000,
    "orderCount": 15,
    "averageDaysBetweenOrders": 21
  }
}
```

### 3. Tiered Pricing

Differentiated pricing based on customer purchase volume.

#### Tiers

| Tier | Discount | Min Order Value | Description |
|------|----------|-----------------|-------------|
| Retail | 0% | $0 | Precio de lista |
| Bronze | 10% | $50,000 | Cliente mayorista bronce |
| Silver | 20% | $150,000 | Cliente mayorista plata |
| Gold | 30% | $300,000 | Cliente mayorista oro |
| Platinum | 40% | $500,000 | Cliente VIP |

#### Auto-tier Assignment

```typescript
import { calculateTierFromHistory } from './pricing-tiers.js';

const tier = calculateTierFromHistory(
  totalSpent: 350000,
  orderCount: 8
);

console.log(tier); // 'gold'
```

#### Calculate Prices

```typescript
import { applyTierPricing } from './pricing-tiers.js';

const pricedProducts = applyTierPricing(products, 'gold');

pricedProducts.forEach(p => {
  console.log(`${p.name}: $${p.basePrice} → $${p.tierPrice} (${p.discount}% off)`);
});
```

## Contact Metadata Structure

```typescript
{
  "vertical": "wholesale",
  "pricing": {
    "tier": "gold",
    "discount": 30,
    "totalSpent": 350000,
    "orderCount": 8,
    "lastUpdated": "2025-01-15T10:00:00Z"
  },
  "orders": [
    {
      "orderId": "ORD-001",
      "date": "2025-01-10T14:30:00Z",
      "items": [
        {
          "sku": "PROD-001",
          "productName": "Product 1",
          "quantity": 10,
          "unitPrice": 5000,
          "total": 50000
        }
      ],
      "total": 50000,
      "status": "delivered"
    }
  ]
}
```

## Project Configuration

Store catalog in project config:

```typescript
// project.configJson.catalog
{
  "products": [
    {
      "sku": "PROD-001",
      "name": "Product Name",
      "category": "Category A",
      "price": 5000,
      "stock": 100,
      "minStock": 10,
      "unit": "unidad",
      "lastUpdated": "2025-01-15T10:00:00Z"
    }
  ],
  "lastStockUpdate": "2025-01-15T10:00:00Z"
}
```

## Agent Prompts

Recommended instructions for wholesale agents:

```
You are a wholesale sales assistant. Key behaviors:

1. Check order history before responding - use wholesale-order-history tool
2. Recommend products based on past purchases
3. Apply tiered pricing automatically based on customer tier
4. Check stock availability before confirming orders
5. Notify customer of tier upgrades: "¡Felicitaciones! Alcanzaste nivel Gold (30% descuento)"
6. Suggest reorders for frequently purchased items
7. Alert about low stock or out-of-stock items
```

## Scheduled Tasks

### Daily Stock Alert

```json
{
  "name": "Daily Stock Alerts",
  "cronExpression": "0 8 * * *",
  "taskPayload": {
    "action": "check_low_stock",
    "notifyOwner": true
  }
}
```

### Weekly Customer LTV Update

```json
{
  "name": "Update Customer Tiers",
  "cronExpression": "0 9 * * 1",
  "taskPayload": {
    "action": "recalculate_customer_tiers",
    "notifyUpgrades": true
  }
}
```

## Best Practices

1. **Update stock daily** - Use CSV import or API integration
2. **Track every order** - Store in contact metadata for analytics
3. **Auto-upgrade tiers** - Notify customers when they reach new tier
4. **Personalize recommendations** - Use order history
5. **Set minStock thresholds** - Get alerts before stockouts
6. **Monitor LTV** - Identify high-value customers

## Testing

```bash
pnpm test src/verticals/wholesale
```

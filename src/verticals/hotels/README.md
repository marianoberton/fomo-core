# Hotel / Hospitality Vertical

Features for hotels, hostels, vacation rentals, and hospitality businesses.

## Features

### 1. Seasonal Pricing

Dynamic room rates based on high/medium/low season.

#### Seasons

| Season | Dates | Description |
|--------|-------|-------------|
| **High** | Dec 20 - Mar 10, Jul 1-31 | Verano, vacaciones de invierno |
| **Medium** | Mar 11 - Jun 30, Sep 1 - Nov 30 | Otoño y primavera |
| **Low** | Aug 1-31 | Post vacaciones de invierno |

#### Usage

```typescript
import { getSeasonForDate, calculateStayPrice } from './seasonal-pricing.js';

// Detect season
const season = getSeasonForDate(new Date('2025-01-15'));
console.log(season); // 'high'

// Calculate total price
const prices = [
  { roomTypeId: 'standard', season: 'high', pricePerNight: 10000, minStay: 2 },
  { roomTypeId: 'standard', season: 'medium', pricePerNight: 7000, minStay: 1 },
  { roomTypeId: 'standard', season: 'low', pricePerNight: 5000, minStay: 1 },
];

const pricing = calculateStayPrice(
  prices,
  'standard',
  '2025-01-10', // check-in
  '2025-01-15'  // check-out
);

console.log(pricing.season); // 'high'
console.log(pricing.nights); // 5
console.log(pricing.pricePerNight); // 10000
console.log(pricing.total); // 50000
console.log(pricing.meetsMinStay); // true (5 nights ≥ 2 minStay)
```

#### Tool: `hotel-seasonal-pricing`

```json
{
  "tool": "hotel-seasonal-pricing",
  "input": {
    "projectId": "hotel-123",
    "checkIn": "2025-07-15T14:00:00Z",
    "checkOut": "2025-07-20T10:00:00Z",
    "roomTypeId": "deluxe"
  }
}
```

Returns:
```json
{
  "success": true,
  "season": "high",
  "checkIn": "2025-07-15T14:00:00Z",
  "checkOut": "2025-07-20T10:00:00Z",
  "nights": 5,
  "rooms": [
    {
      "roomTypeId": "deluxe",
      "roomName": "Deluxe Room",
      "pricePerNight": 12000,
      "totalPrice": 60000,
      "minStay": 2,
      "meetsMinStay": true
    }
  ]
}
```

### 2. Multi-Language Support

Auto-detect and maintain consistent language throughout conversation.

#### Supported Languages

- 🇪🇸 **Spanish (es)** - Default
- 🇬🇧 **English (en)**
- 🇵🇹 **Portuguese (pt)**
- 🇫🇷 **French (fr)**
- 🇩🇪 **German (de)**
- 🇮🇹 **Italian (it)**

#### Usage

```typescript
import { detectLanguage, translate, getLanguageInstructions } from './multi-language.js';

// Auto-detect
const detection = detectLanguage('Hello, I would like to book a room');
console.log(detection.language); // 'en'
console.log(detection.confidence); // 'high'

// Get translations
const greeting = translate('greeting', 'en');
console.log(greeting); // 'Hello! Welcome. How can I help you?'

// Get prompt instructions
const instructions = getLanguageInstructions('en');
// "IMPORTANT: The customer's preferred language is English. Always respond in English..."
```

#### Tool: `hotel-detect-language`

```json
{
  "tool": "hotel-detect-language",
  "input": {
    "contactId": "contact-123",
    "text": "Bonjour, je voudrais réserver une chambre",
    "updateContact": true
  }
}
```

Returns:
```json
{
  "success": true,
  "contactId": "contact-123",
  "language": "fr",
  "confidence": "high",
  "fallback": false,
  "instructions": "IMPORTANT: The customer's preferred language is français..."
}
```

#### Force Language

```json
{
  "tool": "hotel-detect-language",
  "input": {
    "contactId": "contact-123",
    "text": "any text",
    "forceLanguage": "de"
  }
}
```

## Contact Metadata Structure

```typescript
{
  "vertical": "hotels",
  "language": {
    "preferred": "en",
    "detectedAt": "2025-01-15T10:00:00Z",
    "confidence": "high"
  },
  "reservation": {
    "checkIn": "2025-07-15T14:00:00Z",
    "checkOut": "2025-07-20T10:00:00Z",
    "roomTypeId": "deluxe",
    "season": "high",
    "lastUpdated": "2025-01-15T10:30:00Z"
  }
}
```

## Project Configuration

Store room types and seasonal prices in project config:

```typescript
// project.configJson.hotel
{
  "roomTypes": [
    {
      "id": "standard",
      "name": "Standard Room",
      "capacity": 2,
      "description": "Comfortable room with double bed",
      "amenities": ["WiFi", "TV", "Air Conditioning"],
      "images": ["https://..."]
    },
    {
      "id": "deluxe",
      "name": "Deluxe Room",
      "capacity": 3,
      "description": "Spacious room with queen bed",
      "amenities": ["WiFi", "TV", "Air Conditioning", "Mini Bar", "Balcony"]
    }
  ],
  "seasonalPrices": [
    {
      "roomTypeId": "standard",
      "season": "high",
      "pricePerNight": 10000,
      "minStay": 2
    },
    {
      "roomTypeId": "standard",
      "season": "medium",
      "pricePerNight": 7000,
      "minStay": 1
    },
    {
      "roomTypeId": "standard",
      "season": "low",
      "pricePerNight": 5000,
      "minStay": 1
    }
  ]
}
```

## Agent Prompts

Recommended instructions for hotel agents:

```
You are a hotel concierge assistant. Key behaviors:

1. Detect language on first message - use hotel-detect-language tool
2. Maintain consistent language throughout conversation
3. Calculate prices using seasonal rates - use hotel-seasonal-pricing tool
4. Always mention check-in/check-out times
5. Inform about minimum stay requirements in high season
6. Offer room upgrades when available
7. Be warm and hospitable in tone
8. Use appropriate greetings/farewells in guest's language
```

## Example Agent Flow

```typescript
// 1. First message from guest
const langDetection = await hotelDetectLanguageTool.execute({
  contactId: 'guest-123',
  text: 'Hello, do you have rooms available for July?',
  updateContact: true,
}, context);

// 2. Calculate pricing
const pricing = await hotelSeasonalPricingTool.execute({
  projectId: 'hotel-abc',
  checkIn: '2025-07-15T14:00:00Z',
  checkOut: '2025-07-20T10:00:00Z',
}, context);

// 3. Respond in detected language
const response = translate('checkAvailability', langDetection.language);
// "Checking availability..."
```

## Scheduled Tasks

### Daily Occupancy Report

```json
{
  "name": "Daily Occupancy Report",
  "cronExpression": "0 8 * * *",
  "taskPayload": {
    "action": "generate_occupancy_report",
    "sendTo": "manager@hotel.com"
  }
}
```

### Upcoming Check-ins Reminder

```json
{
  "name": "Check-in Reminders",
  "cronExpression": "0 10 * * *",
  "taskPayload": {
    "action": "send_checkin_reminders",
    "hoursBeforeCheckin": 24
  }
}
```

## Best Practices

1. **Detect language early** - On first interaction
2. **Store language in Contact** - Maintain consistency
3. **Use seasonal pricing** - Always calculate dynamically
4. **Set minimum stays** - Especially in high season
5. **Offer alternatives** - If preferred room unavailable
6. **Send confirmation emails** - In guest's language
7. **Multi-currency support** - Consider adding in future

## Testing

```bash
pnpm test src/verticals/hotels
```

## Future Enhancements

- [ ] Multi-currency pricing (USD, EUR, etc.)
- [ ] Special offers/promotions management
- [ ] Integration with booking engines (Booking.com, Airbnb)
- [ ] Automated review requests post-checkout
- [ ] Loyalty program integration

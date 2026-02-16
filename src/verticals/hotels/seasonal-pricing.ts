/**
 * Seasonal Pricing Service for Hotels
 *
 * Manages room rates by season (high/medium/low)
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const SeasonSchema = z.enum(['low', 'medium', 'high']);

export type Season = z.infer<typeof SeasonSchema>;

export const RoomTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  capacity: z.number(),
  description: z.string().optional(),
  amenities: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
});

export type RoomType = z.infer<typeof RoomTypeSchema>;

export const SeasonalPriceSchema = z.object({
  roomTypeId: z.string(),
  season: SeasonSchema,
  pricePerNight: z.number(),
  minStay: z.number().default(1),
});

export type SeasonalPrice = z.infer<typeof SeasonalPriceSchema>;

export interface SeasonConfig {
  season: Season;
  name: string;
  dateRanges: {
    start: string; // MM-DD format
    end: string; // MM-DD format
  }[];
  description: string;
}

export interface PricedRoom {
  roomType: RoomType;
  season: Season;
  pricePerNight: number;
  minStay: number;
  totalPrice?: number;
}

// ─── Season Configuration ───────────────────────────────────────

export const SEASON_CONFIG: Record<Season, SeasonConfig> = {
  high: {
    season: 'high',
    name: 'Temporada Alta',
    dateRanges: [
      { start: '12-20', end: '03-10' }, // Summer + holidays
      { start: '07-01', end: '07-31' }, // Winter break
    ],
    description: 'Verano, feriados largos, vacaciones de invierno',
  },
  medium: {
    season: 'medium',
    name: 'Temporada Media',
    dateRanges: [
      { start: '03-11', end: '06-30' }, // Fall
      { start: '09-01', end: '11-30' }, // Spring
    ],
    description: 'Otoño y primavera',
  },
  low: {
    season: 'low',
    name: 'Temporada Baja',
    dateRanges: [{ start: '08-01', end: '08-31' }], // Post winter break
    description: 'Agosto (post vacaciones de invierno)',
  },
};

// ─── Season Detection ───────────────────────────────────────────

/**
 * Determine season for a given date
 */
export function getSeasonForDate(date: Date | string): Season {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate();
  const mmdd = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

  // Check each season's date ranges
  for (const [season, config] of Object.entries(SEASON_CONFIG)) {
    for (const range of config.dateRanges) {
      if (isDateInRange(mmdd, range.start, range.end)) {
        return season as Season;
      }
    }
  }

  // Default to medium if not found
  return 'medium';
}

/**
 * Check if date is in range (handles year wrap-around)
 */
function isDateInRange(mmdd: string, start: string, end: string): boolean {
  if (start <= end) {
    // Normal range within same year
    return mmdd >= start && mmdd <= end;
  } else {
    // Wraps around year boundary (e.g., 12-20 to 03-10)
    return mmdd >= start || mmdd <= end;
  }
}

/**
 * Get season for a date range
 */
export function getSeasonForRange(checkIn: Date | string, _checkOut: Date | string): Season {
  const start = typeof checkIn === 'string' ? new Date(checkIn) : checkIn;
  void _checkOut;

  // Use check-in date for season
  // In a more complex system, you might charge different rates per night
  return getSeasonForDate(start);
}

// ─── Pricing Logic ──────────────────────────────────────────────

/**
 * Get price for room type in a given season
 */
export function getRoomPrice(
  prices: SeasonalPrice[],
  roomTypeId: string,
  season: Season
): SeasonalPrice | null {
  return prices.find((p) => p.roomTypeId === roomTypeId && p.season === season) ?? null;
}

/**
 * Calculate total price for a stay
 */
export function calculateStayPrice(
  prices: SeasonalPrice[],
  roomTypeId: string,
  checkIn: Date | string,
  checkOut: Date | string
): {
  pricePerNight: number;
  nights: number;
  total: number;
  season: Season;
  minStay: number;
  meetsMinStay: boolean;
} | null {
  const start = typeof checkIn === 'string' ? new Date(checkIn) : checkIn;
  const end = typeof checkOut === 'string' ? new Date(checkOut) : checkOut;

  const nights = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (nights <= 0) {
    return null;
  }

  const season = getSeasonForDate(start);
  const price = getRoomPrice(prices, roomTypeId, season);

  if (!price) {
    return null;
  }

  return {
    pricePerNight: price.pricePerNight,
    nights,
    total: price.pricePerNight * nights,
    season,
    minStay: price.minStay,
    meetsMinStay: nights >= price.minStay,
  };
}

/**
 * Get available rooms with seasonal pricing
 */
export function getPricedRooms(
  rooms: RoomType[],
  prices: SeasonalPrice[],
  season: Season,
  nights?: number
): PricedRoom[] {
  return rooms.map((room) => {
    const price = getRoomPrice(prices, room.id, season);

    if (!price) {
      // Fallback if no price defined for this season
      return {
        roomType: room,
        season,
        pricePerNight: 0,
        minStay: 1,
        totalPrice: 0,
      };
    }

    return {
      roomType: room,
      season,
      pricePerNight: price.pricePerNight,
      minStay: price.minStay,
      totalPrice: nights ? price.pricePerNight * nights : undefined,
    };
  });
}

/**
 * Format seasonal pricing info
 */
export function formatSeasonalInfo(season: Season): string {
  const config = SEASON_CONFIG[season];
  return `🗓️ ${config.name}\n${config.description}`;
}

/**
 * Build seasonal metadata for contact
 */
export function buildSeasonalMetadata(
  existingMetadata: unknown,
  checkIn: string,
  checkOut: string,
  roomTypeId: string,
  season: Season
): Record<string, unknown> {
  const metadata = (existingMetadata ?? {}) as Record<string, unknown>;

  return {
    ...metadata,
    vertical: 'hotels',
    reservation: {
      checkIn,
      checkOut,
      roomTypeId,
      season,
      lastUpdated: new Date().toISOString(),
    },
  };
}

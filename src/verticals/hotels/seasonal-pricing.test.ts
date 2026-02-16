import { describe, it, expect } from 'vitest';
import {
  getSeasonForDate,
  calculateStayPrice,
  SEASON_CONFIG,
} from './seasonal-pricing.js';
import type { SeasonalPrice } from './seasonal-pricing.js';

describe('Seasonal Pricing', () => {
  describe('getSeasonForDate', () => {
    it('should identify high season in summer (January)', () => {
      const result = getSeasonForDate(new Date('2025-01-15'));
      expect(result).toBe('high');
    });

    it('should identify high season in winter break (July)', () => {
      const result = getSeasonForDate(new Date('2025-07-15'));
      expect(result).toBe('high');
    });

    it('should identify medium season in fall (April)', () => {
      const result = getSeasonForDate(new Date('2025-04-15'));
      expect(result).toBe('medium');
    });

    it('should identify medium season in spring (October)', () => {
      const result = getSeasonForDate(new Date('2025-10-15'));
      expect(result).toBe('medium');
    });

    it('should identify low season (August)', () => {
      const result = getSeasonForDate(new Date('2025-08-15'));
      expect(result).toBe('low');
    });

    it('should handle year wrap-around (December to March)', () => {
      const december = getSeasonForDate(new Date('2025-12-25'));
      const january = getSeasonForDate(new Date('2025-01-05'));
      const february = getSeasonForDate(new Date('2025-02-15'));

      expect(december).toBe('high');
      expect(january).toBe('high');
      expect(february).toBe('high');
    });
  });

  describe('calculateStayPrice', () => {
    const prices: SeasonalPrice[] = [
      {
        roomTypeId: 'standard',
        season: 'high',
        pricePerNight: 10000,
        minStay: 2,
      },
      {
        roomTypeId: 'standard',
        season: 'medium',
        pricePerNight: 7000,
        minStay: 1,
      },
      {
        roomTypeId: 'standard',
        season: 'low',
        pricePerNight: 5000,
        minStay: 1,
      },
    ];

    it('should calculate total price for high season', () => {
      const checkIn = new Date('2025-01-10');
      const checkOut = new Date('2025-01-15');

      const result = calculateStayPrice(prices, 'standard', checkIn, checkOut);

      if (!result) {
        throw new Error('Expected pricing result');
      }
      expect(result.season).toBe('high');
      expect(result.pricePerNight).toBe(10000);
      expect(result.nights).toBe(5);
      expect(result.total).toBe(50000);
    });

    it('should calculate total price for medium season', () => {
      const checkIn = new Date('2025-04-10');
      const checkOut = new Date('2025-04-13');

      const result = calculateStayPrice(prices, 'standard', checkIn, checkOut);

      if (!result) {
        throw new Error('Expected pricing result');
      }
      expect(result.season).toBe('medium');
      expect(result.pricePerNight).toBe(7000);
      expect(result.nights).toBe(3);
      expect(result.total).toBe(21000);
    });

    it('should calculate total price for low season', () => {
      const checkIn = new Date('2025-08-10');
      const checkOut = new Date('2025-08-12');

      const result = calculateStayPrice(prices, 'standard', checkIn, checkOut);

      if (!result) {
        throw new Error('Expected pricing result');
      }
      expect(result.season).toBe('low');
      expect(result.pricePerNight).toBe(5000);
      expect(result.nights).toBe(2);
      expect(result.total).toBe(10000);
    });

    it('should check minimum stay requirement', () => {
      const checkIn = new Date('2025-01-10');
      const checkOutShort = new Date('2025-01-11'); // 1 night
      const checkOutLong = new Date('2025-01-13'); // 3 nights

      const shortStay = calculateStayPrice(prices, 'standard', checkIn, checkOutShort);
      const longStay = calculateStayPrice(prices, 'standard', checkIn, checkOutLong);

      if (!shortStay) {
        throw new Error('Expected short stay result');
      }
      if (!longStay) {
        throw new Error('Expected long stay result');
      }
      expect(shortStay.meetsMinStay).toBe(false); // minStay is 2
      expect(longStay.meetsMinStay).toBe(true);
    });

    it('should return null for invalid dates', () => {
      const checkIn = new Date('2025-01-15');
      const checkOut = new Date('2025-01-10'); // Before check-in

      const result = calculateStayPrice(prices, 'standard', checkIn, checkOut);

      expect(result).toBeNull();
    });

    it('should return null for non-existent room type', () => {
      const checkIn = new Date('2025-01-10');
      const checkOut = new Date('2025-01-15');

      const result = calculateStayPrice(prices, 'deluxe', checkIn, checkOut);

      expect(result).toBeNull();
    });
  });

  describe('SEASON_CONFIG', () => {
    it('should have config for all three seasons', () => {
      expect(SEASON_CONFIG.high).toBeDefined();
      expect(SEASON_CONFIG.medium).toBeDefined();
      expect(SEASON_CONFIG.low).toBeDefined();
    });

    it('should have date ranges for high season', () => {
      expect(SEASON_CONFIG.high.dateRanges.length).toBeGreaterThan(0);
    });

    it('should have descriptive names', () => {
      expect(SEASON_CONFIG.high.name).toContain('Alta');
      expect(SEASON_CONFIG.medium.name).toContain('Media');
      expect(SEASON_CONFIG.low.name).toContain('Baja');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { hotelDetectLanguageTool } from './hotel-detect-language.js';

describe('Hotel Detect Language Tool', () => {
  describe('Schema Validation', () => {
    it('should validate valid input', () => {
      const input = {
        contactId: 'contact-123',
        text: 'Hello, I would like to book a room',
      };

      const result = hotelDetectLanguageTool.inputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept forceLanguage', () => {
      const input = {
        contactId: 'contact-123',
        text: 'any text',
        forceLanguage: 'en',
      };

      const result = hotelDetectLanguageTool.inputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('Dry Run', () => {
    it('should detect English', async () => {
      const input = {
        contactId: 'contact-123',
        text: 'Hello, I would like to book a room please',
      };

      const result = await hotelDetectLanguageTool.dryRun(input);

      expect(result.success).toBe(true);
      expect(result.language).toBe('en');
      expect(result.instructions).toBeTruthy();
    });

    it('should detect Spanish', async () => {
      const input = {
        contactId: 'contact-123',
        text: 'Hola, quisiera reservar una habitación',
      };

      const result = await hotelDetectLanguageTool.dryRun(input);

      expect(result.success).toBe(true);
      expect(result.language).toBe('es');
    });

    it('should use forced language', async () => {
      const input = {
        contactId: 'contact-123',
        text: 'any text',
        forceLanguage: 'fr' as const,
      };

      const result = await hotelDetectLanguageTool.dryRun(input);

      expect(result.success).toBe(true);
      expect(result.language).toBe('fr');
      expect(result.confidence).toBe('high');
    });
  });

  describe('Tool Properties', () => {
    it('should have correct metadata', () => {
      expect(hotelDetectLanguageTool.id).toBe('hotel-detect-language');
      expect(hotelDetectLanguageTool.riskLevel).toBe('low');
      expect(hotelDetectLanguageTool.tags).toContain('hotels');
      expect(hotelDetectLanguageTool.tags).toContain('language');
    });
  });
});

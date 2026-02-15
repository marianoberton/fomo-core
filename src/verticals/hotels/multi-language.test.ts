import { describe, it, expect } from 'vitest';
import { detectLanguage, translate, getLanguageInstructions } from './multi-language.js';

describe('Multi-Language Service', () => {
  describe('detectLanguage', () => {
    it('should detect Spanish from text', () => {
      const result = detectLanguage('Hola, quisiera reservar una habitación por favor');

      expect(result.language).toBe('es');
      expect(result.confidence).toBe('high');
      expect(result.fallback).toBe(false);
    });

    it('should detect English from text', () => {
      const result = detectLanguage('Hello, I would like to book a room please');

      expect(result.language).toBe('en');
      expect(result.confidence).toBe('high');
    });

    it('should detect Portuguese from text', () => {
      const result = detectLanguage('Olá, gostaria de reservar um quarto por favor');

      expect(result.language).toBe('pt');
      expect(result.confidence).toBe('high');
    });

    it('should detect French from text', () => {
      const result = detectLanguage('Bonjour, je voudrais réserver une chambre');

      expect(result.language).toBe('fr');
      expect(result.confidence).toBe('high');
    });

    it('should detect German from text', () => {
      const result = detectLanguage('Hallo, ich möchte ein Zimmer reservieren');

      expect(result.language).toBe('de');
      expect(result.confidence).toBe('high');
    });

    it('should detect Italian from text', () => {
      const result = detectLanguage('Ciao, vorrei prenotare una camera');

      expect(result.language).toBe('it');
      expect(result.confidence).toBe('high');
    });

    it('should fallback to Spanish when no patterns match', () => {
      const result = detectLanguage('xyz 123 abc');

      expect(result.language).toBe('es');
      expect(result.confidence).toBe('low');
      expect(result.fallback).toBe(true);
    });

    it('should give medium confidence for single keyword match', () => {
      const result = detectLanguage('hello');

      expect(result.language).toBe('en');
      expect(result.confidence).toBe('medium');
    });
  });

  describe('translate', () => {
    it('should translate greeting to Spanish', () => {
      const result = translate('greeting', 'es');

      expect(result).toContain('Hola');
      expect(result).toContain('Bienvenido');
    });

    it('should translate greeting to English', () => {
      const result = translate('greeting', 'en');

      expect(result).toContain('Hello');
      expect(result).toContain('Welcome');
    });

    it('should translate farewell to Portuguese', () => {
      const result = translate('farewell', 'pt');

      expect(result).toContain('Obrigado');
    });

    it('should translate confirmReservation to French', () => {
      const result = translate('confirmReservation', 'fr');

      expect(result).toContain('Réservation confirmée');
    });
  });

  describe('getLanguageInstructions', () => {
    it('should return instructions for Spanish', () => {
      const result = getLanguageInstructions('es');

      expect(result).toContain('español');
      expect(result).toContain('respond in');
    });

    it('should return instructions for English', () => {
      const result = getLanguageInstructions('en');

      expect(result).toContain('English');
    });

    it('should emphasize consistency', () => {
      const result = getLanguageInstructions('fr');

      expect(result).toContain('consistent');
      expect(result).toContain('entire conversation');
    });
  });
});

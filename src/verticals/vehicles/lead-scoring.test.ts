import { describe, it, expect } from 'vitest';
import { calculateLeadScore, buildLeadMetadata } from './lead-scoring.js';

describe('Lead Scoring', () => {
  describe('calculateLeadScore', () => {
    it('should score urgent high-budget lead as urgent tier', () => {
      const result = calculateLeadScore({
        urgency: 'urgent',
        budgetRange: 'premium',
        vehicleType: 'sports',
        hasTradeIn: true,
        financingNeeded: false,
      });

      expect(result.tier).toBe('urgent');
      expect(result.score).toBeGreaterThanOrEqual(75);
      expect(result.suggestedActions).toContain('Contact immediately (within 1 hour)');
    });

    it('should score browsing low-budget lead as cold tier', () => {
      const result = calculateLeadScore({
        urgency: 'browsing',
        budgetRange: 'low',
      });

      expect(result.tier).toBe('cold');
      expect(result.score).toBeLessThan(35);
      expect(result.suggestedActions).toContain('Add to newsletter list');
    });

    it('should apply cash buyer bonus', () => {
      const withFinancing = calculateLeadScore({
        urgency: 'ready',
        budgetRange: 'medium',
        financingNeeded: true,
      });

      const cashBuyer = calculateLeadScore({
        urgency: 'ready',
        budgetRange: 'medium',
        financingNeeded: false,
      });

      expect(cashBuyer.score).toBeGreaterThan(withFinancing.score);
    });

    it('should infer budget range from absolute value', () => {
      const result = calculateLeadScore({
        urgency: 'ready',
        budget: 35000000, // Premium range
      });

      expect(result.tier).toBe('hot'); // High urgency + premium budget
      expect(result.score).toBeGreaterThan(50);
    });
  });

  describe('buildLeadMetadata', () => {
    it('should create metadata with lead score', () => {
      const leadData = {
        urgency: 'urgent' as const,
        budgetRange: 'high' as const,
      };

      const score = calculateLeadScore(leadData);
      const metadata = buildLeadMetadata({}, leadData, score);

      expect(metadata.vertical).toBe('vehicles');
      expect(metadata.leadScore).toBeDefined();
      expect((metadata.leadScore as any).score).toBe(score.score);
      expect((metadata.leadScore as any).tier).toBe(score.tier);
    });
  });
});

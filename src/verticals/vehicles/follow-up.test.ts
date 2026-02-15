import { describe, it, expect } from 'vitest';
import { calculateFollowUp } from './follow-up.js';

describe('Follow-up Service', () => {
  describe('calculateFollowUp', () => {
    it('should trigger follow-up for urgent lead after 6 hours', () => {
      const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();

      const result = calculateFollowUp({
        tier: 'urgent',
        lastInteractionAt: sevenHoursAgo,
        followUpCount: 0,
      });

      expect(result.shouldFollowUp).toBe(true);
      expect(result.priority).toBe('urgent');
      expect(result.suggestedMessage).toBeTruthy();
    });

    it('should not trigger follow-up for urgent lead before 6 hours', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

      const result = calculateFollowUp({
        tier: 'urgent',
        lastInteractionAt: threeHoursAgo,
        followUpCount: 0,
      });

      expect(result.shouldFollowUp).toBe(false);
    });

    it('should trigger follow-up for hot lead after 24 hours', () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

      const result = calculateFollowUp({
        tier: 'hot',
        lastInteractionAt: twentyFiveHoursAgo,
        followUpCount: 0,
      });

      expect(result.shouldFollowUp).toBe(true);
      expect(result.priority).toBe('high');
    });

    it('should stop follow-ups after max attempts', () => {
      const longTimeAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();

      const result = calculateFollowUp({
        tier: 'warm',
        lastInteractionAt: longTimeAgo,
        followUpCount: 3, // Max reached
      });

      expect(result.shouldFollowUp).toBe(false);
      expect(result.reason).toContain('Max follow-up attempts reached');
    });

    it('should provide different messages for each follow-up', () => {
      const now = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();

      const first = calculateFollowUp({
        tier: 'hot',
        lastInteractionAt: now,
        followUpCount: 0,
      });

      const second = calculateFollowUp({
        tier: 'hot',
        lastInteractionAt: now,
        followUpCount: 1,
      });

      expect(first.suggestedMessage).not.toBe(second.suggestedMessage);
    });
  });
});

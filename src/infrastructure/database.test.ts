import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase, getDatabase, resetDatabaseSingleton } from './database.js';

describe('Database', () => {
  beforeEach(() => {
    resetDatabaseSingleton();
  });

  describe('createDatabase', () => {
    it('creates a Database instance with a PrismaClient', () => {
      const db = createDatabase({ url: 'postgresql://fake:fake@localhost:5432/fake' });

      expect(db).toBeDefined();
      expect(db.client).toBeDefined();
      expect(typeof db.connect).toBe('function');
      expect(typeof db.disconnect).toBe('function');
    });

    it('throws if called twice without disconnect', () => {
      createDatabase({ url: 'postgresql://fake:fake@localhost:5432/fake' });

      expect(() =>
        createDatabase({ url: 'postgresql://fake:fake@localhost:5432/fake' }),
      ).toThrow('Database already initialized');
    });

    it('allows re-creation after reset', () => {
      createDatabase({ url: 'postgresql://fake:fake@localhost:5432/fake' });
      resetDatabaseSingleton();

      const db2 = createDatabase({ url: 'postgresql://fake:fake@localhost:5432/fake' });
      expect(db2).toBeDefined();
    });
  });

  describe('getDatabase', () => {
    it('throws if not initialized', () => {
      expect(() => getDatabase()).toThrow('Database not initialized');
    });

    it('returns the singleton after creation', () => {
      const db = createDatabase({ url: 'postgresql://fake:fake@localhost:5432/fake' });
      const retrieved = getDatabase();

      expect(retrieved).toBe(db);
    });
  });
});

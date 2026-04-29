import { describe, it, expect } from 'vitest';
import { validateTargetSource, getBlockedCountryCodes } from './target-validator.js';
import type { ValidateTargetSourceInput } from './target-validator.js';

const BASE_INPUT: ValidateTargetSourceInput = {
  phoneNumber: '+5491156781234',
  country: 'AR',
  verticalSlug: 'automotriz',
  sourceType: 'url',
  sourceValue: 'https://concesionaria.com.ar/contacto',
  name: 'Concesionaria Demo',
  company: 'Demo SA',
};

// ─── Country checks ───────────────────────────────────────────────

describe('validateTargetSource — country blocking', () => {
  const euCases = [
    'DE', 'FR', 'ES', 'IT', 'PT', 'NL', 'BE', 'AT', 'PL', 'RO',
    'SE', 'FI', 'DK', 'IE', 'HR', 'CZ', 'SK', 'HU', 'BG', 'GR',
    'IS', 'NO', 'LI', // EEA
    'GB', // UK GDPR
    'CH', // Switzerland
  ];

  for (const country of euCases) {
    it(`blocks ${country} (GDPR jurisdiction)`, () => {
      const result = validateTargetSource({ ...BASE_INPUT, country });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.researchCode).toBe('COMPLIANCE_BLOCKED');
        expect(result.error.message).toContain(country);
      }
    });
  }

  it('blocks lowercase eu country codes', () => {
    const result = validateTargetSource({ ...BASE_INPUT, country: 'de' });
    expect(result.ok).toBe(false);
  });

  const allowedCases = ['AR', 'BR', 'MX', 'CL', 'CO', 'PE', 'UY', 'PY', 'US', 'CA'];
  for (const country of allowedCases) {
    it(`allows ${country}`, () => {
      const result = validateTargetSource({ ...BASE_INPUT, country });
      expect(result.ok).toBe(true);
    });
  }
});

// ─── Source evidence checks ───────────────────────────────────────

describe('validateTargetSource — source evidence', () => {
  it('blocks when sourceValue is empty string', () => {
    const result = validateTargetSource({ ...BASE_INPUT, sourceValue: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.researchCode).toBe('COMPLIANCE_BLOCKED');
  });

  it('blocks when sourceValue is whitespace-only', () => {
    const result = validateTargetSource({ ...BASE_INPUT, sourceValue: '   ' });
    expect(result.ok).toBe(false);
  });

  it('blocks when sourceType=url and sourceValue is not a URL', () => {
    const result = validateTargetSource({
      ...BASE_INPUT,
      sourceType: 'url',
      sourceValue: 'not-a-url',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('valid URL');
  });

  it('allows when sourceType=url and sourceValue is a valid URL', () => {
    const result = validateTargetSource({
      ...BASE_INPUT,
      sourceType: 'url',
      sourceValue: 'https://empresa.com/contacto',
    });
    expect(result.ok).toBe(true);
  });

  it('allows when sourceType=screenshot and sourceValue is any non-empty string', () => {
    const result = validateTargetSource({
      ...BASE_INPUT,
      sourceType: 'screenshot',
      sourceValue: 's3://bucket/screenshot.png',
    });
    expect(result.ok).toBe(true);
  });

  it('allows when sourceType=referral and sourceValue is any non-empty string', () => {
    const result = validateTargetSource({
      ...BASE_INPUT,
      sourceType: 'referral',
      sourceValue: 'Referred by team member',
    });
    expect(result.ok).toBe(true);
  });
});

// ─── Emergency number notes ───────────────────────────────────────
//
// Argentine emergency services (911, 107, SAME, etc.) use special short-dial
// codes that have no valid E.164 representation. Numbers like +5491156781234
// are normal Buenos Aires mobile numbers that happen to contain "911" as part
// of the area-code+number — they must NOT be blocked.
// Detection of crisis services relies exclusively on keywords in name/company.

describe('validateTargetSource — AR mobile numbers pass phone check', () => {
  const mobileCases = [
    '+5491156781234',  // Buenos Aires mobile (area 11 + number)
    '+5493514567890',  // Córdoba mobile (area 351)
    '+5492644123456',  // San Juan mobile (area 264)
    '+541156781234',   // Buenos Aires landline
  ];

  for (const phone of mobileCases) {
    it(`allows normal AR number ${phone}`, () => {
      const result = validateTargetSource({ ...BASE_INPUT, phoneNumber: phone });
      expect(result.ok).toBe(true);
    });
  }
});

// ─── Crisis keyword checks ────────────────────────────────────────

describe('validateTargetSource — crisis keyword blocking via name/company', () => {
  const crisisCases: Array<[string, Partial<ValidateTargetSourceInput>]> = [
    ['company contains "salud mental"', { company: 'Centro de Salud Mental Belgrano' }],
    ['name contains "centro de crisis"', { name: 'Centro de Crisis 24hs' }],
    ['name contains "suicidio"', { name: 'Prevención Suicidio AR' }],
    ['company contains "emergencias médicas"', { company: 'Servicio Emergencias Médicas Sur' }],
    ['company contains "linea 141"', { company: 'Linea 141 Violencia' }],
    ['name contains "línea 141"', { name: 'Línea 141' }],
    ['company contains "prevención suicidio"', { company: 'Centro Prevención Suicidio' }],
    ['name contains "central de emergencias"', { name: 'Central de Emergencias 24hs' }],
    ['company contains "sistema de atención médica de emergencias"',
      { company: 'Sistema de Atención Médica de Emergencias' }],
  ];

  for (const [label, override] of crisisCases) {
    it(`blocks when ${label}`, () => {
      const result = validateTargetSource({ ...BASE_INPUT, ...override });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.researchCode).toBe('COMPLIANCE_BLOCKED');
    });
  }

  it('does not block when name/company are undefined', () => {
    const result = validateTargetSource({
      ...BASE_INPUT,
      name: undefined,
      company: undefined,
    });
    expect(result.ok).toBe(true);
  });

  it('does not block a normal business name', () => {
    const result = validateTargetSource({
      ...BASE_INPUT,
      name: 'Toyota Zona Norte',
      company: 'Automotores del Norte SA',
    });
    expect(result.ok).toBe(true);
  });

  it('does not block a medical clinic (non-crisis)', () => {
    const result = validateTargetSource({
      ...BASE_INPUT,
      verticalSlug: 'medicina',
      name: 'Clínica Santa Clara',
      company: 'Sanatorio del Parque SA',
    });
    expect(result.ok).toBe(true);
  });
});

// ─── Happy path ───────────────────────────────────────────────────

describe('validateTargetSource — valid input', () => {
  it('returns ok for a compliant AR target', () => {
    const result = validateTargetSource(BASE_INPUT);
    expect(result.ok).toBe(true);
  });

  it('returns ok for screenshot source type', () => {
    const result = validateTargetSource({
      ...BASE_INPUT,
      sourceType: 'screenshot',
      sourceValue: '/screenshots/concesionaria-google-maps.png',
    });
    expect(result.ok).toBe(true);
  });
});

// ─── getBlockedCountryCodes ───────────────────────────────────────

describe('getBlockedCountryCodes', () => {
  it('returns a non-empty array', () => {
    const codes = getBlockedCountryCodes();
    expect(codes.length).toBeGreaterThan(0);
  });

  it('includes EU countries', () => {
    const codes = getBlockedCountryCodes();
    expect(codes).toContain('DE');
    expect(codes).toContain('FR');
    expect(codes).toContain('GB');
  });

  it('does not include AR', () => {
    const codes = getBlockedCountryCodes();
    expect(codes).not.toContain('AR');
  });
});

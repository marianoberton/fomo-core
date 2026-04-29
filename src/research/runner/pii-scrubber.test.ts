import { describe, it, expect } from 'vitest';
import { scrubPii } from './pii-scrubber.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function expectClean(text: string, expectedClean: string, expectedCount: number): void {
  const result = scrubPii(text, 'AR');
  expect(result.clean).toBe(expectedClean);
  expect(result.redactionsCount).toBe(expectedCount);
}

function expectUntouched(text: string): void {
  const result = scrubPii(text, 'AR');
  expect(result.clean).toBe(text);
  expect(result.redactionsCount).toBe(0);
}

// ─── DNI ────────────────────────────────────────────────────────────────────

describe('DNI (8 digits)', () => {
  it('plain 8 digits', () => {
    expectClean('Mi DNI es 12345678.', 'Mi DNI es [DNI].', 1);
  });

  it('8 digits at start of string', () => {
    expectClean('12345678 es mi DNI', '[DNI] es mi DNI', 1);
  });

  it('8 digits at end of string', () => {
    expectClean('DNI: 98765432', 'DNI: [DNI]', 1);
  });

  it('DNI with dot separators XX.XXX.XXX', () => {
    expectClean('Documento: 12.345.678', 'Documento: [DNI]', 1);
  });

  it('DNI with dot separators single leading digit X.XXX.XXX', () => {
    expectClean('Documento: 5.123.456', 'Documento: [DNI]', 1);
  });

  it('two DNIs in the same sentence', () => {
    expectClean('Titular: 20123456, cotitular: 31456789', 'Titular: [DNI], cotitular: [DNI]', 2);
  });

  it('does NOT match 7 digits (not an AR DNI)', () => {
    expectUntouched('Código 1234567');
  });

  it('does NOT match 9 digits', () => {
    expectUntouched('Número 123456789');
  });

  it('does NOT match 8-digit substring embedded in longer digits', () => {
    // 10 consecutive digits: \b prevents the 8-digit DNI pattern from matching
    // inside the longer sequence; the whole string is returned unchanged.
    const result = scrubPii('1234567890', 'AR');
    expect(result.clean).toBe('1234567890');
    expect(result.redactionsCount).toBe(0);
  });

  it('DNI in full sentence with context', () => {
    expectClean(
      'Hola Juan, su DNI 23456789 fue registrado correctamente.',
      'Hola Juan, su DNI [DNI] fue registrado correctamente.',
      1,
    );
  });
});

// ─── CUIT / CUIL ────────────────────────────────────────────────────────────

describe('CUIT/CUIL (XX-XXXXXXXX-X)', () => {
  it('individual CUIT format 20-XXXXXXXX-X', () => {
    expectClean('CUIT: 20-12345678-9', 'CUIT: [CUIT]', 1);
  });

  it('company CUIT 30-XXXXXXXX-X', () => {
    expectClean('Empresa CUIT 30-71234568-4', 'Empresa CUIT [CUIT]', 1);
  });

  it('feminine individual 27-XXXXXXXX-X', () => {
    expectClean('CUIL 27-98765432-1', 'CUIL [CUIT]', 1);
  });

  it('CUIT at start of line', () => {
    expectClean('23-45678901-5 es la razón social', '[CUIT] es la razón social', 1);
  });

  it('two CUITs in same text', () => {
    expectClean(
      'Proveedor 30-12345678-9 — Cliente 20-98765432-0',
      'Proveedor [CUIT] — Cliente [CUIT]',
      2,
    );
  });

  it('CUIT does NOT leave bare 8 digits to be caught by DNI pattern', () => {
    const result = scrubPii('CUIT 20-12345678-9 y nada más', 'AR');
    expect(result.clean).toBe('CUIT [CUIT] y nada más');
    expect(result.redactionsCount).toBe(1);
  });

  it('malformed CUIT (missing last segment): 8-digit part is caught as DNI', () => {
    // Conservative scrubbing: the 8 digits are still a DNI even without the trailing segment.
    expectClean('20-12345678', '20-[DNI]', 1);
  });

  it('malformed CUIT (extra leading digits): 8-digit part is caught as DNI', () => {
    // Same conservative approach: 12345678 is still a DNI.
    expectClean('200-12345678-9', '200-[DNI]-9', 1);
  });
});

// ─── Credit cards ───────────────────────────────────────────────────────────

describe('Credit/debit cards (16 digits)', () => {
  it('16 digits with spaces (4-4-4-4)', () => {
    expectClean('Tarjeta: 4111 1111 1111 1111', 'Tarjeta: [TARJETA]', 1);
  });

  it('16 digits with dashes (4-4-4-4)', () => {
    expectClean('Número: 5500-0000-0000-0004', 'Número: [TARJETA]', 1);
  });

  it('16 digits plain (no separators)', () => {
    expectClean('CC 4111111111111111 procesada', 'CC [TARJETA] procesada', 1);
  });

  it('Mastercard 16 digits with spaces', () => {
    expectClean('MC: 5105 1051 0510 5100', 'MC: [TARJETA]', 1);
  });

  it('card number embedded in sentence', () => {
    expectClean(
      'Su tarjeta 4000 0000 0000 0002 fue declinada.',
      'Su tarjeta [TARJETA] fue declinada.',
      1,
    );
  });

  it('does NOT match 15-digit AMEX (wrong length)', () => {
    expectUntouched('Amex 378282246310005');
  });

  it('does NOT match 17+ digits', () => {
    expectUntouched('12345678901234567');
  });

  it('two card numbers in same text', () => {
    expectClean(
      'Principal: 4111 1111 1111 1111 — Adicional: 5500 0000 0000 0004',
      'Principal: [TARJETA] — Adicional: [TARJETA]',
      2,
    );
  });
});

// ─── Emails ─────────────────────────────────────────────────────────────────

describe('Emails', () => {
  it('simple email', () => {
    expectClean('Contacto: juan@ejemplo.com', 'Contacto: [EMAIL]', 1);
  });

  it('email with subdomain', () => {
    expectClean('Env. a cliente@mail.empresa.com.ar', 'Env. a [EMAIL]', 1);
  });

  it('email with plus tag', () => {
    expectClean('juan+ventas@gmail.com responde', '[EMAIL] responde', 1);
  });

  it('email at start of string', () => {
    expectClean('admin@nexus.io es el admin', '[EMAIL] es el admin', 1);
  });

  it('two emails in same text', () => {
    expectClean(
      'De: remitente@test.com Para: destinatario@corp.ar',
      'De: [EMAIL] Para: [EMAIL]',
      2,
    );
  });

  it('email with hyphen in domain', () => {
    expectClean('info@mi-empresa.com.ar', '[EMAIL]', 1);
  });

  it('does NOT match partial @ without domain', () => {
    expectUntouched('@solousername');
  });

  it('case-insensitive email', () => {
    expectClean('JUAN@EMPRESA.COM', '[EMAIL]', 1);
  });
});

// ─── Phone numbers ──────────────────────────────────────────────────────────

describe('Phone numbers (AR formats)', () => {
  it('+54 9 11 1234-5678 (mobile international)', () => {
    expectClean('Cel: +54 9 11 1234-5678', 'Cel: [TELEFONO]', 1);
  });

  it('+54 11 4444-5555 (landline international)', () => {
    expectClean('Tel: +54 11 4444-5555', 'Tel: [TELEFONO]', 1);
  });

  it('+54 351 444-5555 (interior city)', () => {
    expectClean('Sucursal +54 351 444-5555', 'Sucursal [TELEFONO]', 1);
  });

  it('+5491112345678 compact international', () => {
    expectClean('WA: +5491112345678', 'WA: [TELEFONO]', 1);
  });

  it('011-4444-5555 (local Buenos Aires landline)', () => {
    expectClean('Llamar al 011-4444-5555', 'Llamar al [TELEFONO]', 1);
  });

  it('0351-444-5555 (Córdoba local)', () => {
    expectClean('Oficina: 0351-444-5555', 'Oficina: [TELEFONO]', 1);
  });

  it('(011) 4444-5555 (parenthesized area code)', () => {
    expectClean('Fax (011) 4444-5555', 'Fax [TELEFONO]', 1);
  });

  it('(0221) 444-5555 (La Plata with parens)', () => {
    expectClean('La Plata (0221) 444-5555', 'La Plata [TELEFONO]', 1);
  });
});

// ─── Mixed PII ───────────────────────────────────────────────────────────────

describe('Mixed PII types', () => {
  it('sentence with DNI + email + phone', () => {
    const input = 'Juan Pérez DNI 12345678, contacto: juan@mail.com, cel +54 9 11 1234-5678.';
    const result = scrubPii(input, 'AR');
    expect(result.clean).toBe('Juan Pérez DNI [DNI], contacto: [EMAIL], cel [TELEFONO].');
    expect(result.redactionsCount).toBe(3);
  });

  it('CUIT + tarjeta + email in same block', () => {
    const input = 'Factura a CUIT 30-12345678-9, CC 4111 1111 1111 1111, email facturas@corp.com';
    const result = scrubPii(input, 'AR');
    expect(result.clean).toBe('Factura a CUIT [CUIT], CC [TARJETA], email [EMAIL]');
    expect(result.redactionsCount).toBe(3);
  });

  it('all types present', () => {
    const input =
      'DNI 20123456, CUIT 20-20123456-7, tarjeta 4111 1111 1111 1111, email a@b.com, tel +54 11 4444-5555';
    const result = scrubPii(input, 'AR');
    expect(result.redactionsCount).toBe(5);
    expect(result.clean).not.toMatch(/\d{8}/);
    expect(result.clean).toContain('[DNI]');
    expect(result.clean).toContain('[CUIT]');
    expect(result.clean).toContain('[TARJETA]');
    expect(result.clean).toContain('[EMAIL]');
    expect(result.clean).toContain('[TELEFONO]');
  });

  it('empty string returns untouched', () => {
    expectClean('', '', 0);
  });

  it('text with no PII is returned unchanged', () => {
    expectUntouched('Hola! Cómo puedo ayudarte hoy?');
  });

  it('repeated calls on same text are idempotent', () => {
    const text = 'DNI 12345678';
    const first = scrubPii(text, 'AR');
    const second = scrubPii(first.clean, 'AR');
    // After first scrub, [DNI] has no digits → second scrub finds nothing
    expect(second.clean).toBe(first.clean);
    expect(second.redactionsCount).toBe(0);
  });

  it('plain number that is NOT 8 digits is not caught as DNI', () => {
    expectUntouched('Código de pedido: 1234');
  });

  it('year 2024 is not matched', () => {
    expectUntouched('Año 2024 fue bueno');
  });
});

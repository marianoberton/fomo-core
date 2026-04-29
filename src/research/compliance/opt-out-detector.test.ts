import { describe, it, expect } from 'vitest';
import { isOptOutMessage } from './opt-out-detector.js';

// ─── True positives (must detect as opt-out) ──────────────────────

describe('isOptOutMessage — true positives', () => {
  const cases: Array<[string, string]> = [
    ['/baja command', '/baja'],
    ['/baja with text after', '/baja por favor'],
    ['no quiero más mensajes', 'no quiero más mensajes'],
    ['no quiero mensajes (no accent)', 'no quiero mas mensajes'],
    ['no quiero más contacto', 'no quiero más contacto'],
    ['no quiero más comunicaciones', 'no quiero más comunicaciones'],
    ['no quiero llamadas', 'no quiero llamadas'],
    ['no me contacten', 'no me contacten'],
    ['no me llamen', 'no me llamen'],
    ['no me escriban', 'no me escriban'],
    ['no me molesten', 'no me molesten'],
    ['dejen de contactarme', 'dejen de contactarme'],
    ['deje de llamarme', 'deje de llamarme'],
    ['dejen de escribirme', 'dejen de escribirme'],
    ['dejen de molestarme', 'dejen de molestarme'],
    ['dejen de enviarme mensajes', 'dejen de enviarme mensajes'],
    ['quiero darme de baja', 'quiero darme de baja'],
    ['darme de baja', 'por favor darme de baja'],
    ['no deseo recibir más', 'no deseo recibir más'],
    ['no deseo ser contactado', 'no deseo ser contactado'],
    ['eliminen mi número', 'eliminen mi número'],
    ['eliminen mi dato', 'eliminen mi dato'],
    ['eliminen mi cuenta', 'eliminen mi cuenta'],
    ['saquen mi número', 'saquen mi número'],
    ['bórrenme', 'bórrenme de su lista'],
    ['borrenme', 'borrenme por favor'],
    ['borren mi número', 'borren mi número'],
    ['no autorizo', 'no autorizo este contacto'],
    ['voy a bloquearte', 'voy a bloquearte'],
    ['voy a bloquearlos', 'voy a bloquearlos'],
    ['no me interesa más el servicio', 'no me interesa más el servicio'],
    ['no me interesa más esto', 'no me interesa más esto'],
    ['no me interesa más sus mensajes', 'no me interesa más sus mensajes'],
    ['STOP standalone uppercase', 'STOP'],
    ['stop standalone lowercase', 'stop'],
    ['stop with punctuation', 'stop!'],
    ['stop with whitespace', '  stop  '],
    ['unsubscribe standalone', 'unsubscribe'],
    ['opt-out standalone', 'opt-out'],
    ['opt out standalone', 'opt out'],
    ['optout standalone', 'optout'],
    ['no quiero que me contacten', 'no quiero que me contacten'],
    ['no deseo que me llamen', 'no deseo que me llamen'],
    ['no me manden mensajes', 'no me manden mensajes'],
    ['embedded in longer message', 'Hola buen día, no quiero más mensajes gracias'],
    ['case insensitive /BAJA', '/BAJA'],
    ['mixed case No Quiero', 'No Quiero Más Mensajes'],
  ];

  for (const [label, text] of cases) {
    it(label, () => {
      expect(isOptOutMessage(text)).toBe(true);
    });
  }
});

// ─── True negatives (must NOT be flagged as opt-out) ──────────────

describe('isOptOutMessage — true negatives', () => {
  const cases: Array<[string, string]> = [
    ['regular greeting', 'hola, buenos días'],
    ['product inquiry', 'quiero más información sobre sus productos'],
    ['wants more info', 'quiero más fotos del departamento'],
    ['price question', 'cuánto cuesta?'],
    ['simple no', 'no'],
    ['no in context', 'no, no es lo que busco'],
    ['baja as noun unrelated', 'la temperatura bajó mucho'],
    ['contact as noun', 'tengo el contacto de Juan'],
    ['llamar as other context', 'me pueden llamar mañana para coordinar?'],
    ['eliminar product', 'quiero eliminar el pedido anterior'],
    ['service request', 'deseo recibir información sobre precios'],
    ['stop in longer sentence is not opt-out', 'the bus stop is nearby'],
    ['please stop without context is fine (would need standalone)', 'please stop sending info'],
  ];

  for (const [label, text] of cases) {
    it(label, () => {
      expect(isOptOutMessage(text)).toBe(false);
    });
  }
});

describe('isOptOutMessage — edge cases', () => {
  it('empty string returns false', () => {
    expect(isOptOutMessage('')).toBe(false);
  });

  it('whitespace-only returns false', () => {
    expect(isOptOutMessage('   ')).toBe(false);
  });

  it('multi-line message with opt-out detected', () => {
    const msg = 'Gracias por contactarme.\nNo quiero más mensajes.\nHasta luego.';
    expect(isOptOutMessage(msg)).toBe(true);
  });

  it('very long message without opt-out', () => {
    const msg = 'a'.repeat(500);
    expect(isOptOutMessage(msg)).toBe(false);
  });
});

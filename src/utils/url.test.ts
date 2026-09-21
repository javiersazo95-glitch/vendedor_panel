import { describe, expect, it } from 'vitest';
import { encId, esUrlDePasarela } from './url';

describe('encId', () => {
  it('deja igual un id numerico o alfanumerico normal', () => {
    expect(encId(123)).toBe('123');
    expect(encId('abc-123')).toBe('abc-123');
  });

  it('escapa caracteres que alterarian la ruta o el query de la URL', () => {
    expect(encId('a/b')).toBe('a%2Fb');
    expect(encId('a?b=c')).toBe('a%3Fb%3Dc');
    expect(encId('a#b')).toBe('a%23b');
  });
});

describe('esUrlDePasarela (SEC-MARKET-C07)', () => {
  it('acepta la pasarela real, en sandbox y en producción', () => {
    expect(esUrlDePasarela('https://sandbox.flow.cl/app/web/pay.php?token=abc')).toBe(true);
    expect(esUrlDePasarela('https://www.flow.cl/app/web/pay.php?token=abc')).toBe(true);
    expect(esUrlDePasarela('https://flow.cl/pagar')).toBe(true);
  });

  it('rechaza un dominio que sólo se parece al de la pasarela', () => {
    // El caso que hace insuficiente un "contiene": ambos llevan la cadena flow.cl.
    expect(esUrlDePasarela('https://evilflow.cl/pagar')).toBe(false);
    expect(esUrlDePasarela('https://flow.cl.attacker.com/pagar')).toBe(false);
  });

  it('rechaza lo que no sea https, y lo que no sea una URL', () => {
    expect(esUrlDePasarela('http://www.flow.cl/pagar')).toBe(false);
    expect(esUrlDePasarela('javascript:alert(1)')).toBe(false);
    expect(esUrlDePasarela('')).toBe(false);
    expect(esUrlDePasarela('no-es-una-url')).toBe(false);
  });
});

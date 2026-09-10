import { describe, expect, it } from 'vitest';
import { formatRut, isValidRut } from './rut';

describe('formatRut', () => {
  it('deja el RUT como se escribe en Chile', () => {
    expect(formatRut('183281232')).toBe('18.328.123-2');
    expect(formatRut('18328123-2')).toBe('18.328.123-2');
  });

  it('acepta la K del dígito verificador', () => {
    expect(formatRut('12345678k')).toBe('12.345.678-K');
  });

  it('no rompe mientras se escribe', () => {
    expect(formatRut('')).toBe('');
    expect(formatRut('1')).toBe('1');
    expect(formatRut('12')).toBe('1-2');
  });
});

describe('isValidRut', () => {
  it('acepta un RUT con dígito verificador correcto', () => {
    expect(isValidRut('18.328.123-2')).toBe(true);
  });

  /**
   * El caso que importa: 12.345.678-9 tiene formato válido y dígito equivocado. Es el RUT que
   * cualquiera inventa para salir del paso, y si pasa, el cobro ocurre igual y después queda
   * una factura que no se puede emitir.
   */
  it('rechaza un RUT con formato válido y dígito equivocado', () => {
    expect(isValidRut('12.345.678-9')).toBe(false);
  });

  it('rechaza lo que ni siquiera es un RUT', () => {
    expect(isValidRut('')).toBe(false);
    expect(isValidRut('123')).toBe(false);
  });
});

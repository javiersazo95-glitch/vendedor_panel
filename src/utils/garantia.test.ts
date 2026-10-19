import { describe, expect, it } from 'vitest';
import { GARANTIA_OPCIONES, esGarantiaPredefinida, normalizarGarantia } from './garantia';

describe('garantia del producto', () => {
  it('parte en la garantia legal de 6 meses', () => {
    expect(GARANTIA_OPCIONES[0]).toBe('6 meses (garantía legal)');
  });

  it('normaliza espacios como el backend', () => {
    expect(normalizarGarantia('  18   meses\n')).toBe('18 meses');
    expect(normalizarGarantia(undefined)).toBe('');
  });

  it('distingue una opcion del desplegable de un texto escrito con "Otro"', () => {
    expect(esGarantiaPredefinida('1 año')).toBe(true);
    expect(esGarantiaPredefinida(' 2 años ')).toBe(true);
    expect(esGarantiaPredefinida('18 meses o 50.000 km')).toBe(false);
    expect(esGarantiaPredefinida('')).toBe(false);
  });
});

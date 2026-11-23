import { describe, expect, it } from 'vitest';
import { CONDICIONES_PRODUCTO, condicionDesdeTexto, esUsadoOReacondicionado } from './condicionProducto';

describe('condición del producto', () => {
  it('reconoce los cuatro valores y los alias que escriben las tiendas', () => {
    for (const { valor, etiqueta } of CONDICIONES_PRODUCTO) {
      expect(condicionDesdeTexto(valor)).toBe(valor);
      expect(condicionDesdeTexto(etiqueta)).toBe(valor);
    }
    expect(condicionDesdeTexto('alt')).toBe('ALTERNATIVO');
    expect(condicionDesdeTexto('Segunda  mano')).toBe('USADO');
    expect(condicionDesdeTexto('Desarmaduría')).toBe('USADO');
    expect(condicionDesdeTexto('remanufacturada')).toBe('REACONDICIONADO');
  });

  it('un texto desconocido no se asume nuevo', () => {
    expect(condicionDesdeTexto('como nueva')).toBeNull();
    expect(condicionDesdeTexto('NUEVO')).toBeNull();
    expect(condicionDesdeTexto('')).toBeNull();
  });

  it('distingue lo que lleva aviso', () => {
    expect(esUsadoOReacondicionado('USADO')).toBe(true);
    expect(esUsadoOReacondicionado('ORIGINAL')).toBe(false);
  });
});

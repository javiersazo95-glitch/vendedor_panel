import { describe, expect, it } from 'vitest';

import {
  detectarBandas,
  detectarFilasNoRepuesto,
  detectarSegundaTabla,
} from './plantillaFilas';

const ENCABEZADO = ['sku', 'nombre', 'marca', 'categoria', 'precio', 'stock'];
/** La columna del código: es la que un subtotal nunca trae. */
const CODIGO = [0];

describe('detectarFilasNoRepuesto', () => {
  it('reconoce el subtotal y el total general de una lista impresa', () => {
    const fuera = detectarFilasNoRepuesto([
      ['PF-201', 'Pastilla freno', 'Bosch', 'Frenos', 24990, 12],
      ['', 'SUBTOTAL FRENOS', '', '', 46980, 20],
      ['', 'TOTAL GENERAL', '', '', 53970, 50],
    ], ENCABEZADO, CODIGO);
    expect(fuera.map((f) => f.indice)).toEqual([1, 2]);
    expect(fuera[0].motivo).toBe('totales');
  });

  it('reconoce el encabezado repetido a mitad de tabla', () => {
    const fuera = detectarFilasNoRepuesto([
      ['PF-201', 'Pastilla freno', 'Bosch', 'Frenos', 24990, 12],
      ['sku', 'nombre', 'marca', 'categoria', 'precio', 'stock'],
    ], ENCABEZADO, CODIGO);
    expect(fuera).toHaveLength(1);
    expect(fuera[0].motivo).toBe('encabezado');
  });

  it('no descarta un repuesto que se llama parecido a un total', () => {
    // "Total Flex" es una marca de verdad: lo que delata al subtotal es venir sin código
    // ni nombre propio, no la palabra suelta.
    const fuera = detectarFilasNoRepuesto([
      ['TF-100', 'Amortiguador Total Flex', 'Monroe', 'Suspensión', 45000, 3],
      ['SUB-1', 'Subtotal Kit', 'Bosch', 'Frenos', 9990, 1],
    ], ENCABEZADO, CODIGO);
    expect(fuera).toEqual([]);
  });

  it('no descarta una fila que sólo coincide con el encabezado en una celda', () => {
    const fuera = detectarFilasNoRepuesto([
      ['PF-201', 'marca', 'Bosch', 'Frenos', 24990, 12],
    ], ENCABEZADO, CODIGO);
    expect(fuera).toEqual([]);
  });

  it('sin columna de código no descarta por totales', () => {
    // No habría con qué distinguir un subtotal de un repuesto sin código: mejor no tocar.
    const fuera = detectarFilasNoRepuesto([
      ['', 'SUBTOTAL FRENOS', '', '', 46980, 20],
    ], ENCABEZADO, []);
    expect(fuera).toEqual([]);
  });
});


describe('detectarBandas', () => {
  it('reconoce la fila de una sola celda que titula el grupo', () => {
    const bandas = detectarBandas([
      ['FRENOS'],
      ['PF-201', 'Pastilla freno', 'Bosch', 24990, 12],
      ['FILTROS'],
      ['FA-110', 'Filtro de aceite', 'Mann', 6990, 30],
    ], 5);
    expect(bandas).toEqual([
      { indice: 0, titulo: 'FRENOS' },
      { indice: 2, titulo: 'FILTROS' },
    ]);
  });

  it('una celda sola con números no es un título', () => {
    expect(detectarBandas([['2024'], ['PF-201', 'x', 'y', 1, 2]], 5)).toEqual([]);
  });

  it('en una hoja de dos columnas no se busca nada', () => {
    // Con tan pocas columnas, una fila de una celda es un dato incompleto, no un título.
    expect(detectarBandas([['FRENOS'], ['PF-201', 'Pastilla']], 2)).toEqual([]);
  });
});


describe('detectarSegundaTabla', () => {
  it('reconoce los títulos de un segundo bloque', () => {
    const segunda = detectarSegundaTabla([
      ['PF-201', 'Pastilla freno', 24990, 12],
      ['codigo', 'producto', 'valor', 'cantidad'],
      ['AM-045', 'Amortiguador', 45000, 3],
    ], ['sku', 'nombre', 'precio', 'stock']);
    expect(segunda?.indice).toBe(1);
    expect(segunda?.titulos).toEqual(['codigo', 'producto', 'valor', 'cantidad']);
  });

  it('no confunde un repuesto sin números con unos títulos', () => {
    // Debajo tiene que venir algo con números para que el bloque parezca una tabla.
    expect(detectarSegundaTabla([
      ['PF-201', 'Pastilla freno', 24990, 12],
      ['codigo', 'producto', 'valor', 'cantidad'],
      ['otra', 'fila', 'de', 'texto'],
    ], ['sku', 'nombre', 'precio', 'stock'])).toBeNull();
  });

  it('el encabezado repetido no es una segunda tabla', () => {
    expect(detectarSegundaTabla([
      ['PF-201', 'Pastilla freno', 24990, 12],
      ['sku', 'nombre', 'precio', 'stock'],
      ['FA-110', 'Filtro', 6990, 30],
    ], ['sku', 'nombre', 'precio', 'stock'])).toBeNull();
  });

  it('una hoja de una sola tabla no dispara el aviso', () => {
    expect(detectarSegundaTabla([
      ['PF-201', 'Pastilla freno', 24990, 12],
      ['FA-110', 'Filtro', 6990, 30],
    ], ['sku', 'nombre', 'precio', 'stock'])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { conArreglosPropuestos } from './miExcelDetecciones';
import { ESQUEMA_FALLBACK, autoDetectMapping, reconcileMapping, type UserColumn } from './plantillaMapping';

const cols = (headers: string[]): UserColumn[] =>
  headers.map((h, index) => ({ id: String(index), rawHeader: h, displayHeader: h, index }));

/**
 * Prueba en local del 30-sep: el Excel traía una columna "Foto" con enlaces y el interruptor para
 * usarla venía apagado; un vendedor que no lo encendía publicaba sin fotos sin enterarse.
 */
describe('la columna de fotos del Excel', () => {
  const columnas = cols(['Código', 'Descripción', 'Precio', 'Cant.', 'Foto']);
  const filas = [
    ['T-1', 'Pastilla de freno', '18990', '6', 'https://picsum.photos/id/1071/800/600'],
    ['T-2', 'Filtro de aceite', '5990', '20', 'https://picsum.photos/id/1072/800/600'],
    ['T-3', 'Radiador', '74990', '3', ''],
  ];

  it('si el archivo trae una columna de fotos, se usa sola y no va a la descripción', () => {
    const m = conArreglosPropuestos(autoDetectMapping(columnas), columnas, filas, ESQUEMA_FALLBACK);
    expect(m.columnaFotos).toBe('4');
    expect(m.extras['4']).toBe('ignore');
  });

  it('si el vendedor la apagó, no se vuelve a encender, ni al reutilizar el mapeo', () => {
    const apagada = { ...autoDetectMapping(columnas), columnaFotos: null };
    expect(conArreglosPropuestos(apagada, columnas, filas, ESQUEMA_FALLBACK).columnaFotos).toBeNull();
    const reutilizado = reconcileMapping(apagada, columnas);
    expect(conArreglosPropuestos(reutilizado, columnas, filas, ESQUEMA_FALLBACK).columnaFotos).toBeNull();
  });

  it('sin columna de fotos no se inventa ninguna', () => {
    const sinFotos = cols(['Código', 'Descripción', 'Precio']);
    const m = conArreglosPropuestos(autoDetectMapping(sinFotos), sinFotos, [['T-1', 'Pastilla', '100']], ESQUEMA_FALLBACK);
    expect(m.columnaFotos ?? null).toBeNull();
  });
});

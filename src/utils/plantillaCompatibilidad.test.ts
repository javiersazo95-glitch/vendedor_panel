import { describe, expect, it } from 'vitest';

import { PLANTILLA_COLUMNAS } from './plantillaMapping';
import {
  COLUMNAS_COMPATIBILIDADES,
  detectarSkusRepetidos,
  pareceColumnaDeAplicacion,
  parsearAplicacion,
  separarPorSku,
} from './plantillaCompatibilidad';

const MARCAS = ['Toyota', 'Nissan', 'Chevrolet', 'Land Rover', 'Citroën'];

describe('parsearAplicacion', () => {
  it('parte la aplicación escrita de corrido', () => {
    expect(parsearAplicacion('Toyota Corolla 2014-2020', MARCAS)).toEqual({
      marca: 'Toyota', modelo: 'Corolla', anioDesde: '2014', anioHasta: '2020',
    });
    expect(parsearAplicacion('Nissan V16 1995 a 2010', MARCAS)).toEqual({
      marca: 'Nissan', modelo: 'V16', anioDesde: '1995', anioHasta: '2010',
    });
  });

  it('con un año suelto no inventa el año hasta', () => {
    expect(parsearAplicacion('Chevrolet Sail 2013', MARCAS)).toEqual({
      marca: 'Chevrolet', modelo: 'Sail', anioDesde: '2013', anioHasta: '',
    });
  });

  it('prefiere la marca más larga: "Land Rover" no es "Land"', () => {
    expect(parsearAplicacion('Land Rover Discovery 2016', MARCAS)?.modelo).toBe('Discovery');
  });

  it('reconoce la marca sin acentos ni mayúsculas, como la escribe el vendedor', () => {
    expect(parsearAplicacion('citroen C3 2015-2019', MARCAS)?.marca).toBe('Citroën');
  });

  it('sin marca reconocida devuelve null: inventar una compatibilidad es peor que no declararla', () => {
    expect(parsearAplicacion('Para varios modelos', MARCAS)).toBeNull();
    expect(parsearAplicacion('', MARCAS)).toBeNull();
  });

  it('la columna se ofrece sólo si la mayoría de sus valores se entienden', () => {
    expect(pareceColumnaDeAplicacion(['Toyota Corolla 2014', 'Nissan V16 1998', 'varios'], MARCAS)).toBe(true);
    expect(pareceColumnaDeAplicacion(['varios', 'consultar', 'Toyota Yaris'], MARCAS)).toBe(false);
    expect(pareceColumnaDeAplicacion(['Toyota Yaris'], [])).toBe(false);
  });
});

describe('detectarSkusRepetidos', () => {
  it('cuenta los códigos repetidos y cuántas filas sobran', () => {
    const rows = [['A-1'], ['A-1'], ['A-1'], ['B-2'], ['C-3'], ['C-3']];
    expect(detectarSkusRepetidos(rows, 0)).toEqual({
      skus: 2, filasExtra: 3, ejemplo: { sku: 'A-1', veces: 3 },
    });
  });

  it('sin repeticiones no hay nada que ofrecer', () => {
    expect(detectarSkusRepetidos([['A-1'], ['B-2']], 0)).toEqual({ skus: 0, filasExtra: 0, ejemplo: null });
  });
});

describe('separarPorSku', () => {
  const columnas = [...PLANTILLA_COLUMNAS] as string[];
  const fila = (over: Record<string, string>): string[] => {
    const base: Record<string, string> = {
      nombre_publicado: 'Filtro', categoria: 'Filtros', marca_repuesto: 'Bosch',
      sku_proveedor: 'A-1', precio: '4990', stock: '10', ...over,
    };
    return columnas.map((c) => base[c] ?? '');
  };

  it('deja un repuesto por código y manda el resto a la hoja de compatibilidades', () => {
    const { inventario, compatibilidades } = separarPorSku([
      columnas,
      fila({ compatibilidad_marca: 'Toyota', compatibilidad_modelo: 'Corolla', anio_desde: '2014', anio_hasta: '2016' }),
      fila({ compatibilidad_marca: 'Toyota', compatibilidad_modelo: 'Yaris', anio_desde: '2017', anio_hasta: '2020', referencia_oem: 'OEM-2' }),
      fila({ sku_proveedor: 'B-2', compatibilidad_marca: 'Nissan', compatibilidad_modelo: 'V16' }),
    ]);

    expect(inventario).toHaveLength(3); // encabezados + dos repuestos
    expect(compatibilidades[0]).toEqual([...COLUMNAS_COMPATIBILIDADES]);
    expect(compatibilidades).toHaveLength(2);
    expect(compatibilidades[1]).toEqual(['A-1', 'Toyota', 'Yaris', '2017', '2020', '', 'OEM-2']);
  });

  it('la primera fila de cada código es la que define el repuesto, y lo dice cuando difieren', () => {
    const { inventario, advertencias } = separarPorSku([
      columnas,
      fila({ precio: '4990' }),
      fila({ precio: '9990' }),
    ]);
    expect(inventario[1][columnas.indexOf('precio')]).toBe('4990');
    expect(advertencias[0]).toContain('A-1');
    expect(advertencias[0]).toContain('precio');
  });

  it('sin códigos repetidos la hoja queda sólo con sus títulos y no se escribe', () => {
    const { compatibilidades } = separarPorSku([columnas, fila({}), fila({ sku_proveedor: 'B-2' })]);
    expect(compatibilidades).toHaveLength(1);
  });
});

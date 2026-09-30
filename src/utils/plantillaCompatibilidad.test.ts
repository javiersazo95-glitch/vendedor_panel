import { describe, expect, it } from 'vitest';

import { PLANTILLA_COLUMNAS } from './plantillaMapping';
import {
  COLUMNAS_COMPATIBILIDADES,
  detectarAplicacionesMultiples,
  detectarSkusRepetidos,
  pareceColumnaDeAplicacion,
  parsearAplicacion,
  separarAplicaciones,
  separarPorSku,
} from './plantillaCompatibilidad';

const MARCAS = ['Toyota', 'Nissan', 'Chevrolet', 'Land Rover', 'Citroën', 'Mercedes-Benz', 'GMC', 'Hyundai'];

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

  it('no confunde una columna de marcas con una aplicación escrita de corrido', () => {
    // `marca_vehiculo` viene junto a `modelo_vehiculo` y `ano_vehiculo` en archivos
    // como Plantilla_Carga_Masiva_RepuesTop_1500_pruebas.xlsx.
    expect(pareceColumnaDeAplicacion(['Toyota', 'Nissan', 'Chevrolet'], MARCAS)).toBe(false);
  });
});

describe('parsearAplicacion (Fase 3): lo que antes se leía mal', () => {
  it('una marca con guion o puntos no se come el modelo', () => {
    expect(parsearAplicacion('MERCEDES-BENZ SPRINTER 2010', MARCAS)).toMatchObject({ marca: 'Mercedes-Benz', modelo: 'SPRINTER', anioDesde: '2010' });
    expect(parsearAplicacion('G.M.C. Sierra 2015', MARCAS)).toMatchObject({ marca: 'GMC', modelo: 'Sierra', anioDesde: '2015' });
  });

  it('"2012 en adelante" cierra en el año actual y lo marca como abierto', () => {
    // No en el que viene: el backend exige que el catálogo cubra el año final y el catálogo llega
    // a lo más hasta este año (prueba en local del 30-sep: "Tucson 2016 en adelante" no se publicaba).
    const app = parsearAplicacion('Chevrolet Sail 2012 en adelante', MARCAS);
    expect(app).toMatchObject({ marca: 'Chevrolet', modelo: 'Sail', anioDesde: '2012', abierto: true });
    expect(app?.anioHasta).toBe(String(new Date().getFullYear()));
  });

  it('entiende los años de dos cifras', () => {
    expect(parsearAplicacion('TOYOTA COROLLA 14-18', MARCAS)).toMatchObject({ modelo: 'COROLLA', anioDesde: '2014', anioHasta: '2018' });
    expect(parsearAplicacion("Nissan V16 '98-'02", MARCAS)).toMatchObject({ modelo: 'V16', anioDesde: '1998', anioHasta: '2002' });
    // La cilindrada no es un año.
    expect(parsearAplicacion('Toyota Yaris 1.5 2016', MARCAS)).toMatchObject({ modelo: 'Yaris 1.5', anioDesde: '2016' });
  });

  it('"Todos" y "Universal" no son un modelo: son el repuesto diciendo que sirve para todo', () => {
    expect(parsearAplicacion('Todos', MARCAS)).toMatchObject({ universal: true });
    expect(parsearAplicacion('UNIVERSAL', MARCAS)).toMatchObject({ universal: true });
  });

  it('"Hyundai Accent 2006 2010" son dos años sueltos: desde y hasta', () => {
    expect(parsearAplicacion('Hyundai Accent 2006 2010', MARCAS)).toMatchObject({ modelo: 'Accent', anioDesde: '2006', anioHasta: '2010' });
  });
});

describe('separarAplicaciones (Fase 3): coma, "y" y marca heredada', () => {
  it('la coma separa vehículos y el segundo hereda la marca', () => {
    expect(separarAplicaciones('Toyota Corolla 2014-2018, Yaris 2015-2019', MARCAS))
      .toEqual(['Toyota Corolla 2014-2018', 'Toyota Yaris 2015-2019']);
  });

  it('sin años propios, el modelo heredado también hereda los años', () => {
    expect(separarAplicaciones('Toyota Corolla, Yaris 2012-2016', MARCAS))
      .toEqual(['Toyota Corolla', 'Toyota Yaris 2012-2016']);
    expect(separarAplicaciones('Toyota Corolla 2012-2016, Yaris', MARCAS))
      .toEqual(['Toyota Corolla 2012-2016', 'Toyota Yaris 2012-2016']);
  });

  it('la "y" también separa', () => {
    expect(separarAplicaciones('Toyota Corolla y Yaris 2014', MARCAS))
      .toEqual(['Toyota Corolla', 'Toyota Yaris 2014']);
  });

  it('detrás de una barra no se hereda nada, salvo que el modelo sea conocido', () => {
    expect(separarAplicaciones('Toyota Corolla / Yaris 2012', MARCAS)).toEqual(['Toyota Corolla / Yaris 2012']);
    const modelos = (marca: string) => (marca === 'Toyota' ? ['Corolla', 'Yaris'] : []);
    expect(separarAplicaciones('Toyota Corolla / Yaris 2012', MARCAS, modelos))
      .toEqual(['Toyota Corolla', 'Toyota Yaris 2012']);
  });

  it('sin ninguna marca no hay de dónde heredar: la celda queda entera', () => {
    expect(separarAplicaciones('Yaris/Corolla 2012', MARCAS)).toEqual(['Yaris/Corolla 2012']);
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

describe('separarAplicaciones', () => {
  it('separa los vehículos escritos con barra', () => {
    expect(separarAplicaciones('Toyota Corolla 2014-2018 / Nissan V16 1995-2008', MARCAS))
      .toEqual(['Toyota Corolla 2014-2018', 'Nissan V16 1995-2008']);
  });

  it('separa los vehículos escritos en varias líneas o con punto y coma', () => {
    expect(separarAplicaciones('Toyota Corolla\nNissan V16', MARCAS))
      .toEqual(['Toyota Corolla', 'Nissan V16']);
    expect(separarAplicaciones('Toyota Corolla; Nissan V16', MARCAS))
      .toEqual(['Toyota Corolla', 'Nissan V16']);
  });

  it('no parte el rango de años escrito con barra', () => {
    // "2014/2018" son los años de un solo auto: partirlo inventaría un segundo repuesto.
    expect(separarAplicaciones('Toyota Corolla 2014/2018', MARCAS))
      .toEqual(['Toyota Corolla 2014/2018']);
  });

  it('deja entera la celda cuando alguno de los trozos no es un vehículo', () => {
    expect(separarAplicaciones('Toyota Corolla / delantero', MARCAS))
      .toEqual(['Toyota Corolla / delantero']);
  });

  it('la celda con un solo vehículo devuelve un elemento, y la vacía ninguno', () => {
    expect(separarAplicaciones('Toyota Corolla 2014-2018', MARCAS)).toHaveLength(1);
    expect(separarAplicaciones('   ', MARCAS)).toEqual([]);
  });
});

describe('detectarAplicacionesMultiples', () => {
  it('cuenta las celdas con varios autos y guarda la más larga como ejemplo', () => {
    const hallazgo = detectarAplicacionesMultiples([
      'Toyota Corolla 2014-2018',
      'Toyota Corolla / Nissan V16',
      'Toyota Yaris / Nissan Tiida / Chevrolet Sail',
    ], MARCAS);
    expect(hallazgo.celdas).toBe(2);
    expect(hallazgo.vehiculos).toBe(5);
    expect(hallazgo.ejemplo?.vehiculos).toHaveLength(3);
  });

  it('no propone nada cuando cada celda trae un solo auto', () => {
    expect(detectarAplicacionesMultiples(['Toyota Corolla', 'Nissan V16'], MARCAS).celdas).toBe(0);
  });
});

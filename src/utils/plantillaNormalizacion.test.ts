import { describe, expect, it } from 'vitest';

import {
  agruparCambios,
  limpiarTexto,
  numeroConUnidad,
  normalizarCelda,
  normalizarSiNo,
  numeroLimpio,
  pareceColumnaDeRangos,
  partirRangoAnios,
  limiteDeColumna,
  validarValorFijo,
} from './plantillaNormalizacion';

describe('numeroLimpio', () => {
  it('deja el precio chileno como lo espera el backend', () => {
    expect(numeroLimpio('$ 12.900')).toBe('12900');
    expect(numeroLimpio('  4990 CLP')).toBe('4990');
    expect(numeroLimpio('1.234,50')).toBe('1234.5');
  });

  it('no toca lo que ya está limpio', () => {
    expect(numeroLimpio('4990')).toBe('4990');
  });

  it('devuelve null cuando no hay número que rescatar', () => {
    expect(numeroLimpio('a convenir')).toBeNull();
  });
});

describe('partirRangoAnios', () => {
  it('entiende las formas en que se escribe un rango en una lista de repuestos', () => {
    expect(partirRangoAnios('2014-2020')).toEqual({ desde: '2014', hasta: '2020' });
    expect(partirRangoAnios('2014 a 2020')).toEqual({ desde: '2014', hasta: '2020' });
    expect(partirRangoAnios('2014 al 2020')).toEqual({ desde: '2014', hasta: '2020' });
    expect(partirRangoAnios('2014/2020')).toEqual({ desde: '2014', hasta: '2020' });
    expect(partirRangoAnios('2014 – 2020')).toEqual({ desde: '2014', hasta: '2020' });
  });

  it('un año suelto no es un rango: no hay nada que dividir', () => {
    expect(partirRangoAnios('2014')).toBeNull();
    expect(partirRangoAnios('varios')).toBeNull();
  });

  it('detecta la columna con que una sola celda traiga un rango', () => {
    expect(pareceColumnaDeRangos(['2014', '', '2016-2019'])).toBe(true);
    expect(pareceColumnaDeRangos(['2014', '2016'])).toBe(false);
  });
});

describe('normalizarSiNo', () => {
  it('la X de la planilla es un sí', () => {
    expect(normalizarSiNo('x')).toBe('SI');
    expect(normalizarSiNo('X')).toBe('SI');
    expect(normalizarSiNo('1')).toBe('SI');
    expect(normalizarSiNo('verdadero')).toBe('SI');
  });

  it('reconoce el no y deja pasar lo que no entiende', () => {
    expect(normalizarSiNo('no')).toBe('NO');
    expect(normalizarSiNo('0')).toBe('NO');
    expect(normalizarSiNo('a veces')).toBeNull();
    expect(normalizarSiNo('')).toBeNull();
  });
});

describe('limpiarTexto', () => {
  it('recorta y colapsa los espacios de copiar y pegar', () => {
    expect(limpiarTexto('  Filtro   de  aceite ')).toBe('Filtro de aceite');
  });
});

describe('normalizarCelda', () => {
  it('limpia el precio y reporta el cambio', () => {
    const r = normalizarCelda('precio', '$ 12.900');
    expect(r.valor).toBe('12900');
    expect(r.cambio).toEqual({ columna: 'precio', antes: '$ 12.900', despues: '12900' });
  });

  it('lleva la X a SI en las columnas de sí/no', () => {
    expect(normalizarCelda('requiere_chasis', 'x').valor).toBe('SI');
    expect(normalizarCelda('compatibilidad_general', 'X').valor).toBe('SI');
  });

  it('lo que no se puede interpretar se deja tal cual: no se inventa nada', () => {
    const r = normalizarCelda('precio', 'a convenir');
    expect(r.valor).toBe('a convenir');
    expect(r.cambio).toBeUndefined();
  });

  it('no reporta cambio cuando no cambió nada', () => {
    expect(normalizarCelda('nombre_publicado', 'Filtro de aceite').cambio).toBeUndefined();
  });
});

describe('agruparCambios', () => {
  it('cuenta cuántas filas tuvieron el mismo arreglo, de mayor a menor', () => {
    const cambios = [
      { columna: 'precio', antes: '$ 1.000', despues: '1000' },
      { columna: 'precio', antes: '$ 1.000', despues: '1000' },
      { columna: 'stock', antes: ' 5 ', despues: '5' },
    ];
    expect(agruparCambios(cambios)).toEqual([
      { columna: 'precio', antes: '$ 1.000', despues: '1000', filas: 2 },
      { columna: 'stock', antes: ' 5 ', despues: '5', filas: 1 },
    ]);
  });
});

describe('limites de lo que el vendedor escribe a mano', () => {
  it('un valor vacío no es un error: significa que no hay valor fijo', () => {
    expect(validarValorFijo('nombre_publicado', '')).toBeNull();
    expect(validarValorFijo('stock', '   ')).toBeNull();
  });

  it('corta por el largo real de la columna del backend', () => {
    expect(limiteDeColumna('nombre_publicado').maxLength).toBe(180);
    expect(limiteDeColumna('sku_proveedor').maxLength).toBe(120);
    expect(validarValorFijo('sku_proveedor', 'x'.repeat(121), 'SKU')).toMatch(/no puede pasar de 120/);
    expect(validarValorFijo('sku_proveedor', 'x'.repeat(120))).toBeNull();
  });

  it('una columna que el panel no conoce igual tiene tope', () => {
    expect(limiteDeColumna('columna_nueva_del_backend').maxLength).toBe(120);
  });

  it('en las columnas numéricas no deja pasar texto ni negativos', () => {
    expect(validarValorFijo('stock', 'varios', 'Stock')).toBe('Stock tiene que ser un número.');
    expect(validarValorFijo('precio', '-100', 'Precio')).toBe('Precio no puede ser negativo.');
    // El formato chileno sí se acepta: es el mismo que entiende el resto del flujo.
    expect(validarValorFijo('precio', '$ 12.900')).toBeNull();
    expect(validarValorFijo('stock', '10')).toBeNull();
  });

  it('el año tiene que ser un año, no cualquier número', () => {
    expect(validarValorFijo('anio_desde', '14', 'Año desde')).toMatch(/4 cifras/);
    expect(validarValorFijo('anio_desde', '1800', 'Año desde')).toMatch(/entre 1900/);
    expect(validarValorFijo('anio_desde', '2014')).toBeNull();
  });
});

describe('numeroConUnidad', () => {
  it('recorta la unidad escrita al lado del número', () => {
    expect(numeroConUnidad('45.000 c/u')).toBe('45000');
    expect(numeroConUnidad('3 unid')).toBe('3');
    expect(numeroConUnidad('10 pzas')).toBe('10');
    expect(numeroConUnidad('12 unidades disponibles')).toBe('12');
  });

  it('no inventa un número donde no hay ninguno', () => {
    // Recortar letras hasta que quede algo sería peor que no interpretar: un precio
    // "CONSULTAR" convertido en cero se publica mal y nadie lo nota.
    expect(numeroConUnidad('CONSULTAR')).toBeNull();
    expect(numeroConUnidad('SIN STOCK')).toBeNull();
    expect(numeroConUnidad('')).toBeNull();
  });

  it('deja pasar los números que ya se entendían', () => {
    expect(numeroConUnidad('$24.990')).toBe('24990');
    expect(numeroConUnidad('1.234,50')).toBe('1234.5');
  });
});

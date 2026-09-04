import { describe, expect, it } from 'vitest';

import {
  agruparCambios,
  limpiarTexto,
  normalizarCelda,
  normalizarSiNo,
  numeroLimpio,
  pareceColumnaDeRangos,
  partirRangoAnios,
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

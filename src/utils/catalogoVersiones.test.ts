import { describe, expect, it } from 'vitest';
import { aniosPermitidos, motorDelCatalogo, motoresPermitidos, rangoCompleto, versionesDelModelo, type VersionCatalogo } from './catalogoVersiones';
import { problemasDeCatalogo } from './miExcelTabla';

/** Un Yaris con dos generaciones en el catálogo, con un hueco entre 2014 y 2015. */
const yaris: VersionCatalogo[] = [
  { id: 1, modelo: 'Yaris', anioDesde: 2008, anioHasta: 2013, motor: '1.3' },
  { id: 2, modelo: 'Yaris', anioDesde: 2008, anioHasta: 2013, motor: '1.5' },
  { id: 3, modelo: 'Yaris', anioDesde: 2015, anioHasta: 2019, motor: '1.5 DUAL VVT-i' },
];

describe('Años y motores del catálogo', () => {
  it('sólo ofrece los años en que el modelo existe', () => {
    const anios = aniosPermitidos(yaris);
    expect(anios[0]).toBe('2019');
    expect(anios).toContain('2008');
    expect(anios).not.toContain('2014');
    expect(anios).not.toContain('2020');
  });

  it('"todos los años del modelo" va del primero al último del catálogo', () => {
    expect(rangoCompleto(yaris)).toEqual({ desde: '2008', hasta: '2019' });
    expect(rangoCompleto([])).toBeNull();
  });

  it('los motores dependen de los años de la fila', () => {
    expect(motoresPermitidos(yaris)).toEqual(['1.3', '1.5', '1.5 DUAL VVT-i']);
    expect(motoresPermitidos(yaris, '2016', '2018')).toEqual(['1.5 DUAL VVT-i']);
    expect(motorDelCatalogo('1.5 dual vvt-i', motoresPermitidos(yaris))).toBe('1.5 DUAL VVT-i');
  });

  it('resuelve equivalencias de motor canónicas como 1.4 vs 1.400 y cc', () => {
    const motores = ['1.400', '1.500'];
    expect(motorDelCatalogo('1.4', motores)).toBe('1.400');
    expect(motorDelCatalogo('1.400', motores)).toBe('1.400');
    expect(motorDelCatalogo('1400 cc', motores)).toBe('1.400');
    expect(motorDelCatalogo('1.4L', motores)).toBe('1.400');
    expect(motorDelCatalogo('1.6', motores)).toBeNull();
  });
});

describe('Lo que el catálogo no acepta, marcado antes de publicar', () => {
  const columnas = ['compatibilidad_general', 'compatibilidad_marca', 'compatibilidad_modelo', 'anio_desde', 'anio_hasta', 'motor'];
  const fila = (valores: string[]) => ({ numeroFila: 2, clave: '0', valores, problemas: [], tieneError: false });
  const versionesDe = (_marca: string, modelo: string) => (modelo === 'Yaris' ? yaris : modelo === 'Fantasma' ? [] : undefined);

  it('un año en que el modelo no existe impide publicar, y dice qué años hay', () => {
    const [p] = problemasDeCatalogo(fila(['NO', 'Toyota', 'Yaris', '2014', '2014', '']), columnas, versionesDe);
    expect(p).toMatchObject({ columna: 'anio_desde', severidad: 'error' });
    expect(p.mensaje).toMatch(/2008 a 2019/);
  });

  it('un motor que no está en el catálogo es un aviso: se publica para todas las versiones', () => {
    expect(problemasDeCatalogo(fila(['NO', 'Toyota', 'Yaris', '2016', '2018', '2.0 TURBO']), columnas, versionesDe))
      .toEqual([expect.objectContaining({ columna: 'motor', severidad: 'aviso' })]);
  });

  it('sólo cuentan las versiones del modelo exacto: "3" no toma las del "323"', () => {
    const mazda: VersionCatalogo[] = [
      { id: 7, modelo: '323', anioDesde: 1977, anioHasta: 2004, motor: '1.6' },
      { id: 8, modelo: 'Mazda3', anioDesde: 2014, anioHasta: 2018, motor: '2.0' },
    ];
    expect(versionesDelModelo(mazda, '3')).toEqual([]);
    expect(versionesDelModelo(mazda, 'MAZDA3').map((v) => v.id)).toEqual([8]);
  });

  it('un modelo sin versiones impide publicar; uno universal o sin datos no se revisa', () => {
    expect(problemasDeCatalogo(fila(['NO', 'Toyota', 'Fantasma', '2016', '', '']), columnas, versionesDe)[0])
      .toMatchObject({ columna: 'compatibilidad_modelo', severidad: 'error' });
    expect(problemasDeCatalogo(fila(['SI', 'Toyota', 'Yaris', '1990', '', '']), columnas, versionesDe)).toEqual([]);
    expect(problemasDeCatalogo(fila(['NO', 'Toyota', 'Corolla', '1990', '', '']), columnas, versionesDe)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { claveCatalogo, marcaCanonica, mismoNombreCatalogo, nombresUnicosOrdenados } from './nombresCatalogoVehiculo';
import { parsearAplicacion } from './plantillaCompatibilidad';
import { MARCAS_VEHICULO_BASE } from './marcasVehiculoBase';

/**
 * Fase 5 del plan de auditoría de carga: un solo nombre por marca y modelo de vehículo, con la
 * misma regla que el backend (`NombreCatalogo.clave` y la tabla de alias).
 */
describe('nombres del catálogo de vehículos', () => {
  it('la lista de modelos no repite el mismo auto escrito distinto y queda en orden', () => {
    const modelos = nombresUnicosOrdenados(['Mazda2', 'CX-5', 'Mazda 2', 'CX5', 'BT-50', 'MAZDA2', 'Mazda6', 'mazda3']);

    expect(modelos).toEqual(['BT-50', 'CX-5', 'Mazda2', 'mazda3', 'Mazda6']);
  });

  it('modelos distintos del SII siguen siendo opciones distintas', () => {
    expect(nombresUnicosOrdenados(['Corolla Sedan', 'Corolla', 'Corolla GR'])).toEqual([
      'Corolla',
      'Corolla GR',
      'Corolla Sedan',
    ]);
  });

  it('ordena los números como los lee una persona', () => {
    expect(nombresUnicosOrdenados(['2008', '301', '208', '3008'])).toEqual(['208', '301', '2008', '3008']);
  });

  it('descarta vacíos y recorta espacios', () => {
    expect(nombresUnicosOrdenados(['  Rio ', '', 'RIO', '   '])).toEqual(['Rio']);
  });

  it('la clave es la del backend', () => {
    expect(claveCatalogo('Mercedes-Benz')).toBe('mercedesbenz');
    expect(claveCatalogo('MERCEDES BENZ')).toBe('mercedesbenz');
    expect(claveCatalogo('Citroën')).toBe('citroen');
  });

  it('las marcas del padrón llevan al nombre del catálogo', () => {
    expect(marcaCanonica('KIA MOTORS')).toBe('Kia');
    expect(marcaCanonica('Sanyang SYM')).toBe('SYM');
    expect(marcaCanonica('Toyota')).toBe('Toyota');
    expect(mismoNombreCatalogo('Kia', 'KIA MOTORS')).toBe(true);
    expect(mismoNombreCatalogo('Mercedes-Benz', 'MERCEDES BENZ')).toBe(true);
    expect(mismoNombreCatalogo('Kia', 'Toyota')).toBe(false);
  });

  it('"KIA MOTORS RIO" se lee como la marca Kia y el modelo Rio', () => {
    expect(parsearAplicacion('KIA MOTORS RIO 2015-2018', ['Kia', 'Toyota'])).toEqual({
      marca: 'Kia',
      modelo: 'RIO',
      anioDesde: '2015',
      anioHasta: '2018',
    });
    // Sin la marca en el catálogo, el alias no inventa nada.
    expect(parsearAplicacion('KIA MOTORS RIO 2015', ['Toyota'])).toBeNull();
  });

  it('la lista de respaldo usa la escritura oficial de las marcas que van en mayúsculas', () => {
    const oficiales = ['SEAT', 'MINI', 'SAAB', 'IVECO', 'KYMCO', 'QJMOTOR', 'FLSTF', 'CFMOTO'];
    expect(MARCAS_VEHICULO_BASE).toEqual(expect.arrayContaining(oficiales));
    expect(MARCAS_VEHICULO_BASE).not.toEqual(expect.arrayContaining(['Seat']));
    expect(MARCAS_VEHICULO_BASE).not.toContain('CF Moto');
    expect(nombresUnicosOrdenados(MARCAS_VEHICULO_BASE)).toEqual(MARCAS_VEHICULO_BASE);
    expect(parsearAplicacion('Seat Ibiza 2015', MARCAS_VEHICULO_BASE)?.marca).toBe('SEAT');
  });
});

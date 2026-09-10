import { describe, expect, it } from 'vitest';
import type { Product } from '../db';
import { grupoDe, ordenarInventario } from './inventoryOrder';

const AHORA = new Date('2026-09-10T12:00:00Z').getTime();
const enDias = (dias: number) => new Date(AHORA + dias * 86_400_000).toISOString();

const producto = (id: string, extra: Partial<Product> = {}): Product => ({
  id,
  sku: `SKU-${id}`,
  oem: '',
  name: `Repuesto ${id}`,
  category: 'Motor',
  partBrand: '',
  vehicleBrand: '',
  vehicleModel: '',
  vehicleYear: 2020,
  vehicleVersion: '',
  price: 10000,
  stock: 50,
  description: '',
  image: '',
  lastUpdated: '2026-01-01T00:00:00Z',
  activo: true,
  ...extra,
});

const ids = (products: Product[]) => products.map((p) => p.id);

describe('grupoDe', () => {
  it('separa el Top vencido del vigente', () => {
    expect(grupoDe(producto('a', { destacado: true, topHasta: enDias(-1) }), AHORA)).toBe('top-vencido');
    expect(grupoDe(producto('b', { destacado: true, topHasta: enDias(5) }), AHORA)).toBe('top-vigente');
  });

  it('manda a atención lo que nadie puede comprar', () => {
    expect(grupoDe(producto('a', { stock: 0 }), AHORA)).toBe('atencion');
    expect(grupoDe(producto('b', { pausado: true }), AHORA)).toBe('atencion');
  });

  /**
   * El stock bajo tiene grupo propio y no cae en "atención". Con un catálogo real (149 repuestos,
   * 54 bajo 10 unidades) meterlo ahí marcaba como urgente a más de un tercio del inventario, y un
   * grupo que ocupa un tercio de la lista ya no señala nada.
   */
  it('el stock bajo va a su propio grupo, no a atención', () => {
    expect(grupoDe(producto('c', { stock: 3 }), AHORA)).toBe('stock-bajo');
  });

  it('deja en el resto lo que está sano', () => {
    expect(grupoDe(producto('a'), AHORA)).toBe('resto');
  });

  /**
   * Un Top sin stock sigue siendo Top: el vendedor pagó por esa posición y hay que dejársela a
   * mano. El badge rojo de "Sin Stock" ya se ve en su fila.
   */
  it('un Top sin stock no se degrada a atención', () => {
    expect(grupoDe(producto('a', { destacado: true, topHasta: enDias(5), stock: 0 }), AHORA)).toBe('top-vigente');
  });
});

describe('ordenarInventario · recomendado', () => {
  it('pone el Top vencido arriba de todo, incluso del Top vigente', () => {
    const { productos } = ordenarInventario([
      producto('sano'),
      producto('vigente', { destacado: true, topHasta: enDias(20) }),
      producto('sinStock', { stock: 0 }),
      producto('bajo', { stock: 4 }),
      producto('vencido', { destacado: true, topHasta: enDias(-2) }),
    ], 'recomendado', AHORA);

    expect(ids(productos)).toEqual(['vencido', 'vigente', 'sinStock', 'bajo', 'sano']);
  });

  /** "Los Top primero" a secas dejaría al que vence mañana en cualquier parte de la lista. */
  it('entre los Top vigentes, primero el que está por vencer', () => {
    const { productos } = ordenarInventario([
      producto('quedan20', { destacado: true, topHasta: enDias(20) }),
      producto('quedan1', { destacado: true, topHasta: enDias(1) }),
      producto('quedan9', { destacado: true, topHasta: enDias(9) }),
    ], 'recomendado', AHORA);

    expect(ids(productos)).toEqual(['quedan1', 'quedan9', 'quedan20']);
  });

  it('dentro de atención, sin stock antes que pausado, y el stock bajo después de los dos', () => {
    const { productos } = ordenarInventario([
      producto('bajo', { stock: 4 }),
      producto('pausado', { pausado: true }),
      producto('sinStock', { stock: 0 }),
    ], 'recomendado', AHORA);

    expect(ids(productos)).toEqual(['sinStock', 'pausado', 'bajo']);
  });

  it('el stock bajo queda entre atención y el resto del inventario', () => {
    const { productos, grupos } = ordenarInventario([
      producto('sano'),
      producto('bajo', { stock: 4 }),
      producto('sinStock', { stock: 0 }),
    ], 'recomendado', AHORA);

    expect(ids(productos)).toEqual(['sinStock', 'bajo', 'sano']);
    expect(grupos.get('bajo')).toBe('stock-bajo');
    expect(grupos.get('sano')).toBe('resto');
  });

  it('desempata por última modificación, que es el orden que el panel tenía siempre', () => {
    const { productos } = ordenarInventario([
      producto('viejo', { lastUpdated: '2026-01-01T00:00:00Z' }),
      producto('nuevo', { lastUpdated: '2026-09-09T00:00:00Z' }),
    ], 'recomendado', AHORA);

    expect(ids(productos)).toEqual(['nuevo', 'viejo']);
  });

  it('etiqueta cada producto con su grupo, para poder dibujar los separadores', () => {
    const { grupos } = ordenarInventario([
      producto('vencido', { destacado: true, topHasta: enDias(-2) }),
      producto('sinStock', { stock: 0 }),
    ], 'recomendado', AHORA);

    expect(grupos.get('vencido')).toBe('top-vencido');
    expect(grupos.get('sinStock')).toBe('atencion');
  });

  it('no muta la lista que recibe', () => {
    const original = [producto('a'), producto('top', { destacado: true, topHasta: enDias(5) })];
    ordenarInventario(original, 'recomendado', AHORA);
    expect(ids(original)).toEqual(['a', 'top']);
  });
});

describe('ordenarInventario · reciente', () => {
  /**
   * Es la salida para el día de la carga masiva: recién subidas 150 filas, lo que el vendedor
   * quiere ver es lo que acaba de subir, no sus productos Top.
   */
  it('ignora los grupos y ordena solo por última modificación', () => {
    const { productos, grupos } = ordenarInventario([
      producto('topViejo', { destacado: true, topHasta: enDias(5), lastUpdated: '2026-01-01T00:00:00Z' }),
      producto('recienCargado', { lastUpdated: '2026-09-09T00:00:00Z' }),
    ], 'reciente', AHORA);

    expect(ids(productos)).toEqual(['recienCargado', 'topViejo']);
    expect(grupos.get('recienCargado')).toBe('todos');
  });

  it('manda al fondo lo que no tiene fecha legible, en vez de darlo por recién modificado', () => {
    const { productos } = ordenarInventario([
      producto('sinFecha', { lastUpdated: 'no es una fecha' }),
      producto('conFecha', { lastUpdated: '2026-05-05T00:00:00Z' }),
    ], 'reciente', AHORA);

    expect(ids(productos)).toEqual(['conFecha', 'sinFecha']);
  });
});

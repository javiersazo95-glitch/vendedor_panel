import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ESQUEMA_FALLBACK } from './plantillaMapping';
import { fetchEsquemaPlantilla, normalizarEsquema } from './plantillaEsquema';

describe('normalizarEsquema', () => {
  it('toma columnas, obligatorias, versión y catálogos de la respuesta del backend', () => {
    const esquema = normalizarEsquema({
      version: '2.1.0',
      columnas: ['nombre_publicado', 'sku_proveedor'],
      columnasObligatorias: ['sku_proveedor'],
      hojaCompatibilidadesColumnas: ['sku_proveedor', 'compatibilidad_marca'],
      catalogos: {
        categorias: ['Frenos'],
        subcategoriasPorCategoria: { Frenos: ['Pastillas'] },
        marcasRepuesto: ['Bosch'],
        marcasVehiculo: ['Toyota'],
        tiposPrecio: ['MOSTRAR_PRECIO'],
        condiciones: ['ORIGINAL', 'ALTERNATIVO'],
      },
    });
    expect(esquema).toMatchObject({
      version: '2.1.0',
      columnas: ['nombre_publicado', 'sku_proveedor'],
      columnasObligatorias: ['sku_proveedor'],
    });
    expect(esquema?.catalogos.subcategoriasPorCategoria).toEqual({ Frenos: ['Pastillas'] });
  });

  it('devuelve null si la respuesta no trae columnas: mejor el respaldo que una pantalla vacía', () => {
    expect(normalizarEsquema({ version: '2.0.0', columnas: [] })).toBeNull();
    expect(normalizarEsquema({ hola: 'mundo' })).toBeNull();
    expect(normalizarEsquema(null)).toBeNull();
  });

  it('completa los enums del contrato cuando el backend no los manda', () => {
    const esquema = normalizarEsquema({ columnas: ['tipo_precio'], catalogos: {} });
    expect(esquema?.catalogos.tiposPrecio).toEqual(ESQUEMA_FALLBACK.catalogos.tiposPrecio);
    expect(esquema?.catalogos.condiciones).toEqual(ESQUEMA_FALLBACK.catalogos.condiciones);
  });
});

describe('fetchEsquemaPlantilla', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('pide el esquema del proveedor con su token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: '2.0.0', columnas: ['sku_proveedor'] }),
    });
    const esquema = await fetchEsquemaPlantilla(7, 'tok');
    expect(fetchMock.mock.calls[0][0]).toContain('/proveedores/7/inventario/excel/esquema');
    expect(esquema?.columnas).toEqual(['sku_proveedor']);
  });

  it('devuelve null si el backend responde con error, para caer al contrato de respaldo', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await fetchEsquemaPlantilla(7, 'tok')).toBeNull();
  });
});

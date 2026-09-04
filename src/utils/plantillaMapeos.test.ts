import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { guardarMapeoRemoto, listarMapeos, mapeoParaFirma, parsearMapeos } from './plantillaMapeos';
import { COLUMN_MAPPINGS_KEY, type Mapping } from './plantillaMapping';

const mapping = (over: Partial<Mapping> = {}): Mapping => ({
  oficial: { sku_proveedor: '0' },
  extras: {},
  valueMap: {},
  ...over,
});

describe('parsearMapeos', () => {
  it('convierte la respuesta del backend en mapeos por firma', () => {
    const mapeos = parsearMapeos([
      { firma: 'codigo|marca', mapeoJson: JSON.stringify(mapping()) },
    ]);
    expect(mapeos['codigo|marca'].oficial.sku_proveedor).toBe('0');
  });

  it('un mapeo corrupto no puede tumbar a los demás', () => {
    const mapeos = parsearMapeos([
      { firma: 'roto', mapeoJson: '{no es json' },
      { firma: 'sano', mapeoJson: JSON.stringify(mapping()) },
      { firma: 'sin oficial', mapeoJson: '{"otra":1}' },
    ]);
    expect(Object.keys(mapeos)).toEqual(['sano']);
  });

  it('una respuesta que no es lista se ignora', () => {
    expect(parsearMapeos({ error: 'boom' })).toEqual({});
  });
});

describe('mapeoParaFirma', () => {
  beforeEach(() => localStorage.clear());

  it('el de la cuenta manda sobre el de este navegador', () => {
    localStorage.setItem(COLUMN_MAPPINGS_KEY, JSON.stringify({ f: mapping({ extras: { '1': 'ignore' } }) }));
    const deLaCuenta = mapping({ extras: { '1': 'descripcion' } });
    expect(mapeoParaFirma({ f: deLaCuenta }, 'f')?.extras['1']).toBe('descripcion');
  });

  it('sin nada en la cuenta cae al de este navegador', () => {
    localStorage.setItem(COLUMN_MAPPINGS_KEY, JSON.stringify({ f: mapping() }));
    expect(mapeoParaFirma({}, 'f')?.oficial.sku_proveedor).toBe('0');
    expect(mapeoParaFirma({}, 'otra')).toBeNull();
  });
});

describe('llamadas al backend', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it('pide los mapeos del proveedor con su token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ firma: 'f', mapeoJson: JSON.stringify(mapping()) }],
    });
    const mapeos = await listarMapeos(7, 'tok');
    expect(fetchMock.mock.calls[0][0]).toContain('/proveedores/7/inventario/excel/mapeos');
    expect(Object.keys(mapeos)).toEqual(['f']);
  });

  it('un backend que no responde no deja al vendedor sin mapeos: devuelve vacío', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await listarMapeos(7, 'tok')).toEqual({});
  });

  it('guarda el mapeo como JSON, con la firma y el nombre del archivo', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await guardarMapeoRemoto(7, 'tok', 'f', mapping(), 'mi-lista.xlsx');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PUT');
    const cuerpo = JSON.parse(init.body);
    expect(cuerpo.firma).toBe('f');
    expect(cuerpo.archivoNombre).toBe('mi-lista.xlsx');
    expect(JSON.parse(cuerpo.mapeoJson).oficial.sku_proveedor).toBe('0');
  });
});

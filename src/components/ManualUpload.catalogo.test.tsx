import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Product } from '../db';
import { ManualUpload } from './ManualUpload';

/**
 * SEC-MARKET-A30/A31: las llamadas al catálogo se hacían con `fetch()` crudo, fuera de
 * `apiFetch`, así que quedaban sin el límite de tiempo de la API. Un backend que acepta la
 * conexión y nunca responde dejaba el formulario cargando sin final.
 *
 * La diferencia observable entre los dos caminos es el `AbortSignal`: `apiFetch` lo adjunta
 * para poder cortar en el timeout, y un `fetch()` crudo no lleva ninguno.
 */
describe('ManualUpload: catálogo encaminado por apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('pide el catálogo con un AbortSignal, para que el timeout pueda cortarlo', async () => {
    render(<ManualUpload isOpen onClose={() => {}} onSave={async () => {}} editProduct={null} />);

    const llamadasAlCatalogo = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/v1/catalogos/inventario/'));

    await waitFor(() => expect(llamadasAlCatalogo().length).toBeGreaterThan(0));

    for (const [url, init] of llamadasAlCatalogo()) {
      expect(init?.signal, `sin AbortSignal: ${String(url)}`).toBeInstanceOf(AbortSignal);
    }
  });
});

/**
 * Fase 7 del plan de auditoría de carga: el 1 a 1 no deja callejones sin salida y la edición no
 * pierde los vehículos guardados.
 */
const responder = (rutas: Record<string, unknown>, fallan: string[] = []) =>
  vi.fn(async (url: string) => {
    const texto = String(url);
    if (fallan.some((ruta) => texto.includes(ruta))) return { ok: false, status: 500, json: async () => ({}) };
    const clave = Object.keys(rutas).find((ruta) => texto.includes(ruta));
    return { ok: true, status: 200, json: async () => (clave ? rutas[clave] : []) };
  });

const CATALOGO = {
  'categorias-repuesto': [{ id: 1, nombre: 'Frenos' }],
  'marcas-vehiculo/7/modelos': [{ id: 70, nombre: 'Corolla' }],
  'marcas-vehiculo': [{ id: 7, nombre: 'Toyota' }],
};

const guardado = (extra: Partial<Product> = {}): Product => ({
  id: '8035',
  sku: 'F1-TEST',
  oem: '',
  name: 'Pastillas Yaris y Corolla',
  category: 'Frenos',
  partBrand: 'Bosch',
  vehicleBrand: 'Toyota',
  vehicleModel: 'Corolla',
  vehicleYear: 2018,
  vehicleYearTo: 2018,
  vehicleVersion: '',
  price: 19990,
  stock: 3,
  description: 'Pastillas de freno delanteras para Corolla',
  image: '',
  pricingMode: 'show_price',
  vehiculoCatalogoIds: [10, 11],
  compatibilityGroupsJson: JSON.stringify([{ vehiculoCatalogoIds: [10, 11] }]),
  ...extra,
});

describe('ManualUpload: sin callejones y sin perder vehículos (Fase 7)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('una marca que no está en la lista ofrece publicarlo como universal', async () => {
    vi.stubGlobal('fetch', responder(CATALOGO));
    render(<ManualUpload isOpen onClose={() => {}} onSave={async () => {}} editProduct={null} />);

    const marca = await screen.findByLabelText('Marca del vehículo');
    await waitFor(() => expect(marca.querySelectorAll('option').length).toBeGreaterThan(2));
    expect(within(marca).queryByRole('option', { name: 'Otra (escribirla)' })).not.toBeInTheDocument();
    fireEvent.change(marca, { target: { value: '__no_encuentro__' } });
    fireEvent.click(screen.getByRole('button', { name: /Sirve para todos los vehículos/ }));

    expect(screen.getByLabelText('Compatibilidad universal')).toBeChecked();
  });

  it('al editar, si el catálogo no responde, los vehículos guardados se conservan y se guardan igual', async () => {
    vi.stubGlobal('fetch', responder(CATALOGO, ['vehiculo-catalogos', 'versiones']));
    const onSave = vi.fn(async () => {});
    render(<ManualUpload isOpen onClose={() => {}} onSave={onSave} editProduct={guardado()} />);

    expect(await screen.findByText(/No pudimos cargar el detalle de estos vehículos/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [payload] = onSave.mock.calls[0] as unknown as [Product];
    expect(payload.vehiculoCatalogoIds).toEqual([10, 11]);
    expect(await screen.findByText('Listo: guardaste los cambios')).toBeInTheDocument();
  });

  it('si /versiones ya no devuelve una versión guardada, no se descarta', async () => {
    vi.stubGlobal('fetch', responder({
      ...CATALOGO,
      'vehiculo-catalogos': [{ id: 10, marca: 'Toyota', modelo: 'Corolla', anioDesde: 2018, anioHasta: 2018, version: '1.8 GLI' },
        { id: 11, marca: 'Toyota', modelo: 'Corolla', anioDesde: 2018, anioHasta: 2018, version: '1.8 XEI' }],
      versiones: [{ id: 10, nombre: '1.8 GLI' }],
    }));
    const onSave = vi.fn(async () => {});
    render(<ManualUpload isOpen onClose={() => {}} onSave={onSave} editProduct={guardado()} />);

    await screen.findByText('Vehículo 1');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('versiones'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [payload] = onSave.mock.calls[0] as unknown as [Product];
    expect(payload.vehiculoCatalogoIds).toEqual([10, 11]);
  });

  it('activar universal no borra los vehículos: los oculta, avisa y vuelven al desactivarlo', async () => {
    vi.stubGlobal('fetch', responder({
      ...CATALOGO,
      'vehiculo-catalogos': [{ id: 10, marca: 'Toyota', modelo: 'Corolla', anioDesde: 2018, anioHasta: 2018, version: '1.8 GLI' }],
      versiones: [{ id: 10, nombre: '1.8 GLI' }],
    }));
    render(<ManualUpload isOpen onClose={() => {}} onSave={async () => {}} editProduct={guardado({ vehiculoCatalogoIds: [10], compatibilityGroupsJson: undefined })} />);
    await screen.findByText('Vehículo 1');

    const universal = screen.getByLabelText('Compatibilidad universal');
    fireEvent.click(universal);
    expect(screen.queryByText('Vehículo 1')).not.toBeInTheDocument();
    expect(screen.getByText(/Los vehículos que ya elegiste siguen aquí/)).toBeInTheDocument();

    fireEvent.click(universal);
    expect(screen.getByText('Vehículo 1')).toBeInTheDocument();
    expect((screen.getByLabelText('Marca del vehículo') as HTMLSelectElement).value).toBe('Toyota');
  });

  it('una marca de repuesto escrita a mano toma el nombre que ya existe ("bosch" -> "Bosch")', async () => {
    vi.stubGlobal('fetch', responder({ ...CATALOGO, 'marcas-repuesto': [{ id: 1, nombre: 'Bosch' }] }));
    render(<ManualUpload isOpen onClose={() => {}} onSave={async () => {}} editProduct={null} />);

    const marca = screen.getByLabelText('Marca del repuesto');
    fireEvent.change(marca, { target: { value: '__other__' } });
    const escrita = await screen.findByPlaceholderText('Escribe el nombre');
    fireEvent.change(escrita, { target: { value: 'bosch' } });

    expect((screen.getByLabelText('Marca del repuesto') as HTMLSelectElement).value).toBe('Bosch');
  });
});

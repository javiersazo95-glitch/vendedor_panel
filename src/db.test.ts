import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getProductTopSummary, rechargeWallet, saveProductsBatch, setProductTop } from './db';
import { saveSession, clearSession } from './utils/session';

const baseRow = {
  sku: 'SKU-EXISTING',
  oem: '',
  name: 'Producto existente',
  category: 'Motor',
  partBrand: '',
  vehicleBrand: '',
  vehicleModel: '',
  vehicleYear: 2020,
  vehicleVersion: '',
  price: 1000,
  stock: 1,
  description: '',
  image: '',
};

describe('saveProductsBatch', () => {
  beforeEach(() => {
    saveSession({ email: 'a@a.com', role: 'vendedor', token: 'tok', sellerId: 'seller-1' });
  });

  afterEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  it('aborts the whole batch instead of creating duplicates when the existing inventory cannot be verified (ENG-SRC-004)', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network down')));
    vi.stubGlobal('fetch', fetchMock);

    const result = await saveProductsBatch([baseRow], true);

    // The failed inventory check must not be swallowed: no rows should be
    // reported as saved, and every row must surface an explicit error.
    expect(result.success).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/inventario existente/i);

    // Only the getAllProducts() call should have happened — no addProduct/
    // updateProduct call should ever be attempted once the batch is aborted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not reactivate a paused/deactivated product when it gets overwritten by a bulk update', async () => {
    const requests: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      requests.push({ url: String(url), body: init?.body });
      if (String(url).includes('/inventario') && !String(url).match(/\/\d+$/)) {
        // getAllProducts(): one existing product, deactivated.
        return Promise.resolve(new Response(JSON.stringify([
          { id: 42, skuProveedor: 'SKU-EXISTING', nombrePublicado: 'Producto existente', activo: false }
        ]), { status: 200 }));
      }
      // updateProduct() JSON branch (no new image): the PUT to /inventario/{id}.
      return Promise.resolve(new Response(JSON.stringify({ id: 42, skuProveedor: 'SKU-EXISTING', activo: false }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await saveProductsBatch([baseRow], true);

    expect(result.errors).toHaveLength(0);
    const updateCall = requests.find((r) => r.url.match(/\/inventario\/42$/));
    expect(updateCall).toBeDefined();
    const payload = JSON.parse(updateCall!.body as string);
    // The bug: this used to hardcode `activo: true`, silently reactivating a
    // product the seller had deliberately deactivated (ENG-inventario, bug de activo:true).
    expect(payload.activo).toBe(false);
  });

  it('reports the original file row (sourceRow), not the array position, when rows were filtered out during analysis (QA-SRC-009)', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/inventario') && !String(url).includes('personalizado')) {
        // getAllProducts(): empty existing catalog, so every row is a create.
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      // addProduct(): simulate a backend failure for this row.
      return Promise.resolve(new Response(JSON.stringify({ message: 'SKU invalido' }), { status: 400 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    // Row 3 of the original file was dropped during analysis (e.g. duplicate SKU),
    // so productsData only contains what survived — row 4's real sourceRow is 4,
    // not its array index.
    const result = await saveProductsBatch([{ ...baseRow, sku: 'SKU-ROW-4', sourceRow: 4 }], true);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(4);
  });

  it('uses the shared Top endpoints and sends a renewal explicitly', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      void _init;
      if (url.includes('/top/resumen')) return Promise.resolve(new Response(JSON.stringify({ activos: 1, saldoMonedas: 200 }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ id: 7, destacado: true, topHasta: '2026-10-01T00:00:00Z' }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await getProductTopSummary();
    await setProductTop('7', true);
    expect(fetchMock.mock.calls[0][0]).toContain('/inventario/top/resumen');
    expect(fetchMock.mock.calls[1][0]).toContain('/inventario/7/top');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ destacado: true, renovar: true });
  });

  it('registers an inventory-origin recharge then refreshes the authoritative balance', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      void _init;
      if (url.includes('/compras')) return Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
      return Promise.resolve(new Response(JSON.stringify({ saldo: 200 }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(rechargeWallet({ name: 'Pack Medio', coins: 200, amount: 10000 }, 'Webpay Plus / Débito')).resolves.toEqual({ saldo: 200 });
    const purchase = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(purchase).toMatchObject({ cantidadFichas: 200, montoPagado: 10000, origen: 'INVENTARIO' });
  });
});

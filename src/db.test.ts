import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveProductsBatch } from './db';
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
});

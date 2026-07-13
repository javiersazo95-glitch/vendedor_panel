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
});

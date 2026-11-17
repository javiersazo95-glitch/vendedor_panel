import { describe, expect, it } from 'vitest';

import { soloCambiosDePrecio, type AnalisisExpress, type CambioExpress } from './expressPreciosStock';

const cambio = (over: Partial<CambioExpress>): CambioExpress => ({
  fila: 2,
  sku: 'QA-1',
  nombre: 'Repuesto',
  precioAntes: 1000,
  precioDespues: null,
  stockAntes: 2,
  stockDespues: null,
  soloCotizar: false,
  avisos: [],
  ...over,
});

describe('soloCambiosDePrecio (acceso asistido, nivel de precios)', () => {
  it('descarta el stock y deja fuera las filas que solo cambiaban stock', () => {
    const analisis: AnalisisExpress = {
      cambios: [
        cambio({ sku: 'QA-P3-1', precioDespues: 9000, stockDespues: 20 }),
        cambio({ sku: 'SOLO-STOCK', stockDespues: 50 }),
      ],
      retenidas: [],
      noEncontrados: [],
      sinCambios: 1,
    };

    const r = soloCambiosDePrecio(analisis);

    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]).toMatchObject({ sku: 'QA-P3-1', precioDespues: 9000, stockDespues: null });
    expect(r.sinCambios).toBe(2);
  });
});

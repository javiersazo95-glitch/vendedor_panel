import { describe, expect, it } from 'vitest';
import { calculateSellerEarnings, calculateSuggestedPrice, serviceFeeAmount } from '../utils/pricing';

describe('simulador de Vendedor Fundador', () => {
  it('mantiene 5% de comisión RepuesTop (+ IVA) independiente del monto', () => {
    expect(serviceFeeAmount(50_000, true)).toBe(Math.round(50_000 * 0.05 * 1.19) + Math.round(50_000 * 0.0289 * 1.19));
    expect(serviceFeeAmount(500_000, true)).toBe(Math.round(500_000 * 0.05 * 1.19) + Math.round(500_000 * 0.0289 * 1.19));
    expect(serviceFeeAmount(50_000, true)).toBeLessThan(serviceFeeAmount(50_000, false));
  });

  it('calcula exactamente $87.041 para el caso de control $100.000 tienda verificada (8 % + IVA)', () => {
    // 100.000 - 9.520 (8 % + IVA) - 3.439 (Flow 2,89 % + IVA). Con los tramos anteriores eran $84.661.
    expect(calculateSellerEarnings(100_000, false)).toBe(87_041);
  });

  it('usa la misma tasa de 8 % en ventas chicas y grandes, sin tramos', () => {
    expect(serviceFeeAmount(30_000, false)).toBe(Math.round(30_000 * 0.08 * 1.19) + Math.round(30_000 * 0.0289 * 1.19));
    expect(serviceFeeAmount(400_000, false)).toBe(Math.round(400_000 * 0.08 * 1.19) + Math.round(400_000 * 0.0289 * 1.19));
  });

  it('usa la misma tasa al calcular líquido y precio sugerido', () => {
    const desired = 100_000;
    const suggested = calculateSuggestedPrice(desired, true);
    expect(calculateSellerEarnings(suggested, true)).toBeGreaterThanOrEqual(desired);
  });

  it('maneja números astronómicos sin congelar el hilo de ejecución', () => {
    const hugePrice = 23344444444444444;
    expect(() => calculateSuggestedPrice(hugePrice, true)).not.toThrow();
    expect(calculateSuggestedPrice(hugePrice, true)).toBeLessThanOrEqual(999_999_999);
  });
});
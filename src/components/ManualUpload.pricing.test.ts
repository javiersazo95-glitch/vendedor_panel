import { describe, expect, it } from 'vitest';
import { calculateSellerEarnings, calculateSuggestedPrice, serviceFeeAmount } from '../utils/pricing';

describe('simulador de Vendedor Fundador', () => {
  it('mantiene 5% de comisión RepuesTop (IVA incl.) independiente del monto', () => {
    expect(serviceFeeAmount(50_000, true)).toBe(Math.round(50_000 * 0.05) + Math.round(50_000 * 0.0289 * 1.19));
    expect(serviceFeeAmount(500_000, true)).toBe(Math.round(500_000 * 0.05) + Math.round(500_000 * 0.0289 * 1.19));
    expect(serviceFeeAmount(50_000, true)).toBeLessThan(serviceFeeAmount(50_000, false));
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

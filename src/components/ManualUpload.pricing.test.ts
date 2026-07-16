import { describe, expect, it } from 'vitest';
import { calculateSellerEarnings, calculateSuggestedPrice, serviceFeeAmount } from '../utils/pricing';

describe('simulador de Vendedor Fundador', () => {
  it('mantiene 5% de comisión RepuesTop independiente del monto', () => {
    expect(serviceFeeAmount(50_000, true)).toBe(Math.round(Math.round(50_000 * 0.05) * 1.19) + Math.round(50_000 * 0.0289 * 1.19));
    expect(serviceFeeAmount(500_000, true)).toBe(Math.round(Math.round(500_000 * 0.05) * 1.19) + Math.round(500_000 * 0.0289 * 1.19));
    expect(serviceFeeAmount(50_000, true)).toBeLessThan(serviceFeeAmount(50_000, false));
  });

  it('usa la misma tasa al calcular líquido y precio sugerido', () => {
    const desired = 100_000;
    const suggested = calculateSuggestedPrice(desired, true);
    expect(calculateSellerEarnings(suggested, true)).toBeGreaterThanOrEqual(desired);
  });
});

import { describe, expect, it } from 'vitest';
import { calculateSellerEarnings, calculateSuggestedPrice, pricingFeeBreakdown, serviceFeeAmount } from '../utils/pricing';

describe('simulador de Vendedor Fundador', () => {
  it('en marcha blanca solo paga Flow: 0 % de tarifa de servicio independiente del monto', () => {
    expect(serviceFeeAmount(50_000, true)).toBe(Math.round(50_000 * 0.0289 * 1.19));
    expect(serviceFeeAmount(500_000, true)).toBe(Math.round(500_000 * 0.0289 * 1.19));
    expect(serviceFeeAmount(50_000, true)).toBeLessThan(serviceFeeAmount(50_000, false));
    expect(pricingFeeBreakdown(50_000, true)).toMatchObject({ rate: 0, repuestopNet: 0, repuestopIva: 0, repuestopWithIva: 0 });
  });

  it('calcula exactamente $88.231 para el caso de control $100.000 tienda verificada (7 % + IVA)', () => {
    // 100.000 - 8.330 (7 % + IVA) - 3.439 (Flow 2,89 % + IVA). Con 8 % eran $87.041.
    expect(calculateSellerEarnings(100_000, false)).toBe(88_231);
  });

  it('usa la misma tasa de 7 % en ventas chicas y grandes, sin tramos', () => {
    expect(serviceFeeAmount(30_000, false)).toBe(Math.round(30_000 * 0.07 * 1.19) + Math.round(30_000 * 0.0289 * 1.19));
    expect(serviceFeeAmount(400_000, false)).toBe(Math.round(400_000 * 0.07 * 1.19) + Math.round(400_000 * 0.0289 * 1.19));
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
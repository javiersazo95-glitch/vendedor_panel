import { describe, expect, it } from 'vitest';
import { getProductTopStatus, topLabel } from './productTop';

describe('getProductTopStatus', () => {
  it('distinguishes a product that was never activated', () => {
    expect(getProductTopStatus({ destacado: false, topHasta: null })).toMatchObject({ state: 'none', daysLeft: 0 });
  });

  it('shows the remaining days for an active Top product', () => {
    const now = Date.UTC(2026, 8, 2, 12);
    const status = getProductTopStatus({ destacado: true, topHasta: '2026-09-05T12:00:00.000Z' }, now);
    expect(status.state).toBe('active');
    expect(status.daysLeft).toBe(3);
    expect(topLabel(status)).toBe('Producto Top · 3 días');
  });

  it('does not present an expired backend flag as active priority', () => {
    const status = getProductTopStatus({ destacado: true, topHasta: '2026-09-01T12:00:00.000Z' }, Date.UTC(2026, 8, 2, 12));
    expect(status.state).toBe('expired');
    expect(topLabel(status)).toBe('Top vencido');
  });
});

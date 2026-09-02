import type { Product } from '../db';

export type ProductTopState = 'none' | 'active' | 'expired';

export interface ProductTopStatus {
  state: ProductTopState;
  daysLeft: number;
  expiresAt: Date | null;
}

export function getProductTopStatus(product: Pick<Product, 'destacado' | 'topHasta'> | null | undefined, now = Date.now()): ProductTopStatus {
  if (!product?.destacado) return { state: 'none', daysLeft: 0, expiresAt: null };
  const expiresAt = product.topHasta ? new Date(product.topHasta) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return { state: 'active', daysLeft: 0, expiresAt: null };
  const remaining = expiresAt.getTime() - now;
  if (remaining <= 0) return { state: 'expired', daysLeft: 0, expiresAt };
  return { state: 'active', daysLeft: Math.ceil(remaining / 86_400_000), expiresAt };
}

export function topLabel(status: ProductTopStatus): string | null {
  if (status.state === 'none') return null;
  if (status.state === 'expired') return 'Top vencido';
  if (!status.expiresAt) return 'Producto Top';
  return status.daysLeft === 1 ? 'Producto Top · último día' : `Producto Top · ${status.daysLeft} días`;
}

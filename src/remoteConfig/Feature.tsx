/**
 * `<Feature flag="panel.nav.historial">...</Feature>`: muestra sus hijos sólo si el flag está
 * encendido. Sin bootstrap vale `fallback` (por defecto `true`), así que un build viejo o la API
 * caída muestran todo como hoy.
 */
import type { ReactNode } from 'react';
import { useFlag } from './hooks';

export function Feature({ flag, fallback = true, children }: { flag: string; fallback?: boolean; children: ReactNode }) {
  const visible = useFlag(flag, fallback);
  return visible ? <>{children}</> : null;
}

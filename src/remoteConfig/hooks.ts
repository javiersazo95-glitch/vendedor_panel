/**
 * Hooks de la configuración remota (contrato, sección 6, punto 4). Todos reciben un fallback y
 * lo devuelven mientras el bootstrap no haya llegado o no traiga la clave.
 */
import { useContext, useMemo } from 'react';
import { RemoteConfigContext } from './context';
import { leerCatalogo, leerFlag, leerLista, leerParametro } from './remoteConfig';
import type { CatalogoDe, EstadoRemoteConfig, NombreCatalogo, OpcionListaDTO } from './types';

/**
 * El estado completo. Los componentes que calculan con `utils/pricing` (que lee el store fuera
 * de React) lo llaman para volver a renderizar cuando llega o cambia el bootstrap.
 */
export function useRemoteConfig(): EstadoRemoteConfig {
  return useContext(RemoteConfigContext);
}

/** Flag de visibilidad. Un flag que el Mantenedor no conoce vale `fallback` (por convención `true`). */
export function useFlag(clave: string, fallback = true): boolean {
  return leerFlag(useRemoteConfig(), clave, fallback);
}

/**
 * Opciones activas de una lista de desplegable, en el orden del Mantenedor. Sin `fallback`
 * explícito se usa el de `fallbacks.ts` para ese código (o `[]` si no hay).
 */
export function useLista(codigo: string, fallback?: readonly OpcionListaDTO[]): readonly OpcionListaDTO[] {
  const estado = useRemoteConfig();
  return useMemo(() => leerLista(estado, codigo, fallback), [estado, codigo, fallback]);
}

/** Parámetro público parseado según `parametrosTipos`; el tipo del fallback fija el tipo esperado. */
export function useParametro<T extends number | string | boolean>(clave: string, fallback: T): T {
  return leerParametro(useRemoteConfig(), clave, fallback);
}

/** Catálogo del bootstrap (`categorias`, `marcasVehiculo`, `marcasRepuestoDestacadas`), activo y ordenado. */
export function useCatalogo<K extends NombreCatalogo>(nombre: K, fallback?: CatalogoDe<K>): CatalogoDe<K> {
  const estado = useRemoteConfig();
  return useMemo(() => leerCatalogo(estado, nombre, fallback), [estado, nombre, fallback]);
}

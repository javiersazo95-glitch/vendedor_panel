/**
 * Garantía del producto (2026-10-19). Parte en 6 meses: los repuestos nuevos ya tienen esa
 * garantía legal, y una opción menor haría creer al comprador que tiene menos protección. El
 * backend guarda el texto tal cual (máximo 80 caracteres); "Otro" deja escribirla a mano. Mismas
 * opciones que la app y el Market.
 *
 * Desde el Mantenedor común (2026-10-20) las opciones salen de la lista `GARANTIA_PRODUCTO` del
 * bootstrap (el valor se guarda tal cual en `garantia`); sin bootstrap valen las de siempre,
 * `GARANTIA_OPCIONES_FALLBACK`. La lista lleva `permiteTextoLibre: true`: la opción de escribir
 * una garantía propia se mantiene siempre.
 */
import { GARANTIA_OPCIONES_FALLBACK } from '../remoteConfig/fallbacks';
import { remoteConfig } from '../remoteConfig/remoteConfig';

export { GARANTIA_OPCIONES_FALLBACK };

export const GARANTIA_MAX = 80;

/** Las opciones vigentes del desplegable: las del Mantenedor si llegaron, si no las de siempre. */
export function garantiaOpciones(): readonly string[] {
  return remoteConfig.lista('GARANTIA_PRODUCTO').map((opcion) => opcion.valor);
}

/** Junta espacios y recorta, igual que el backend. */
export function normalizarGarantia(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\s+/g, ' ').trim();
}

/** `opciones` permite pasar las de un hook (`useLista`) para que el componente reaccione al cambio. */
export function esGarantiaPredefinida(valor: string | null | undefined, opciones: readonly string[] = garantiaOpciones()): boolean {
  return opciones.includes(normalizarGarantia(valor));
}

/**
 * Opciones sugeridas para una columna de texto libre del asistente de Excel: la garantía se
 * elige de la lista o se escribe a mano. Las demás columnas no tienen sugerencias.
 */
export function sugerenciasDeTextoLibre(columna: string): readonly string[] {
  return columna === 'garantia' ? garantiaOpciones() : [];
}

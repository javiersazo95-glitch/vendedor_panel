/**
 * Garantia del producto (2026-10-19). Parte en 6 meses: los repuestos nuevos ya tienen esa
 * garantia legal, y una opcion menor haria creer al comprador que tiene menos proteccion. El
 * backend guarda el texto tal cual (maximo 80 caracteres); "Otro" deja escribirla a mano. Mismas
 * opciones que la app y el Market.
 */
export const GARANTIA_OPCIONES = [
  '6 meses (garantía legal)',
  '1 año',
  '2 años',
  '3 años',
  'Garantía del fabricante',
] as const;

export const GARANTIA_MAX = 80;

/** Junta espacios y recorta, igual que el backend. */
export function normalizarGarantia(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\s+/g, ' ').trim();
}

export function esGarantiaPredefinida(valor: string | null | undefined): boolean {
  return (GARANTIA_OPCIONES as readonly string[]).includes(normalizarGarantia(valor));
}

/**
 * Opciones sugeridas para una columna de texto libre del asistente de Excel: la garantia se
 * elige de la lista o se escribe a mano. Las demas columnas no tienen sugerencias.
 */
export function sugerenciasDeTextoLibre(columna: string): readonly string[] {
  return columna === 'garantia' ? GARANTIA_OPCIONES : [];
}

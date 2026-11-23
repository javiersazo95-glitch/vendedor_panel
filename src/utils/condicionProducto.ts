/**
 * Condición del repuesto (23-nov-2026). ORIGINAL y ALTERNATIVO son nuevos; USADO y REACONDICIONADO llevan aviso al
 * comprador. Mismos valores y textos que la app (`utils/product-condition.ts`) y el Market
 * (`data/productConditions.js`); los alias del Excel son los de `CondicionProducto` del backend.
 */
export type CondicionProducto = 'ORIGINAL' | 'ALTERNATIVO' | 'USADO' | 'REACONDICIONADO';

export const CONDICIONES_PRODUCTO: { valor: CondicionProducto; etiqueta: string; ayuda: string }[] = [
  { valor: 'ORIGINAL', etiqueta: 'Nuevo original', ayuda: 'Pieza nueva de la marca del vehículo' },
  { valor: 'ALTERNATIVO', etiqueta: 'Nuevo alternativo', ayuda: 'Pieza nueva compatible de otra marca' },
  { valor: 'USADO', etiqueta: 'Usado', ayuda: 'Pieza con uso previo o de desarme' },
  { valor: 'REACONDICIONADO', etiqueta: 'Reacondicionado', ayuda: 'Pieza reparada o remanufacturada' },
];

const ALIAS: Record<string, CondicionProducto> = {
  ALT: 'ALTERNATIVO', ALTERNATIVA: 'ALTERNATIVO', 'NUEVO ALTERNATIVO': 'ALTERNATIVO', 'ALTERNATIVO NUEVO': 'ALTERNATIVO',
  // NUEVO a secas no está: no dice si es original o alternativo, y publicarlo como original sería adivinar.
  'NUEVO ORIGINAL': 'ORIGINAL', 'ORIGINAL NUEVO': 'ORIGINAL', GENUINO: 'ORIGINAL', OEM: 'ORIGINAL',
  USADA: 'USADO', USADOS: 'USADO', SEMINUEVO: 'USADO', 'SEGUNDA MANO': 'USADO', 'DE SEGUNDA MANO': 'USADO',
  DESARME: 'USADO', 'DE DESARME': 'USADO', DESARMADURIA: 'USADO',
  REACONDICIONADA: 'REACONDICIONADO', REMANUFACTURADO: 'REACONDICIONADO', REMANUFACTURADA: 'REACONDICIONADO',
  REFACCIONADO: 'REACONDICIONADO', RECONSTRUIDO: 'REACONDICIONADO', REPARADO: 'REACONDICIONADO',
};

/** El valor guardado que corresponde a un texto ("Segunda mano" -> USADO), o null si no se reconoce. */
export function condicionDesdeTexto(texto?: string | null): CondicionProducto | null {
  const limpio = String(texto ?? '').normalize('NFD').replace(/\p{M}+/gu, '').replace(/[\s/_-]+/g, ' ').trim().toUpperCase();
  return CONDICIONES_PRODUCTO.find((c) => c.valor === limpio)?.valor ?? ALIAS[limpio] ?? null;
}

export function etiquetaCondicion(valor?: string | null): string {
  return CONDICIONES_PRODUCTO.find((c) => c.valor === String(valor ?? '').toUpperCase())?.etiqueta ?? 'Nuevo original';
}

export function esUsadoOReacondicionado(valor?: string | null): boolean {
  return valor === 'USADO' || valor === 'REACONDICIONADO';
}

/** Aviso a la tienda al publicar un usado o reacondicionado. */
export const AVISO_USADO_TIENDA =
  'Describe el estado real de la pieza y guarda el respaldo de su procedencia. Tu tienda responde por el repuesto y por la postventa.';

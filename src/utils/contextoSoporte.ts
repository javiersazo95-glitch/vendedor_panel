import { useSyncExternalStore } from 'react';

/**
 * En que parte del panel esta el vendedor, para adjuntarlo al abrir un chat con soporte.
 * Es el objeto `contexto` del contrato de la API (el backend lo guarda tal cual, ≤4000 chars).
 */
export interface ContextoSoporte {
  flujo?: 'mi-excel' | 'plantilla' | 'otro';
  vista?: string;
  paso?: number;
  pasoTitulo?: string;
  archivoNombre?: string;
  filas?: number;
}

let actual: ContextoSoporte | null = null;
const oyentes = new Set<() => void>();

function iguales(a: ContextoSoporte | null, b: ContextoSoporte | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Almacen minimo fuera de React: el asistente de carga publica su etapa y el boton de soporte
 * (montado en otra rama del arbol) la lee sin tener que pasar props por todo el Dashboard.
 */
export const contextoSoporteStore = {
  get(): ContextoSoporte | null {
    return actual;
  },
  set(ctx: ContextoSoporte | null): void {
    // Publicar el mismo contexto en cada render no debe re-renderizar a los suscriptores.
    if (iguales(actual, ctx)) return;
    actual = ctx ? { ...ctx } : null;
    oyentes.forEach((oyente) => oyente());
  },
  subscribe(oyente: () => void): () => void {
    oyentes.add(oyente);
    return () => {
      oyentes.delete(oyente);
    };
  },
};

/** Publica (o borra con null) en que paso va el vendedor. Ej.: `{ flujo: 'mi-excel', paso: 3, pasoTitulo: 'Completa', archivoNombre, filas }`. */
export function publicarContextoSoporte(ctx: ContextoSoporte | null): void {
  contextoSoporteStore.set(ctx);
}

/** Contexto actual, reactivo. */
export function useContextoSoporte(): ContextoSoporte | null {
  return useSyncExternalStore(contextoSoporteStore.subscribe, contextoSoporteStore.get, contextoSoporteStore.get);
}

const NOMBRES_FLUJO: Record<NonNullable<ContextoSoporte['flujo']>, string> = {
  'mi-excel': 'Mi propio Excel',
  plantilla: 'La plantilla de RepuesTop',
  otro: 'Panel',
};

/**
 * El contexto en palabras simples, para mostrarselo al vendedor antes de enviarlo.
 * Ej.: "Mi propio Excel · Paso 3: Completa · inventario.xlsx · 120 filas". Vacio si no hay nada que decir.
 */
export function describirContextoSoporte(ctx: ContextoSoporte | null): string {
  if (!ctx) return '';
  const partes: string[] = [];
  if (ctx.flujo && ctx.flujo !== 'otro') partes.push(NOMBRES_FLUJO[ctx.flujo]);
  if (ctx.vista) partes.push(ctx.vista);
  if (typeof ctx.paso === 'number') {
    partes.push(ctx.pasoTitulo ? `Paso ${ctx.paso}: ${ctx.pasoTitulo}` : `Paso ${ctx.paso}`);
  } else if (ctx.pasoTitulo) {
    partes.push(ctx.pasoTitulo);
  }
  if (ctx.archivoNombre) partes.push(ctx.archivoNombre);
  if (typeof ctx.filas === 'number' && ctx.filas > 0) {
    partes.push(`${ctx.filas.toLocaleString('es-CL')} ${ctx.filas === 1 ? 'fila' : 'filas'}`);
  }
  return partes.join(' · ');
}

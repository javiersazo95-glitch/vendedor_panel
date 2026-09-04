/**
 * Comparación de los valores del vendedor contra los catálogos reales de RepuesTop
 * (categorías, subcategorías y marcas, que llegan en `GET /inventario/excel/esquema`).
 *
 * Es la diferencia entre "300 filas rechazadas" y "una decisión: Frenos delanteros →
 * Frenos". El backend trata cada columna distinto, y esa diferencia es la que manda acá:
 *
 * - **categoría**: se busca en el catálogo y no se crea. Si no está, la fila **no se
 *   publica** (`buscarCategoria` lanza). Es el error masivo más caro del flujo.
 * - **subcategoría**: tiene que pertenecer a la categoría del producto. Si no está, el
 *   repuesto se publica **sin subcategoría** y el backend deja una advertencia.
 * - **marca de repuesto**: se busca **o se crea**. Un "BOSH" mal escrito no rompe nada,
 *   pero deja una marca nueva en el catálogo. Así se llegó a 45 categorías duplicadas que
 *   hubo que consolidar a mano; con las marcas todavía se puede evitar.
 */

/** minúsculas, sin acentos, sin puntuación y con los espacios colapsados. */
export function normalizarParaComparar(valor: string): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * El nombre tal como está en el catálogo, o null si no está. Ignora acentos y mayúsculas
 * a propósito, y por eso devuelve el nombre **del catálogo** y no el del vendedor: el
 * backend busca con `findByNombreIgnoreCase`, que ignora mayúsculas pero no tildes, así
 * que "Suspension" tiene que escribirse "Suspensión" o la fila se rechaza.
 */
export function buscarEnCatalogo(valor: string, catalogo: string[]): string | null {
  const objetivo = normalizarParaComparar(valor);
  if (!objetivo) return null;
  return catalogo.find((c) => normalizarParaComparar(c) === objetivo) ?? null;
}

/** Distancia de edición, para atrapar los errores de tipeo ("Bosh" contra "Bosch"). */
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      actual[j] = Math.min(
        previa[j] + 1,
        actual[j - 1] + 1,
        previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previa = actual;
  }
  return previa[b.length];
}

/**
 * Cuánto se parecen dos nombres, entre 0 y 1. Combina dos cosas que fallan por separado:
 * las palabras compartidas ("frenos delanteros" contra "frenos") y la distancia de edición
 * ("bosh" contra "bosch"), y se queda con la mejor de las dos.
 */
export function parecido(a: string, b: string): number {
  const na = normalizarParaComparar(a);
  const nb = normalizarParaComparar(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const tokensA = new Set(na.split(' '));
  const tokensB = new Set(nb.split(' '));
  const comunes = [...tokensA].filter((t) => tokensB.has(t)).length;
  const porTokens = comunes === 0 ? 0 : comunes / Math.max(tokensA.size, tokensB.size);

  const porEdicion = 1 - distancia(na, nb) / Math.max(na.length, nb.length);

  // Que uno contenga al otro cuenta como coincidencia fuerte: "filtro de aceite" dentro de
  // "filtros de aceite y combustible" es la misma familia escrita más larga.
  const porInclusion = na.includes(nb) || nb.includes(na) ? 0.85 : 0;

  return Math.max(porTokens, porEdicion, porInclusion);
}

/** Umbral bajo el cual una sugerencia deja de ser útil y pasa a ser ruido. */
const UMBRAL_SUGERENCIA = 0.55;

/** Los nombres del catálogo más parecidos al valor, del más parecido al menos. */
export function sugerirDelCatalogo(valor: string, catalogo: string[], max = 3): string[] {
  return catalogo
    .map((c) => ({ c, p: parecido(valor, c) }))
    .filter(({ p }) => p >= UMBRAL_SUGERENCIA)
    .sort((x, y) => y.p - x.p)
    .slice(0, max)
    .map(({ c }) => c);
}

export interface ValorConFrecuencia {
  valor: string;
  filas: number;
}

/** Valores distintos de una columna del vendedor, con en cuántas filas aparece cada uno. */
export function contarValoresDeColumna(rows: unknown[][], colIndex: number): ValorConFrecuencia[] {
  const cuenta = new Map<string, number>();
  for (const row of rows) {
    const v = String((row as unknown[])[colIndex] ?? '').trim();
    if (!v) continue;
    cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .map(([valor, filas]) => ({ valor, filas }))
    .sort((a, b) => b.filas - a.filas);
}

export interface DecisionCatalogo {
  /** Lo que dice el archivo del vendedor. */
  valor: string;
  filas: number;
  /** Nombres del catálogo parecidos, el primero es el más probable. */
  sugerencias: string[];
}

/**
 * Las decisiones que quedan pendientes: sólo los valores que **no** están en el catálogo.
 * Ordenadas por frecuencia, porque arreglar el que aparece en 43 filas vale 43 veces más
 * que el que aparece en una, y el vendedor tiene que ver eso primero.
 */
export function decisionesDeCatalogo(
  valores: ValorConFrecuencia[],
  catalogo: string[],
  max = 50,
): DecisionCatalogo[] {
  if (catalogo.length === 0) return [];
  return valores
    .filter(({ valor }) => buscarEnCatalogo(valor, catalogo) === null)
    .slice(0, max)
    .map(({ valor, filas }) => ({ valor, filas, sugerencias: sugerirDelCatalogo(valor, catalogo) }));
}

/** Todas las subcategorías del catálogo, sin importar a qué categoría pertenecen. */
export function todasLasSubcategorias(porCategoria: Record<string, string[]>): string[] {
  return [...new Set(Object.values(porCategoria).flat())].sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * Filas de la hoja que no son repuestos.
 *
 * Una lista de mostrador no es una tabla limpia: es algo que se imprime. Entre los
 * repuestos hay subtotales por familia, un total general al final y el encabezado repetido
 * cada vez que empieza una página. Todo eso llega al panel como si fueran productos, y
 * termina en filas rechazadas que el vendedor no sabe de dónde salieron —él no escribió
 * ningún repuesto llamado "SUBTOTAL FRENOS".
 *
 * Lo de acá sólo **reconoce** esas filas; sacarlas es decisión del vendedor, con el
 * interruptor del paso 2, y el conteo le dice cuántas son antes de decidir.
 */
import { normalizarParaComparar } from './plantillaCatalogos';

export type MotivoDescarte = 'totales' | 'encabezado';

export interface FilaDescartada {
  /** Índice dentro del arreglo de filas de datos, no el número de fila del Excel. */
  indice: number;
  motivo: MotivoDescarte;
  /** El texto que la delata, para poder mostrárselo al vendedor. */
  texto: string;
}

/** Palabras con las que se cierra un bloque en una lista impresa. */
const PALABRAS_DE_TOTAL = /^(sub)?\s*total(es)?\b|^suma\b|^total\s+general\b/i;

const celdas = (fila: unknown[]): string[] =>
  fila.map((v) => (v === undefined || v === null ? '' : String(v).trim()));

/**
 * ¿Esta fila repite los títulos de la tabla? Se compara contra el encabezado real y se
 * exige que coincidan al menos dos celdas con texto: una sola podría ser un repuesto que
 * de casualidad se llama igual que una columna.
 */
function repiteElEncabezado(valores: string[], encabezado: string[]): boolean {
  const conTexto = valores.filter(Boolean).length;
  if (conTexto < 2) return false;
  let iguales = 0;
  for (let i = 0; i < valores.length; i++) {
    const v = normalizarParaComparar(valores[i] ?? '');
    if (!v) continue;
    if (v !== normalizarParaComparar(encabezado[i] ?? '')) return false;
    iguales += 1;
  }
  return iguales >= 2;
}

/**
 * ¿Esta fila cierra un bloque? Se pide que alguna celda empiece con una palabra de total
 * **y** que la fila venga sin código. La etiqueta del subtotal se escribe donde va el
 * nombre —"SUBTOTAL FRENOS" ocupa esa columna—, así que el nombre no sirve para
 * distinguirlos; el código sí, porque un subtotal nunca tiene uno. Sin esa condición, un
 * repuesto llamado "Amortiguador Total Flex" se perdería sin que nadie lo note.
 */
function esFilaDeTotales(valores: string[], indicesCodigo: number[]): boolean {
  const tieneCodigo = indicesCodigo.some((i) => Boolean(valores[i]));
  if (tieneCodigo) return false;
  return valores.some((v) => v && PALABRAS_DE_TOTAL.test(v));
}

/**
 * Las filas que no son repuestos, con el motivo por el que lo parecen.
 *
 * `indicesCodigo` son las columnas de la hoja mapeadas al código del repuesto. Sin
 * ninguna no se descarta nada por totales: no habría con qué distinguir un subtotal de un
 * repuesto al que le falta el código.
 */
export function detectarFilasNoRepuesto(
  rows: unknown[][],
  encabezado: unknown[],
  indicesCodigo: number[],
): FilaDescartada[] {
  const titulos = celdas(encabezado);
  const fuera: FilaDescartada[] = [];
  rows.forEach((fila, indice) => {
    const valores = celdas(fila as unknown[]);
    if (repiteElEncabezado(valores, titulos)) {
      fuera.push({ indice, motivo: 'encabezado', texto: valores.filter(Boolean).join(' · ') });
      return;
    }
    if (indicesCodigo.length > 0 && esFilaDeTotales(valores, indicesCodigo)) {
      fuera.push({
        indice,
        motivo: 'totales',
        texto: valores.find((v) => v && PALABRAS_DE_TOTAL.test(v)) ?? '',
      });
    }
  });
  return fuera;
}


export interface Banda {
  /** Índice de la fila de banda dentro de las filas de datos. */
  indice: number;
  /** El texto del título: "FRENOS", "FILTROS". */
  titulo: string;
}

/**
 * Filas que son el título de un grupo, no un repuesto: una sola celda con texto en una
 * hoja de varias columnas. Es como se escribe la categoría en una lista impresa —una banda
 * que dice "FRENOS" y debajo los repuestos de frenos—, así que el dato existe pero no
 * tiene columna.
 *
 * Se exige que la hoja tenga al menos tres columnas y que la banda traiga texto sin
 * números: una fila con una sola celda numérica es un dato suelto, no un título.
 */
export function detectarBandas(rows: unknown[][], totalColumnas: number): Banda[] {
  if (totalColumnas < 3) return [];
  const bandas: Banda[] = [];
  rows.forEach((fila, indice) => {
    const valores = celdas(fila as unknown[]);
    const conTexto = valores.filter(Boolean);
    if (conTexto.length !== 1) return;
    const titulo = conTexto[0];
    if (/\d/.test(titulo)) return;
    bandas.push({ indice, titulo });
  });
  return bandas;
}


export interface SegundaTabla {
  /** Índice de la fila de títulos de la segunda tabla, dentro de las filas de datos. */
  indice: number;
  /** Los títulos que trae, para poder mostrárselos al vendedor. */
  titulos: string[];
}

/**
 * ¿Más abajo empieza otra tabla, con sus propios títulos?
 *
 * Pasa cuando el vendedor arma un bloque por proveedor en la misma hoja. Es el único caso
 * de esta familia que **no** se puede arreglar solo: la segunda tabla tiene otras columnas
 * y otro orden, así que sus datos no calzan con los títulos de arriba. Lo único honesto es
 * decirlo antes de que el vendedor recorra el asistente con la mitad del archivo mal leída.
 *
 * Se busca una fila de puro texto sin números, con al menos tres celdas llenas, que no
 * repita los títulos de arriba y que tenga filas de datos debajo.
 */
export function detectarSegundaTabla(rows: unknown[][], encabezado: unknown[]): SegundaTabla | null {
  const titulos = celdas(encabezado);
  for (let i = 0; i < rows.length - 1; i++) {
    const valores = celdas(rows[i] as unknown[]);
    const llenas = valores.filter(Boolean);
    if (llenas.length < 3) continue;
    if (llenas.some((v) => /\d/.test(v))) continue;
    if (repiteElEncabezado(valores, titulos)) continue;
    // Debajo tiene que venir algo que parezca un dato, no otro título suelto.
    const siguiente = celdas(rows[i + 1] as unknown[]);
    if (siguiente.filter(Boolean).length < 2) continue;
    if (!siguiente.some((v) => /\d/.test(v))) continue;
    return { indice: i, titulos: llenas };
  }
  return null;
}

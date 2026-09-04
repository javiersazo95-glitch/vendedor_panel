/**
 * Limpieza de los valores del vendedor antes de escribirlos en el Excel oficial.
 *
 * Es el trabajo sucio que evita los errores en volumen: una lista chilena escribe los
 * precios como "$ 12.900", los años como "2014-2020" en una sola columna y los sí/no como
 * una X. Nada de eso está mal desde el punto de vista del vendedor —así se ha llevado el
 * inventario siempre—, pero el backend lee columna por columna y espera un número, dos
 * años separados y un SI.
 *
 * Todo lo de acá es puro y reversible a la vista: `normalizarCelda` devuelve el valor
 * limpio junto con el original, y el paso "Revisar" muestra el antes y el después para que
 * nadie descubra el cambio después de publicar.
 */

/**
 * Interpreta un número escrito como se escribe en Chile. Misma lógica que
 * `InventarioExcelService.normalizarNumero`, para que lo que el panel muestra sea lo que
 * el backend va a guardar.
 *
 * - "$ 4.990" / "12.900" → punto de separador de miles (tres decimales exactos).
 * - "1.234,50" → punto de miles y coma decimal.
 * - "4.99" → punto decimal, se respeta.
 */
export function normalizarNumero(valor: string): { numero: number | null; comoMiles: boolean } {
  const texto = String(valor ?? '').trim().replace(/\$/g, '').replace(/clp/gi, '').replace(/\s/g, '');
  if (!texto) return { numero: null, comoMiles: false };

  const tienePunto = texto.includes('.');
  const tieneComa = texto.includes(',');
  let limpio: string;
  let comoMiles = false;

  if (tienePunto && tieneComa) {
    limpio = texto.replace(/\./g, '').replace(',', '.');
  } else if (tienePunto) {
    const decimales = texto.length - texto.lastIndexOf('.') - 1;
    if (decimales === 3) {
      limpio = texto.replace(/\./g, '');
      comoMiles = true;
    } else {
      limpio = texto;
    }
  } else {
    limpio = texto.replace(',', '.');
  }

  const numero = /^-?\d*\.?\d+$/.test(limpio) ? Number(limpio) : null;
  return { numero: Number.isFinite(numero as number) ? numero : null, comoMiles };
}

/** El número ya limpio, listo para escribirlo. Null si el valor no es un número. */
export function numeroLimpio(valor: string): string | null {
  const { numero } = normalizarNumero(valor);
  return numero === null ? null : String(numero);
}

/**
 * Parte un rango de años escrito en una sola celda. Es el formato estándar de las listas
 * de repuestos: "2014-2020", "2014 a 2020", "2014/2020", "2014 al 2020", "2014 – 2020".
 * Un año suelto no es un rango y devuelve null: no hay nada que dividir.
 */
export function partirRangoAnios(valor: string): { desde: string; hasta: string } | null {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  const m = texto.match(/^(\d{4})\s*(?:-|–|—|\/|>|a|al|hasta)\s*(\d{4})$/i);
  if (!m) return null;
  return { desde: m[1], hasta: m[2] };
}

/** ¿Esta columna trae rangos de años? Basta con una celda para que valga preguntarlo. */
export function pareceColumnaDeRangos(valores: string[]): boolean {
  return valores.some((v) => partirRangoAnios(v) !== null);
}

const SI_TEXTOS = new Set(['SI', 'SÍ', 'S', 'X', '1', 'TRUE', 'V', 'VERDADERO', 'YES', 'Y']);
const NO_TEXTOS = new Set(['NO', 'N', '0', 'FALSE', 'F', 'FALSO']);

/**
 * Lleva a SI/NO lo que el vendedor haya escrito. La X es el caso más común: en una planilla
 * se marca con una X la casilla que aplica, y el backend sólo entiende SI/SÍ/TRUE/1.
 */
export function normalizarSiNo(valor: string): 'SI' | 'NO' | null {
  const texto = String(valor ?? '').trim().toUpperCase();
  if (!texto) return null;
  if (SI_TEXTOS.has(texto)) return 'SI';
  if (NO_TEXTOS.has(texto)) return 'NO';
  return null;
}

/** Recorta y colapsa los espacios de más, que sobran al copiar y pegar entre planillas. */
export function limpiarTexto(valor: string): string {
  return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

/** Un cambio hecho sobre una celda, para poder mostrarlo antes de generar el archivo. */
export interface CambioNormalizacion {
  columna: string;
  antes: string;
  despues: string;
}

/** Columnas que el backend lee como número. El esquema todavía no declara tipos. */
export const COLUMNAS_NUMERICAS = new Set(['precio', 'stock', 'anio_desde', 'anio_hasta']);
/** Columnas que el backend lee como SI/NO. */
export const COLUMNAS_SI_NO = new Set(['compatibilidad_general', 'requiere_chasis']);

/**
 * Limpia una celda según la columna oficial a la que va. Devuelve el valor final y, cuando
 * hubo cambio, el original para poder mostrarlo.
 *
 * Un valor que no se puede interpretar se deja **tal cual**: no se inventa nada. Es la
 * revisión del paso 3 la que lo marca como problema.
 */
export function normalizarCelda(columna: string, valor: string): { valor: string; cambio?: CambioNormalizacion } {
  const original = String(valor ?? '');
  let salida = limpiarTexto(original);

  if (salida) {
    if (COLUMNAS_NUMERICAS.has(columna)) {
      salida = numeroLimpio(salida) ?? salida;
    } else if (COLUMNAS_SI_NO.has(columna)) {
      salida = normalizarSiNo(salida) ?? salida;
    }
  }

  return salida === original
    ? { valor: salida }
    : { valor: salida, cambio: { columna, antes: original, despues: salida } };
}

/** Agrupa los cambios para contarlos: "23 precios así se guardaron así". */
export interface ResumenCambio {
  columna: string;
  antes: string;
  despues: string;
  filas: number;
}

export function agruparCambios(cambios: CambioNormalizacion[], maxEjemplos = 8): ResumenCambio[] {
  const mapa = new Map<string, ResumenCambio>();
  for (const c of cambios) {
    const clave = `${c.columna}|${c.antes}|${c.despues}`;
    const previo = mapa.get(clave);
    if (previo) previo.filas += 1;
    else mapa.set(clave, { ...c, filas: 1 });
  }
  return [...mapa.values()].sort((a, b) => b.filas - a.filas).slice(0, maxEjemplos);
}

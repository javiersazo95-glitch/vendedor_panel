/**
 * ¿El Excel que subió el vendedor es la plantilla de RepuesTop?
 *
 * La carga con Excel es una sola: el vendedor sube su archivo y el panel decide el camino. Si es
 * la plantilla que se descarga del panel, sus columnas ya son las de RepuesTop y no hay nada que
 * relacionar: se salta "Relaciona" y se va directo a corregir. Si es su propio Excel, pasa por
 * las cuatro etapas de siempre.
 *
 * Se reconoce sólo si es exactamente la plantilla: mismas hojas y mismas columnas (ver
 * `detectarPlantilla`). Ante la duda, es un Excel propio: "Relaciona" sirve para cualquier archivo.
 */
import { COLUMNAS_COMPATIBILIDADES } from './plantillaCompatibilidad';
import type { CampoMeta, EsquemaPlantilla, HojaUsuario, Mapping, UserColumn } from './plantillaMapping';

/** Las hojas que trae la plantilla descargada. */
const HOJAS_DE_LA_PLANTILLA = ['inventario', 'compatibilidades', 'instrucciones'];
/** Hojas ocultas con las listas de la plantilla: pueden estar o no según la versión. */
const HOJAS_DE_LISTAS = ['listas', 'versiones', 'motores'];

/** La fila de ejemplo que trae la plantilla descargada: si el vendedor no la borró, no se carga. */
const EJEMPLO = { sku: 'SKU-001', nombre: 'Filtro de aceite Toyota Yaris' };

const norm = (valor: unknown) => String(valor ?? '').trim().toLowerCase();

export interface PlantillaDetectada {
  /** La hoja con el inventario ("inventario"). */
  hojaIndex: number;
  /** La versión que declara la hoja "instrucciones". */
  version: string | null;
}

/** Los títulos de la fila 1 de una hoja, sin las celdas vacías del final. */
function titulos(hoja: HojaUsuario): string[] {
  const fila = ((hoja.aoa[0] as unknown[]) ?? []).map(norm);
  while (fila.length > 0 && fila[fila.length - 1] === '') fila.pop();
  return fila;
}

/** ¿Los títulos son exactamente esas columnas, en ese orden? */
const mismasColumnas = (hoja: HojaUsuario, columnas: string[]) => {
  const t = titulos(hoja);
  return t.length === columnas.length && columnas.every((c, i) => t[i] === norm(c));
};

/** La versión escrita en la hoja "instrucciones" ("VERSION_PLANTILLA: 2.3.0"). */
function versionDeLaPlantilla(hojas: HojaUsuario[]): string | null {
  const instrucciones = hojas.find((h) => norm(h.nombre) === 'instrucciones');
  for (const fila of instrucciones?.aoa ?? []) {
    const texto = String((fila as unknown[])[0] ?? '').trim();
    const m = /^VERSION_PLANTILLA:\s*(\S+)/i.exec(texto);
    if (m) return m[1];
  }
  return null;
}

const versionMayor = (version: string) => version.split('.')[0];

/**
 * Si el libro es la plantilla de RepuesTop vigente, dice en qué hoja está el inventario. Tiene que
 * ser exactamente la plantilla: sus mismas hojas (inventario, compatibilidades e instrucciones, más
 * sus listas ocultas), exactamente las mismas columnas en el mismo orden, y una versión de la misma
 * generación. Cualquier otra cosa -una plantilla antigua con otras columnas, una plantilla a la que
 * se le agregaron o quitaron columnas u hojas, un CSV- es un Excel propio y pasa por "Relaciona":
 * tratarla como plantilla dejaba columnas sin leer (prueba del 30-sep).
 */
export function detectarPlantilla(hojas: HojaUsuario[], esquema: EsquemaPlantilla): PlantillaDetectada | null {
  const nombres = hojas.map((h) => norm(h.nombre));
  if (!HOJAS_DE_LA_PLANTILLA.every((n) => nombres.includes(n))) return null;
  if (nombres.some((n) => !HOJAS_DE_LA_PLANTILLA.includes(n) && !HOJAS_DE_LISTAS.includes(n))) return null;

  const hojaIndex = nombres.indexOf('inventario');
  if (!mismasColumnas(hojas[hojaIndex], esquema.columnas)) return null;
  const compatibilidades = hojas[nombres.indexOf('compatibilidades')];
  if (esquema.hojaCompatibilidadesColumnas.length > 0 && !mismasColumnas(compatibilidades, esquema.hojaCompatibilidadesColumnas)) return null;

  const version = versionDeLaPlantilla(hojas);
  if (!version || versionMayor(version) !== versionMayor(esquema.version)) return null;
  return { hojaIndex, version };
}

/**
 * La relación de columnas de la plantilla: cada columna de RepuesTop es la de su mismo nombre.
 * Las que no son de la plantilla (columnas de ayuda, notas del vendedor) no se cargan.
 */
export function mapeoDePlantilla(cols: UserColumn[], campos: CampoMeta[]): Mapping {
  const oficial: Record<string, string | null> = {};
  const extras: Mapping['extras'] = {};
  const usadas = new Set<string>();
  for (const campo of campos) {
    const col = cols.find((c) => !usadas.has(c.id) && norm(c.rawHeader) === norm(campo.key));
    oficial[campo.key] = col?.id ?? null;
    if (col) usadas.add(col.id);
  }
  for (const col of cols) if (!usadas.has(col.id)) extras[col.id] = 'ignore';
  return { oficial, extras, valueMap: {}, defaults: {} };
}

/**
 * Los vehículos de la hoja "compatibilidades" de la plantilla (más de un auto por repuesto), como
 * filas extra del mapeo: se publican en la hoja de compatibilidades del archivo que se sube.
 */
export function compatibilidadesDePlantilla(hojas: HojaUsuario[]): Record<string, string>[] {
  const hoja = hojas.find((h) => norm(h.nombre) === 'compatibilidades');
  if (!hoja || hoja.aoa.length < 2) return [];
  const encabezado = ((hoja.aoa[0] as unknown[]) ?? []).map(norm);
  const indice = new Map(COLUMNAS_COMPATIBILIDADES.map((c) => [c, encabezado.indexOf(c)]));
  const filas: Record<string, string>[] = [];
  for (const cruda of hoja.aoa.slice(1)) {
    const fila: Record<string, string> = {};
    for (const [col, i] of indice) fila[col] = i >= 0 ? String((cruda as unknown[])[i] ?? '').trim() : '';
    if (!fila.sku_proveedor || fila.sku_proveedor.toUpperCase() === EJEMPLO.sku) continue;
    filas.push(fila);
  }
  return filas;
}

/**
 * Las filas de la plantilla sin la de ejemplo ("SKU-001, Filtro de aceite Toyota Yaris"), si el
 * vendedor la dejó. Cada fila conserva su número en el Excel, para que "fila 3" siga siendo la 3.
 */
export function sinFilaDeEjemplo(
  cols: UserColumn[], rows: unknown[][], filasOriginales: number[],
): { rows: unknown[][]; filasOriginales: number[]; quitadas: number } {
  const iSku = cols.find((c) => norm(c.rawHeader) === 'sku_proveedor')?.index ?? -1;
  const iNombre = cols.find((c) => norm(c.rawHeader) === 'nombre_publicado')?.index ?? -1;
  if (iSku < 0 || iNombre < 0) return { rows, filasOriginales, quitadas: 0 };
  const quedan = rows
    .map((fila, i) => ({ fila, original: filasOriginales[i] }))
    .filter(({ fila }) => !(String(fila?.[iSku] ?? '').trim().toUpperCase() === EJEMPLO.sku
      && norm(fila?.[iNombre]) === norm(EJEMPLO.nombre)));
  return {
    rows: quedan.map((q) => q.fila),
    filasOriginales: quedan.map((q) => q.original),
    quitadas: rows.length - quedan.length,
  };
}

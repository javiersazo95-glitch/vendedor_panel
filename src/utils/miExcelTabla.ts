/**
 * El modelo de la tabla de la etapa 3 del asistente "Mi propio Excel" ("Completa"), en
 * funciones puras.
 *
 * Una sola transformación alimenta la tabla, la vista previa y el archivo que se publica: si
 * cada pantalla armara el suyo, lo que el vendedor ve y lo que se sube podrían no coincidir.
 *
 * Las celdas "amarillas" son los datos que faltan por completar. Una celda es amarilla cuando
 * está vacía, la columna es una que el vendedor tiene que completar (la marcó como "no tengo
 * esta columna" o es obligatoria) y todavía no decidió nada sobre esa celda. Decidir incluye
 * dejarla vacía a propósito: en un dato opcional, "sin dato" también es una respuesta.
 */
import {
  buildOfficialAoADetallado,
  requiereValorEnPanel,
  type CampoMeta,
  type CampoPorCompletar,
  type EsquemaPlantilla,
  type Mapping,
  type UserColumn,
} from './plantillaMapping';
import type { CambioNormalizacion } from './plantillaNormalizacion';
import { revisarAoA, type FilaRevisada } from './plantillaRevision';
import {
  COLUMNAS_COMPATIBILIDADES,
  separarPorSku,
  type SeparacionPorSku,
} from './plantillaCompatibilidad';

export interface TransformacionMiExcel {
  /** Hoja "inventario" tal como se va a publicar (fila 0 = encabezados oficiales). */
  inventario: (string | number)[][];
  /** Hoja "compatibilidades" (con encabezado), o null si no hace falta. */
  compatibilidades: (string | number)[][] | null;
  /** Por cada fila de datos del inventario, la clave con la que se corrige (y se le asignan fotos). */
  clavesInventario: string[];
  /** Por cada fila de datos del inventario, su número de fila en el Excel del vendedor. */
  numerosDeFila: number[];
  /** Por cada fila de la hoja de compatibilidades salida del archivo, la clave de su fila. */
  filasOrigenCompat: string[];
  porCompletar: CampoPorCompletar[];
  cambios: CambioNormalizacion[];
  separacion: SeparacionPorSku | null;
}

export interface EntradaTransformacion {
  userRows: unknown[][];
  userCols: UserColumn[];
  mapping: Mapping;
  campos: CampoMeta[];
  esquema: EsquemaPlantilla;
  modelosDisponibles: Record<string, string[]>;
  /** Fila de la hoja (base 0) de la que salió cada fila de `userRows`. */
  filasOriginales: number[];
}

/** Aplica el mapeo completo: es exactamente lo que se va a publicar. */
export function transformar({
  userRows, userCols, mapping, campos, esquema, modelosDisponibles, filasOriginales,
}: EntradaTransformacion): TransformacionMiExcel {
  const { aoa, cambios, filasOrigen, clavesParche, porCompletar } = buildOfficialAoADetallado(
    userRows, userCols, mapping, campos, esquema.catalogos, modelosDisponibles,
  );
  const numeroDe = (i: number) => (filasOriginales[filasOrigen[i]] ?? filasOrigen[i]) + 1;
  // Los vehículos agregados a mano no salen de ninguna fila del archivo: van al final.
  const agregados = (mapping.compatibilidadesExtra ?? [])
    .filter((fila) => (fila.sku_proveedor ?? '').trim())
    .map((fila) => COLUMNAS_COMPATIBILIDADES.map((c) => fila[c] ?? ''));

  if (!mapping.agruparPorSku && !mapping.separarAplicaciones) {
    return {
      inventario: aoa,
      compatibilidades: agregados.length > 0 ? [[...COLUMNAS_COMPATIBILIDADES], ...agregados] : null,
      clavesInventario: clavesParche,
      numerosDeFila: filasOrigen.map((_, i) => numeroDe(i)),
      filasOrigenCompat: [],
      porCompletar,
      cambios,
      separacion: null,
    };
  }
  const separacion = separarPorSku(aoa);
  return {
    inventario: separacion.inventario,
    compatibilidades: [...separacion.compatibilidades, ...agregados],
    clavesInventario: separacion.indices.map((i) => clavesParche[i]),
    numerosDeFila: separacion.indices.map((i) => numeroDe(i)),
    filasOrigenCompat: separacion.indicesCompatibilidades.map((i) => clavesParche[i]),
    porCompletar,
    cambios,
    separacion,
  };
}

/* ------------------------------ Tabla amarilla ------------------------------ */

/** Columnas que se vacían cuando el repuesto es universal. */
const COLUMNAS_DE_VEHICULO = new Set(['compatibilidad_marca', 'compatibilidad_modelo', 'anio_desde', 'anio_hasta', 'motor']);
const SI = new Set(['SI', 'SÍ', 'TRUE', '1', 'X', 'UNIVERSAL']);

export interface FilaTabla extends FilaRevisada {
  /** Columnas de esta fila que faltan por completar (se pintan amarillas). */
  faltantes: string[];
  sku: string;
  nombre: string;
}

export interface TablaMiExcel {
  columnas: string[];
  filas: FilaTabla[];
  total: number;
  publicables: number;
  conError: number;
  conAviso: number;
  /** Cuántas celdas amarillas tiene cada columna. */
  faltantesPorColumna: Record<string, number>;
  /** Cuántas filas tienen al menos una celda amarilla. */
  filasConFaltantes: number;
  /** Total de celdas amarillas. */
  celdasFaltantes: number;
}

export interface OpcionesTabla {
  campos: CampoMeta[];
  esquema: EsquemaPlantilla;
  mapping: Mapping;
  modelosDisponibles: Record<string, string[]>;
  /** Columnas que el vendedor marcó "no tengo esta columna" (y no se completan solas). */
  columnasACompletar: string[];
  /** Columnas opcionales que el vendedor decidió dejar vacías en todas las filas. */
  opcionalesVacios: string[];
}

/**
 * Qué columnas vigila la tabla: las que el vendedor tiene que completar y las obligatorias.
 * Las que no están acá nunca se pintan, aunque vengan vacías.
 */
export function columnasVigiladas(campos: CampoMeta[], mapping: Mapping, columnasACompletar: string[]): Set<string> {
  const vigiladas = new Set(columnasACompletar);
  for (const campo of campos) if (requiereValorEnPanel(campo, mapping)) vigiladas.add(campo.key);
  return vigiladas;
}

/**
 * ¿Esta celda falta por completar? Sabe de las excepciones que tiene el backend: un repuesto
 * universal no lleva vehículo, uno "sólo cotizar" no lleva precio, y el universal sólo hace
 * falta cuando la fila no trae ningún vehículo.
 */
export function esCeldaAmarilla(
  columna: string,
  leer: (col: string) => string,
  clave: string,
  vigiladas: Set<string>,
  mapping: Mapping,
  opcionalesVacios: Set<string>,
): boolean {
  if (!vigiladas.has(columna)) return false;
  if (leer(columna).trim()) return false;
  if (mapping.parches?.[clave]?.[columna] !== undefined) return false;
  if (opcionalesVacios.has(columna)) return false;
  const universal = SI.has(leer('compatibilidad_general').trim().toUpperCase());
  if (universal && COLUMNAS_DE_VEHICULO.has(columna)) return false;
  if (columna === 'precio' && leer('tipo_precio').toUpperCase().includes('COTIZ')) return false;
  if (columna === 'compatibilidad_general'
    && (leer('compatibilidad_marca').trim() || leer('compatibilidad_modelo').trim())) return false;
  // Sin categoría no hay subcategorías que ofrecer: se pinta la categoría, no ésta.
  if (columna === 'subcategoria' && !leer('categoria').trim()) return false;
  return true;
}

export function construirTabla(t: TransformacionMiExcel, o: OpcionesTabla): TablaMiExcel {
  const revision = revisarAoA(t.inventario, o.campos, {
    maxFilas: Number.POSITIVE_INFINITY,
    conservarOrden: true,
    catalogos: o.esquema.catalogos,
    numerosDeFila: t.numerosDeFila,
    clavesDeFila: t.clavesInventario,
    modelosPorMarca: o.modelosDisponibles,
  });
  const vigiladas = columnasVigiladas(o.campos, o.mapping, o.columnasACompletar);
  const vacios = new Set(o.opcionalesVacios);
  const indice = new Map(revision.columnas.map((c, i) => [c, i]));
  const faltantesPorColumna: Record<string, number> = {};
  let filasConFaltantes = 0;
  let celdasFaltantes = 0;

  const filas: FilaTabla[] = revision.filas.map((fila) => {
    const leer = (col: string) => {
      const i = indice.get(col);
      return i === undefined ? '' : String(fila.valores[i] ?? '');
    };
    const faltantes = revision.columnas.filter(
      (col) => esCeldaAmarilla(col, leer, fila.clave, vigiladas, o.mapping, vacios),
    );
    for (const col of faltantes) faltantesPorColumna[col] = (faltantesPorColumna[col] ?? 0) + 1;
    if (faltantes.length > 0) filasConFaltantes += 1;
    celdasFaltantes += faltantes.length;
    return { ...fila, faltantes, sku: leer('sku_proveedor').trim(), nombre: leer('nombre_publicado').trim() };
  });

  return {
    columnas: revision.columnas,
    filas,
    total: revision.total,
    publicables: revision.publicables,
    conError: revision.conError,
    conAviso: revision.conAviso,
    faltantesPorColumna,
    filasConFaltantes,
    celdasFaltantes,
  };
}

/**
 * Las columnas que se muestran: las que traen algún dato, las vigiladas y las que tienen algún
 * problema. Las columnas oficiales que quedaron vacías en todo el archivo y nadie pide sólo
 * alargan la tabla.
 */
export function columnasVisibles(tabla: TablaMiExcel, vigiladas: Set<string>): string[] {
  return tabla.columnas.filter((col, i) => vigiladas.has(col) || tabla.filas.some(
    (f) => (f.valores[i] ?? '').trim() !== '' || f.problemas.some((p) => p.columna === col),
  ));
}

/**
 * "Aplicar a todas las filas vacías": el valor entra como valor por defecto de la columna,
 * que el armado usa sólo donde la celda quedó vacía. Lo que el vendedor corrigió a mano en una
 * celda sigue mandando.
 */
export function aplicarATodasVacias(mapping: Mapping, columna: string, valor: string): Mapping {
  const defaults = { ...(mapping.defaults ?? {}) };
  if (valor.trim()) defaults[columna] = valor;
  else delete defaults[columna];
  return { ...mapping, defaults };
}

/** Una corrección sobre una celda suelta. Vacío también es una corrección ("va sin dato"). */
export function aplicarParche(mapping: Mapping, clave: string, columna: string, valor: string): Mapping {
  const parches = { ...(mapping.parches ?? {}) };
  parches[clave] = { ...(parches[clave] ?? {}), [columna]: valor };
  // El modelo cuelga de la marca: cambiar la marca deja el modelo por elegir de la lista nueva.
  if (columna === 'compatibilidad_marca') parches[clave].compatibilidad_modelo = '';
  return { ...mapping, parches };
}

/**
 * Los campos que el vendedor tiene que completar en la etapa 3: los que no tienen columna en su
 * archivo y no se completan solos con algún ajuste.
 */
export function camposACompletar(
  campos: CampoMeta[],
  mapping: Mapping,
  esAutomatico: (key: string) => boolean,
): string[] {
  return campos
    .filter((c) => !mapping.oficial[c.key])
    .filter((c) => !esAutomatico(c.key))
    // "Todo mi inventario es universal" ya decidió la compatibilidad de todas las filas.
    .filter((c) => !(c.key === 'compatibilidad_general' && (mapping.defaults?.compatibilidad_general ?? '') === 'SI'))
    .map((c) => c.key);
}

/**
 * Lógica pura (sin React) para el flujo "Adaptar mi plantilla": leer el Excel propio
 * del vendedor, mapear sus columnas a la plantilla oficial de RepuesTop y generar un
 * .xlsx con formato oficial que se entrega al flujo de análisis/carga existente.
 *
 * El contrato de columnas (`PLANTILLA_COLUMNAS`) vive aquí y `BulkUpload.tsx` lo
 * re-exporta para no romper el test de contrato ni los imports existentes.
 */

/**
 * Contrato oficial de la plantilla: debe coincidir exactamente con
 * InventarioExcelService.COLUMNAS_EXCEL del backend y con GET /inventario/excel/esquema.
 * Si el backend cambia una columna, el test de contrato falla y avisa antes que el vendedor.
 */
export const PLANTILLA_COLUMNAS = [
  'nombre_publicado',
  'categoria',
  'subcategoria',
  'marca_repuesto',
  'sku_proveedor',
  'referencia_oem',
  'tipo_precio',
  'precio',
  'stock',
  'condicion',
  'compatibilidad_general',
  'compatibilidad_marca',
  'compatibilidad_modelo',
  'anio_desde',
  'anio_hasta',
  'motor',
  'descripcion',
  'requiere_chasis',
] as const;

export type OficialCol = (typeof PLANTILLA_COLUMNAS)[number];

export interface CampoMeta {
  key: OficialCol;
  label: string;
  required: boolean;
  /** Valores permitidos para columnas de tipo lista. El backend es la fuente autoritativa. */
  enumHint?: string[];
  /** Sinónimos ya normalizados (ver `normalizeHeader`) para la autodetección. */
  synonyms: string[];
  /** Columnas que se vacían cuando la fila es universal. */
  group?: 'compat' | 'anio' | 'motor';
}

/**
 * Metadatos de cada columna oficial. El orden es el mismo que `PLANTILLA_COLUMNAS`.
 * Punto único de cambio si en el futuro se consume GET /inventario/excel/esquema.
 */
export const PLANTILLA_CAMPOS: CampoMeta[] = [
  { key: 'nombre_publicado', label: 'Nombre publicado', required: true, synonyms: ['nombre', 'titulo', 'producto', 'articulo', 'item', 'nombre producto', 'descripcion corta'] },
  { key: 'categoria', label: 'Categoría', required: true, synonyms: ['rubro', 'familia', 'tipo', 'linea'] },
  { key: 'subcategoria', label: 'Subcategoría', required: false, synonyms: ['subrubro', 'subfamilia', 'sub categoria'] },
  { key: 'marca_repuesto', label: 'Marca del repuesto', required: true, synonyms: ['marca', 'fabricante', 'marca pieza', 'marca parte', 'brand'] },
  { key: 'sku_proveedor', label: 'SKU / Código', required: true, synonyms: ['sku', 'codigo', 'cod', 'referencia', 'ref', 'codigo interno', 'codigo proveedor', 'part number', 'numero de parte', 'no parte'] },
  { key: 'referencia_oem', label: 'Referencia OEM', required: false, synonyms: ['oem', 'codigo oem', 'numero oem', 'ref oem', 'original oem'] },
  { key: 'tipo_precio', label: 'Tipo de precio', required: true, enumHint: ['MOSTRAR_PRECIO', 'SOLO_COTIZAR'], synonyms: ['tipo precio', 'modalidad precio', 'modalidad', 'cotizar'] },
  { key: 'precio', label: 'Precio', required: false, synonyms: ['valor', 'pvp', 'precio venta', 'price', 'monto', 'precio unitario'] },
  { key: 'stock', label: 'Stock', required: true, synonyms: ['cantidad', 'existencias', 'unidades', 'disponible', 'inventario', 'qty', 'stock actual'] },
  { key: 'condicion', label: 'Condición', required: false, enumHint: ['ORIGINAL', 'ALTERNATIVO'], synonyms: ['estado', 'tipo repuesto', 'origen', 'original alternativo'] },
  { key: 'compatibilidad_general', label: 'Compatibilidad universal', required: false, enumHint: ['SI', 'NO'], synonyms: ['universal', 'compatibilidad general', 'generico', 'aplica a todos', 'es universal'] },
  { key: 'compatibilidad_marca', label: 'Marca del vehículo', required: false, group: 'compat', synonyms: ['marca vehiculo', 'marca auto', 'marca compatible', 'vehiculo marca', 'marca del auto'] },
  { key: 'compatibilidad_modelo', label: 'Modelo del vehículo', required: false, group: 'compat', synonyms: ['modelo', 'modelo vehiculo', 'modelo auto', 'modelo compatible'] },
  { key: 'anio_desde', label: 'Año desde', required: false, group: 'anio', synonyms: ['anio', 'ano', 'año', 'año desde', 'desde', 'year', 'año inicio', 'anio inicial'] },
  { key: 'anio_hasta', label: 'Año hasta', required: false, group: 'anio', synonyms: ['año hasta', 'hasta', 'año fin', 'year to', 'anio final'] },
  { key: 'motor', label: 'Motor / versión', required: false, group: 'motor', synonyms: ['version', 'cilindrada', 'motorizacion', 'engine', 'motor version'] },
  { key: 'descripcion', label: 'Descripción', required: false, synonyms: ['detalle', 'observaciones', 'notas', 'comentarios', 'descripcion larga', 'detalles'] },
  { key: 'requiere_chasis', label: 'Requiere número de chasis', required: false, enumHint: ['SI', 'NO'], synonyms: ['requiere chasis', 'chasis', 'vin', 'numero chasis', 'pide chasis'] },
];

const CAMPO_BY_KEY: Record<OficialCol, CampoMeta> = PLANTILLA_CAMPOS.reduce((acc, campo) => {
  acc[campo.key] = campo;
  return acc;
}, {} as Record<OficialCol, CampoMeta>);

/** Índices de columnas oficiales que se vacían cuando la fila es universal. */
const UNIVERSAL_BLANK_KEYS: OficialCol[] = [
  'compatibilidad_marca',
  'compatibilidad_modelo',
  'anio_desde',
  'anio_hasta',
  'motor',
];

const UNIVERSAL_TRUTHY = new Set(['si', 'sí', 'true', '1', 'universal', 'x', 'yes']);

/** trim + minúsculas + sin acentos + no-alfanuméricos colapsados a un espacio. */
export function normalizeHeader(h: string): string {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'para', 'por', 'con', 'a', 'un', 'una']);

/** Igual que `normalizeHeader` pero además quita palabras vacías ("marca del repuesto" -> "marca repuesto"). */
function normalizeForMatch(h: string): string {
  return normalizeHeader(h).split(' ').filter((t) => t && !STOPWORDS.has(t)).join(' ');
}

export interface UserColumn {
  /** Id estable = índice de columna como string. */
  id: string;
  /** Encabezado tal cual venía en el archivo. */
  rawHeader: string;
  /** Encabezado para mostrar (desambiguado / placeholder si venía vacío). */
  displayHeader: string;
  index: number;
}

export interface Mapping {
  /** columna oficial -> id de columna del vendedor (o null si "sin dato"). */
  oficial: Record<OficialCol, string | null>;
  /** id de columna del vendedor sin asignar -> política. */
  extras: Record<string, 'descripcion' | 'ignore'>;
  /** columna oficial -> { valor de origen -> valor oficial }. */
  valueMap: Record<string, Record<string, string>>;
}

/** Letra de columna estilo Excel (0 -> A, 26 -> AA). */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function emptyMapping(): Mapping {
  const oficial = {} as Record<OficialCol, string | null>;
  PLANTILLA_COLUMNAS.forEach((k) => { oficial[k] = null; });
  return { oficial, extras: {}, valueMap: {} };
}

/**
 * Autodetección por nombre de encabezado, en dos pasadas para no dejar que una
 * coincidencia difusa le "robe" una columna a una coincidencia exacta o por sinónimo:
 *   1. exacto (== key sin palabras vacías) o sinónimo exacto.
 *   2. difusa conservadora: todos los tokens del encabezado del vendedor están en los
 *      tokens de la columna oficial y el encabezado tiene 2+ tokens.
 * Cada columna del vendedor se asigna a lo sumo a una columna oficial.
 */
export function autoDetectMapping(userCols: UserColumn[]): Mapping {
  const mapping = emptyMapping();
  const usados = new Set<string>();

  const normCols = userCols.map((c) => ({ col: c, norm: normalizeForMatch(c.rawHeader) }));

  const campos = PLANTILLA_CAMPOS.map((campo) => ({
    campo,
    keyNorm: normalizeForMatch(campo.key),
    synSet: new Set(campo.synonyms.map(normalizeForMatch)),
    keyTokens: new Set(
      [campo.key, ...campo.synonyms].flatMap((s) => normalizeForMatch(s).split(' ')).filter(Boolean),
    ),
  }));

  // Pasada 1: exacto / sinónimo.
  for (const { campo, keyNorm, synSet } of campos) {
    if (mapping.oficial[campo.key]) continue;
    const hit = normCols.find(({ col, norm }) => norm && !usados.has(col.id) && (norm === keyNorm || synSet.has(norm)));
    if (hit) {
      mapping.oficial[campo.key] = hit.col.id;
      usados.add(hit.col.id);
    }
  }

  // Pasada 2: difusa conservadora.
  for (const { campo, keyTokens } of campos) {
    if (mapping.oficial[campo.key]) continue;
    const hit = normCols.find(({ col, norm }) => {
      if (!norm || usados.has(col.id)) return false;
      const tokens = norm.split(' ').filter(Boolean);
      return tokens.length >= 2 && tokens.every((t) => keyTokens.has(t));
    });
    if (hit) {
      mapping.oficial[campo.key] = hit.col.id;
      usados.add(hit.col.id);
    }
  }

  for (const col of userCols) {
    if (!usados.has(col.id)) mapping.extras[col.id] = 'descripcion';
  }
  return mapping;
}

/** Normaliza un mapping recién cargado/guardado a la lista de columnas actual. */
export function reconcileMapping(saved: Mapping, userCols: UserColumn[]): Mapping {
  const base = emptyMapping();
  const validIds = new Set(userCols.map((c) => c.id));
  const usados = new Set<string>();

  PLANTILLA_COLUMNAS.forEach((k) => {
    const id = saved.oficial?.[k];
    if (id && validIds.has(id) && !usados.has(id)) {
      base.oficial[k] = id;
      usados.add(id);
    }
  });
  base.valueMap = saved.valueMap && typeof saved.valueMap === 'object' ? { ...saved.valueMap } : {};
  for (const col of userCols) {
    if (usados.has(col.id)) continue;
    const pol = saved.extras?.[col.id];
    base.extras[col.id] = pol === 'ignore' ? 'ignore' : 'descripcion';
  }
  return base;
}

export interface ParsedUserFile {
  cols: UserColumn[];
  /** Filas de datos (sin la fila de encabezados), como arreglo de arreglos. */
  rows: unknown[][];
}

/** Lee el archivo con FileReader (funciona en navegador y en jsdom, a diferencia de File.text()). */
function readFile(file: File, as: 'text' | 'array'): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo.'));
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    if (as === 'text') reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

export async function parseUserFile(file: File): Promise<ParsedUserFile> {
  const XLSX = await import('xlsx');
  const isCsv = /\.csv$/i.test(file.name);

  let workbook;
  if (isCsv) {
    let text = (await readFile(file, 'text')) as string;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
    workbook = XLSX.read(text, { type: 'string' });
  } else {
    const buffer = (await readFile(file, 'array')) as ArrayBuffer;
    workbook = XLSX.read(buffer, { type: 'array' });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('No pudimos leer la primera hoja del archivo.');

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const headerRow = (aoa[0] as unknown[]) ?? [];
  if (headerRow.length === 0) throw new Error('La primera fila del archivo no tiene títulos de columna.');

  const rows = aoa.slice(1).filter((r) => (r as unknown[]).some((c) => String(c ?? '').trim() !== ''));
  if (rows.length === 0) throw new Error('No encontramos filas de datos debajo de los títulos.');

  const seen = new Map<string, number>();
  const cols: UserColumn[] = headerRow.map((raw, index) => {
    const rawHeader = String(raw ?? '').trim();
    let displayHeader: string;
    if (!rawHeader) {
      displayHeader = `(columna ${columnLetter(index)} — sin título)`;
    } else {
      const count = (seen.get(rawHeader) ?? 0) + 1;
      seen.set(rawHeader, count);
      displayHeader = count > 1 ? `${rawHeader} (columna ${columnLetter(index)})` : rawHeader;
    }
    return { id: String(index), rawHeader, displayHeader, index };
  });

  return { cols, rows };
}

/** Valores distintos no vacíos de una columna de origen (para el mapeo de valores). */
export function distinctValuesForColumn(rows: unknown[][], colIndex: number, cap = 20): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const v = String((row as unknown[])[colIndex] ?? '').trim();
    if (v) set.add(v);
    if (set.size > cap) break;
  }
  return [...set];
}

/** Columnas oficiales de tipo lista que fueron mapeadas — para construir la sección C. */
export function mappedEnumColumns(mapping: Mapping): { campo: CampoMeta; userColId: string }[] {
  return PLANTILLA_CAMPOS
    .filter((c) => c.enumHint && mapping.oficial[c.key])
    .map((campo) => ({ campo, userColId: mapping.oficial[campo.key] as string }));
}

/**
 * Construye la matriz (arreglo de arreglos) en formato oficial a partir de las filas
 * del vendedor y el mapping. Fila 0 = encabezados oficiales.
 */
export function buildOfficialAoA(rows: unknown[][], userCols: UserColumn[], mapping: Mapping): (string | number)[][] {
  const idToIndex = new Map(userCols.map((c) => [c.id, c.index]));
  const idToCol = new Map(userCols.map((c) => [c.id, c]));

  const descripcionExtras = Object.entries(mapping.extras)
    .filter(([, policy]) => policy === 'descripcion')
    .map(([id]) => idToCol.get(id))
    .filter((c): c is UserColumn => !!c);

  const readCell = (row: unknown[], id: string | null): string => {
    if (!id) return '';
    const idx = idToIndex.get(id);
    if (idx === undefined) return '';
    const v = row[idx];
    return v === undefined || v === null ? '' : String(v).trim();
  };

  const applyValueMap = (key: OficialCol, value: string): string => {
    const table = mapping.valueMap[key];
    if (!table) return value;
    return table[value] ?? value;
  };

  const header = [...PLANTILLA_COLUMNAS] as string[];
  const out: (string | number)[][] = [header];

  for (const raw of rows) {
    const row = raw as unknown[];

    // Valor base por columna oficial.
    const cells: Record<OficialCol, string> = {} as Record<OficialCol, string>;
    for (const key of PLANTILLA_COLUMNAS) {
      let value = readCell(row, mapping.oficial[key]);
      if (CAMPO_BY_KEY[key].enumHint) value = applyValueMap(key, value);
      cells[key] = value;
    }

    // Descripción compuesta: valor mapeado + columnas extra marcadas "a la descripción".
    const extraLines = descripcionExtras
      .map((col) => {
        const v = String(row[col.index] ?? '').trim();
        return v ? `${col.rawHeader || `Columna ${columnLetter(col.index)}`}: ${v}` : '';
      })
      .filter(Boolean);
    const bloques = [cells.descripcion, extraLines.join('\n')].filter(Boolean);
    cells.descripcion = bloques.join('\n\n');

    // Blanqueo universal.
    if (UNIVERSAL_TRUTHY.has(normalizeHeader(cells.compatibilidad_general))) {
      for (const key of UNIVERSAL_BLANK_KEYS) cells[key] = '';
    }

    out.push(PLANTILLA_COLUMNAS.map((key) => cells[key]));
  }

  return out;
}

export async function buildOfficialXlsxFile(aoa: (string | number)[][], filename: string): Promise<File> {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'inventario');
  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([wbout], filename, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/* ---------------------------------------------------------------------------
 * Persistencia de mapeos en localStorage (asociados a la estructura de títulos)
 * ------------------------------------------------------------------------- */

export const COLUMN_MAPPINGS_KEY = 'repuestop_column_mappings';

/** Firma estable de la estructura de columnas del archivo (independiente del orden). */
export function headerSignature(userCols: UserColumn[]): string {
  return userCols
    .map((c) => normalizeHeader(c.rawHeader) || `col${c.index}`)
    .sort()
    .join('|');
}

type MappingStore = Record<string, Mapping>;

function readStore(): MappingStore {
  try {
    const raw = localStorage.getItem(COLUMN_MAPPINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as MappingStore : {};
  } catch {
    return {};
  }
}

export function loadSavedMapping(signature: string): Mapping | null {
  const store = readStore();
  const m = store[signature];
  if (!m || typeof m !== 'object' || !m.oficial) return null;
  return m;
}

export function saveMapping(signature: string, mapping: Mapping): void {
  try {
    const store = readStore();
    store[signature] = mapping;
    localStorage.setItem(COLUMN_MAPPINGS_KEY, JSON.stringify(store));
  } catch {
    /* localStorage lleno o no disponible: el mapeo simplemente no se recuerda. */
  }
}

/** Timestamp compacto para nombres de archivo (idéntico al de BulkUpload). */
export function getIsoTimestampString(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

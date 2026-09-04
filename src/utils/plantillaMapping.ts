import {
  normalizarCelda,
  partirRangoAnios,
  type CambioNormalizacion,
} from './plantillaNormalizacion';
import { parsearAplicacion } from './plantillaCompatibilidad';
import { buscarEnCatalogo } from './plantillaCatalogos';

/**
 * Lógica pura (sin React) para el flujo "Adaptar mi plantilla": leer el Excel propio
 * del vendedor, mapear sus columnas a la plantilla oficial de RepuesTop y generar un
 * .xlsx con formato oficial que se entrega al flujo de análisis/carga existente.
 *
 * El contrato de columnas (`PLANTILLA_COLUMNAS`) vive aquí y `BulkUpload.tsx` lo
 * re-exporta para no romper el test de contrato ni los imports existentes.
 */

/**
 * Contrato de respaldo. La fuente autoritativa es GET /inventario/excel/esquema
 * (ver `ESQUEMA_FALLBACK` y `camposDesdeEsquema`); esta lista es la copia local que se
 * usa cuando ese endpoint no responde, y la que compara el test de contrato contra
 * InventarioExcelService.COLUMNAS_EXCEL del backend.
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

/**
 * El esquema tal como lo entrega GET /inventario/excel/esquema. Es la fuente
 * autoritativa: qué columnas tiene la plantilla, cuáles son obligatorias, qué versión
 * declara y qué valores acepta el backend. El panel sólo pone encima lo que el backend
 * no sabe: etiquetas en español y sinónimos de autodetección.
 */
export interface EsquemaPlantilla {
  version: string;
  columnas: string[];
  columnasObligatorias: string[];
  hojaCompatibilidadesColumnas: string[];
  catalogos: {
    categorias: string[];
    subcategoriasPorCategoria: Record<string, string[]>;
    marcasRepuesto: string[];
    marcasVehiculo: string[];
    tiposPrecio: string[];
    condiciones: string[];
  };
}

/**
 * Esquema de respaldo: el contrato del backend copiado al día de hoy. Se usa cuando
 * /excel/esquema no responde, porque un endpoint caído no puede dejar al vendedor sin
 * poder cargar su inventario.
 *
 * Los catálogos de categorías y marcas van vacíos a propósito: una copia local que se
 * desactualiza hace más daño que la ausencia, porque haría "traducir" los valores del
 * vendedor a nombres que el backend ya no acepta. Los enums que son parte del contrato
 * y no de la base de datos (tipo de precio, condición) sí se copian.
 */
export const ESQUEMA_FALLBACK: EsquemaPlantilla = {
  version: '2.1.0',
  columnas: [...PLANTILLA_COLUMNAS],
  columnasObligatorias: ['nombre_publicado', 'categoria', 'marca_repuesto', 'sku_proveedor', 'stock'],
  hojaCompatibilidadesColumnas: [
    'sku_proveedor',
    'compatibilidad_marca',
    'compatibilidad_modelo',
    'anio_desde',
    'anio_hasta',
    'motor',
    'referencia_oem',
  ],
  catalogos: {
    categorias: [],
    subcategoriasPorCategoria: {},
    marcasRepuesto: [],
    marcasVehiculo: [],
    tiposPrecio: ['MOSTRAR_PRECIO', 'SOLO_COTIZAR'],
    condiciones: ['ORIGINAL', 'ALTERNATIVO'],
  },
};

export interface CampoMeta {
  /** Nombre de la columna oficial. Es `string` y no `OficialCol` porque las columnas
   *  llegan del esquema: el backend puede agregar una que el panel todavía no conoce. */
  key: string;
  label: string;
  required: boolean;
  /** Valores permitidos para columnas de tipo lista. El backend es la fuente autoritativa. */
  enumHint?: string[];
  /** Sinónimos ya normalizados (ver `normalizeHeader`) para la autodetección. */
  synonyms: string[];
  /** Columnas que se vacían cuando la fila es universal. */
  group?: 'compat' | 'anio' | 'motor';
}

interface CampoTexto {
  label: string;
  synonyms: string[];
  group?: 'compat' | 'anio' | 'motor';
}

/**
 * Lo único que queda hardcodeado por columna: cómo se le dice al vendedor y con qué
 * encabezados suyos se la reconoce. Si el backend agrega una columna, el panel la
 * muestra igual (con una etiqueta derivada del nombre) y sólo pierde la autodetección
 * hasta que se le agreguen sinónimos acá.
 */
const PLANTILLA_TEXTOS: Record<string, CampoTexto> = {
  nombre_publicado: { label: 'Nombre publicado', synonyms: ['nombre', 'titulo', 'producto', 'articulo', 'item', 'nombre producto', 'descripcion corta'] },
  categoria: { label: 'Categoría', synonyms: ['rubro', 'familia', 'tipo', 'linea'] },
  subcategoria: { label: 'Subcategoría', synonyms: ['subrubro', 'subfamilia', 'sub categoria'] },
  marca_repuesto: { label: 'Marca del repuesto', synonyms: ['marca', 'fabricante', 'marca pieza', 'marca parte', 'brand'] },
  sku_proveedor: { label: 'SKU / Código', synonyms: ['sku', 'codigo', 'cod', 'referencia', 'ref', 'codigo interno', 'codigo proveedor', 'part number', 'numero de parte', 'no parte'] },
  referencia_oem: { label: 'Referencia OEM', synonyms: ['oem', 'codigo oem', 'numero oem', 'ref oem', 'original oem'] },
  tipo_precio: { label: 'Tipo de precio', synonyms: ['tipo precio', 'modalidad precio', 'modalidad', 'cotizar'] },
  precio: { label: 'Precio', synonyms: ['valor', 'pvp', 'precio venta', 'price', 'monto', 'precio unitario'] },
  stock: { label: 'Stock', synonyms: ['cantidad', 'existencias', 'unidades', 'disponible', 'inventario', 'qty', 'stock actual'] },
  condicion: { label: 'Condición', synonyms: ['estado', 'tipo repuesto', 'origen', 'original alternativo'] },
  compatibilidad_general: { label: 'Compatibilidad universal', synonyms: ['universal', 'compatibilidad general', 'generico', 'aplica a todos', 'es universal'] },
  compatibilidad_marca: { label: 'Marca del vehículo', group: 'compat', synonyms: ['marca vehiculo', 'marca auto', 'marca compatible', 'vehiculo marca', 'marca del auto'] },
  compatibilidad_modelo: { label: 'Modelo del vehículo', group: 'compat', synonyms: ['modelo', 'modelo vehiculo', 'modelo auto', 'modelo compatible', 'aplicacion', 'aplicaciones', 'aplicacion vehiculo', 'compatibilidad', 'compatible con', 'vehiculo'] },
  anio_desde: { label: 'Año desde', group: 'anio', synonyms: ['anio', 'ano', 'año', 'años', 'anios', 'anos', 'año desde', 'desde', 'year', 'año inicio', 'anio inicial', 'rango de años', 'año modelo'] },
  anio_hasta: { label: 'Año hasta', group: 'anio', synonyms: ['año hasta', 'hasta', 'año fin', 'year to', 'anio final'] },
  motor: { label: 'Motor / versión', group: 'motor', synonyms: ['version', 'cilindrada', 'motorizacion', 'engine', 'motor version'] },
  descripcion: { label: 'Descripción', synonyms: ['detalle', 'observaciones', 'notas', 'comentarios', 'descripcion larga', 'detalles'] },
  requiere_chasis: { label: 'Requiere número de chasis', synonyms: ['requiere chasis', 'chasis', 'vin', 'numero chasis', 'pide chasis'] },
};

/**
 * Valores de lista que son parte del contrato del Excel y no de la base de datos, así
 * que no viajan en los catálogos del esquema. Los catálogos de categorías y marcas se
 * usan recién en la Fase 5: meterlos acá hoy convertiría "Traducir valores" en una
 * pantalla con cientos de selects, que es justo lo que esa fase resuelve bien.
 */
const ENUM_FIJOS: Record<string, string[]> = {
  compatibilidad_general: ['SI', 'NO'],
  requiere_chasis: ['SI', 'NO'],
};

/** Etiqueta legible para una columna que el backend agregó y el panel aún no conoce. */
function labelPorDefecto(key: string): string {
  const texto = key.replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Combina el esquema del backend (columnas, obligatorias, catálogos) con los textos del
 * panel. Todo lo que el flujo de mapeo recorre sale de acá, así que una columna nueva en
 * el backend aparece sola en la pantalla sin tocar el panel.
 */
export function camposDesdeEsquema(esquema: EsquemaPlantilla): CampoMeta[] {
  const obligatorias = new Set(esquema.columnasObligatorias);
  return esquema.columnas.map((key) => {
    const texto = PLANTILLA_TEXTOS[key];
    const enumHint =
      key === 'tipo_precio' ? esquema.catalogos?.tiposPrecio
        : key === 'condicion' ? esquema.catalogos?.condiciones
          : ENUM_FIJOS[key];
    const campo: CampoMeta = {
      key,
      label: texto?.label ?? labelPorDefecto(key),
      required: obligatorias.has(key),
      synonyms: texto?.synonyms ?? [],
    };
    if (texto?.group) campo.group = texto.group;
    if (enumHint?.length) campo.enumHint = enumHint;
    return campo;
  });
}

/** Campos derivados del esquema de respaldo. Default de las funciones de este módulo. */
export const PLANTILLA_CAMPOS: CampoMeta[] = camposDesdeEsquema(ESQUEMA_FALLBACK);

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
  oficial: Record<string, string | null>;
  /** id de columna del vendedor sin asignar -> política. */
  extras: Record<string, 'descripcion' | 'ignore'>;
  /** columna oficial -> { valor de origen -> valor oficial }. */
  valueMap: Record<string, Record<string, string>>;
  /**
   * columna oficial -> valor fijo para todas las filas. La salida del vendedor cuando su
   * Excel simplemente no tiene esa columna ("todo mi inventario es alternativo"). Se usa
   * cuando la celda queda vacía, venga o no de una columna mapeada.
   */
  defaults?: Record<string, string>;
  /**
   * La columna de años del vendedor trae un rango en una sola celda ("2014-2020") y hay
   * que partirlo en año desde / año hasta. Se propone solo cuando el archivo lo trae.
   */
  dividirAnios?: boolean;
  /**
   * La columna de compatibilidad trae marca, modelo y años juntos ("Toyota Corolla
   * 2014-2020"), como se escribe en las listas de repuestos.
   */
  parsearAplicacion?: boolean;
  /**
   * El archivo repite el mismo SKU una vez por vehículo. En vez de tratarlos como
   * duplicados —que el backend rechaza— se convierten en un repuesto con varias
   * compatibilidades, en la hoja `compatibilidades` de la plantilla.
   */
  agruparPorSku?: boolean;
  /**
   * Columna del vendedor que trae la foto de cada repuesto (URL o nombre de archivo). No
   * es una columna oficial: la plantilla no tiene columna de imagen. Se usa para el paso
   * de fotos, después de publicar.
   */
  columnaFotos?: string | null;
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

function emptyMapping(campos: CampoMeta[]): Mapping {
  const oficial: Record<string, string | null> = {};
  campos.forEach((c) => { oficial[c.key] = null; });
  return { oficial, extras: {}, valueMap: {}, defaults: {} };
}

/**
 * Autodetección por nombre de encabezado, en dos pasadas para no dejar que una
 * coincidencia difusa le "robe" una columna a una coincidencia exacta o por sinónimo:
 *   1. exacto (== key sin palabras vacías) o sinónimo exacto.
 *   2. difusa conservadora: todos los tokens del encabezado del vendedor están en los
 *      tokens de la columna oficial y el encabezado tiene 2+ tokens.
 * Cada columna del vendedor se asigna a lo sumo a una columna oficial.
 */
export function autoDetectMapping(userCols: UserColumn[], camposEsquema: CampoMeta[] = PLANTILLA_CAMPOS): Mapping {
  const mapping = emptyMapping(camposEsquema);
  const usados = new Set<string>();

  const normCols = userCols.map((c) => ({ col: c, norm: normalizeForMatch(c.rawHeader) }));

  const campos = camposEsquema.map((campo) => ({
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
export function reconcileMapping(
  saved: Mapping,
  userCols: UserColumn[],
  campos: CampoMeta[] = PLANTILLA_CAMPOS,
): Mapping {
  const base = emptyMapping(campos);
  const validIds = new Set(userCols.map((c) => c.id));
  const usados = new Set<string>();

  campos.forEach(({ key: k }) => {
    const id = saved.oficial?.[k];
    if (id && validIds.has(id) && !usados.has(id)) {
      base.oficial[k] = id;
      usados.add(id);
    }
  });
  base.valueMap = saved.valueMap && typeof saved.valueMap === 'object' ? { ...saved.valueMap } : {};
  base.defaults = saved.defaults && typeof saved.defaults === 'object' ? { ...saved.defaults } : {};
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

/**
 * Una hoja del libro del vendedor, leída completa y sin interpretar. La interpretación
 * (dónde están los títulos) se decide después y se puede cambiar sin volver a leer el
 * archivo.
 */
export interface HojaUsuario {
  nombre: string;
  /** Todas las filas de la hoja tal cual vienen, incluida la de títulos. */
  aoa: unknown[][];
  /** Filas con al menos una celda no vacía. Es lo que se le muestra al vendedor. */
  filasConDatos: number;
}

/** Lee el libro completo. Un CSV se comporta como un libro de una sola hoja. */
export async function leerLibro(file: File): Promise<HojaUsuario[]> {
  const XLSX = await import('xlsx');
  const isCsv = /\.csv$/i.test(file.name);

  let workbook;
  if (isCsv) {
    let text = (await readFile(file, 'text')) as string;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
    // raw: no interpretar los valores del CSV. Sin esto, "$ 4.990" -entera normal en una
    // lista chilena- se lee como el numero 4,99 y el vendedor publica el precio mal sin
    // que nada avise. Como texto llega tal cual lo escribio, y la Fase 4 lo normaliza.
    workbook = XLSX.read(text, { type: 'string', raw: true });
  } else {
    const buffer = (await readFile(file, 'array')) as ArrayBuffer;
    workbook = XLSX.read(buffer, { type: 'array' });
  }

  const hojas: HojaUsuario[] = [];
  for (const nombre of workbook.SheetNames) {
    const sheet = workbook.Sheets[nombre];
    if (!sheet) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    hojas.push({ nombre, aoa, filasConDatos: aoa.filter(filaTieneAlgo).length });
  }
  if (hojas.length === 0) throw new Error('No pudimos leer ninguna hoja del archivo.');
  return hojas;
}

function filaTieneAlgo(fila: unknown[] | undefined): boolean {
  return !!fila && fila.some((c) => String(c ?? '').trim() !== '');
}

/**
 * ¿Esta celda parece un título de columna? Texto que no sea un número, un precio ni una
 * fecha. Se usa para distinguir la fila de títulos de las filas de datos.
 */
function pareceTitulo(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  const texto = valor.trim();
  if (!texto) return false;
  return !/^[-$\s]*[\d.,/%\s]+$/.test(texto);
}

/**
 * Encuentra la fila de títulos: la primera con 3 o más celdas que parezcan títulos.
 *
 * Los Excel de tienda casi nunca empiezan en la fila 1: traen el nombre del negocio, un
 * logo, la fecha de la lista o filas en blanco. Asumir la fila 1 era el error nº1
 * esperable del flujo — el vendedor veía "(columna A — sin título)" y se quedaba ahí.
 * Tres celdas de texto es suficiente para no confundirse con un título de planilla, que
 * ocupa una sola celda.
 */
export function detectarFilaEncabezados(aoa: unknown[][], limite = 30): number {
  const hasta = Math.min(aoa.length, limite);
  for (let i = 0; i < hasta; i++) {
    if ((aoa[i] ?? []).filter(pareceTitulo).length >= 3) return i;
  }
  // Ninguna fila convence: la primera que tenga algo, y que el vendedor corrija a mano.
  for (let i = 0; i < hasta; i++) {
    if (filaTieneAlgo(aoa[i])) return i;
  }
  return 0;
}

/** Hoja con la que conviene abrir: la primera que tenga datos suficientes para mapear. */
export function elegirHojaInicial(hojas: HojaUsuario[]): number {
  const conDatos = hojas.findIndex((h) => h.filasConDatos >= 2);
  return conDatos >= 0 ? conDatos : 0;
}

/**
 * Arma las columnas y las filas de datos a partir de una hoja y de la fila de títulos
 * elegida. No lanza: el wizard necesita poder mostrar una hoja vacía y dejar que el
 * vendedor elija otra en vez de cortarle el paso con un error.
 */
export function columnasDeHoja(aoa: unknown[][], filaEncabezados: number): ParsedUserFile {
  const headerRow = (aoa[filaEncabezados] as unknown[]) ?? [];
  const rows = aoa.slice(filaEncabezados + 1).filter((r) => filaTieneAlgo(r as unknown[]));

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

/**
 * Lectura automática de punta a punta: primera hoja con datos, títulos donde parezca que
 * están. Es el camino que usan los tests y el que el wizard toma como punto de partida
 * antes de que el vendedor corrija hoja o fila.
 */
export async function parseUserFile(file: File): Promise<ParsedUserFile> {
  const hojas = await leerLibro(file);
  const hoja = hojas[elegirHojaInicial(hojas)];
  const { cols, rows } = columnasDeHoja(hoja.aoa, detectarFilaEncabezados(hoja.aoa));
  if (cols.length === 0) throw new Error('La primera fila del archivo no tiene títulos de columna.');
  if (rows.length === 0) throw new Error('No encontramos filas de datos debajo de los títulos.');
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
export function mappedEnumColumns(
  mapping: Mapping,
  campos: CampoMeta[] = PLANTILLA_CAMPOS,
): { campo: CampoMeta; userColId: string }[] {
  return campos
    .filter((c) => c.enumHint && mapping.oficial[c.key])
    .map((campo) => ({ campo, userColId: mapping.oficial[campo.key] as string }));
}

/**
 * Construye la matriz (arreglo de arreglos) en formato oficial a partir de las filas
 * del vendedor y el mapping. Fila 0 = encabezados oficiales.
 */
export function buildOfficialAoADetallado(
  rows: unknown[][],
  userCols: UserColumn[],
  mapping: Mapping,
  campos: CampoMeta[] = PLANTILLA_CAMPOS,
  /** Catálogos reales: para partir la aplicación y para escribir los nombres tal cual. */
  catalogos: EsquemaPlantilla['catalogos'] = ESQUEMA_FALLBACK.catalogos,
): { aoa: (string | number)[][]; cambios: CambioNormalizacion[] } {
  const marcasVehiculo = catalogos.marcasVehiculo;
  // El backend busca estos nombres con findByNombreIgnoreCase, que ignora mayusculas
  // pero NO tildes: "Suspension" no encuentra a "Suspensión" y la fila se rechaza. Si el
  // valor del vendedor identifica sin ambigüedad a uno del catálogo, se escribe el nombre
  // del catálogo; es el mismo criterio con el que se armó la taxonomía.
  const catalogoPorColumna: Record<string, string[]> = {
    categoria: catalogos.categorias,
    marca_repuesto: catalogos.marcasRepuesto,
    compatibilidad_marca: catalogos.marcasVehiculo,
    subcategoria: Object.values(catalogos.subcategoriasPorCategoria ?? {}).flat(),
  };
  const cambios: CambioNormalizacion[] = [];
  const columnas = campos.map((c) => c.key);
  // Las columnas que se vacían cuando la fila es universal salen del propio esquema:
  // son las que el panel agrupa como compatibilidad, años y motor.
  const universalBlankKeys = campos.filter((c) => c.group).map((c) => c.key);
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

  const applyValueMap = (key: string, value: string): string => {
    const table = mapping.valueMap[key];
    if (!table) return value;
    return table[value] ?? value;
  };

  const out: (string | number)[][] = [[...columnas]];

  for (const raw of rows) {
    const row = raw as unknown[];

    // Valor base por columna oficial.
    const cells: Record<string, string> = {};
    for (const key of columnas) {
      // La traducción de valores vale para cualquier columna, no sólo para las de lista:
      // desde la Fase 5 también se traducen categorías, subcategorías y marcas contra el
      // catálogo real. Sólo hay tabla donde el vendedor decidió algo.
      cells[key] = applyValueMap(key, readCell(row, mapping.oficial[key] ?? null));
    }

    // Aplicación escrita de corrido: "Toyota Corolla 2014-2020" se reparte en marca,
    // modelo y años. Si no se reconoce la marca no se toca nada: inventar una
    // compatibilidad es peor que no declarar ninguna.
    if (mapping.parsearAplicacion) {
      const fuente = cells.compatibilidad_modelo || cells.compatibilidad_marca || '';
      const app = parsearAplicacion(fuente, marcasVehiculo);
      if (app) {
        cells.compatibilidad_marca = app.marca;
        cells.compatibilidad_modelo = app.modelo;
        if (!cells.anio_desde) cells.anio_desde = app.anioDesde;
        if (!cells.anio_hasta) cells.anio_hasta = app.anioHasta;
      }
    }

    // Rango de años en una sola columna: "2014-2020" se reparte en las dos oficiales.
    // Sólo si el vendedor no trajo su propia columna de "año hasta" con dato.
    if (mapping.dividirAnios) {
      const rango = partirRangoAnios(cells.anio_desde ?? '');
      if (rango) {
        cells.anio_desde = rango.desde;
        if (!cells.anio_hasta) cells.anio_hasta = rango.hasta;
      }
    }

    // Limpieza: números al formato que espera el backend, SI/NO desde la X de la planilla,
    // espacios de más. Lo que no se puede interpretar se deja igual y lo marca el paso 3.
    for (const key of columnas) {
      const { valor, cambio } = normalizarCelda(key, cells[key]);
      cells[key] = valor;
      if (cambio) cambios.push(cambio);

      const catalogo = catalogoPorColumna[key];
      if (!catalogo?.length || !cells[key]) continue;
      const canonico = buscarEnCatalogo(cells[key], catalogo);
      if (canonico && canonico !== cells[key]) {
        cambios.push({ columna: key, antes: cells[key], despues: canonico });
        cells[key] = canonico;
      }
    }

    // El valor fijo entra donde el archivo no dice nada, sea porque la columna no está
    // mapeada o porque esa celda venía vacía.
    for (const key of columnas) {
      if (!cells[key]) cells[key] = mapping.defaults?.[key] ?? '';
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
    if (UNIVERSAL_TRUTHY.has(normalizeHeader(cells.compatibilidad_general ?? ''))) {
      for (const key of universalBlankKeys) cells[key] = '';
    }

    out.push(columnas.map((key) => cells[key]));
  }

  return { aoa: out, cambios };
}

/** Igual que `buildOfficialAoADetallado`, cuando sólo interesa el archivo resultante. */
export function buildOfficialAoA(
  rows: unknown[][],
  userCols: UserColumn[],
  mapping: Mapping,
  campos: CampoMeta[] = PLANTILLA_CAMPOS,
  catalogos: EsquemaPlantilla['catalogos'] = ESQUEMA_FALLBACK.catalogos,
): (string | number)[][] {
  return buildOfficialAoADetallado(rows, userCols, mapping, campos, catalogos).aoa;
}

/**
 * Genera el .xlsx en formato oficial que se entrega al análisis.
 *
 * La hoja "instrucciones" con la versión no es decorativa: el backend lee las filas por
 * posición, y un archivo que no declara de qué plantilla salió sólo se podía validar por
 * sus encabezados. Declarando la versión, si el archivo se guarda y se vuelve a subir
 * después de un cambio mayor de plantilla, el rechazo dice exactamente qué pasó en vez de
 * hablar de una columna suelta.
 */
export async function buildOfficialXlsxFile(
  aoa: (string | number)[][],
  filename: string,
  version: string = ESQUEMA_FALLBACK.version,
  /** Hoja opcional con una fila por vehículo, agrupadas por SKU. */
  compatibilidades?: (string | number)[][],
): Promise<File> {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'inventario');
  // La hoja va sólo si tiene filas: una hoja vacía haría al backend validar encabezados
  // de algo que no aporta nada.
  if (compatibilidades && compatibilidades.length > 1) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(compatibilidades), 'compatibilidades');
  }
  const instrucciones = XLSX.utils.aoa_to_sheet([
    [`VERSION_PLANTILLA: ${version}`],
    ['Archivo generado por el panel de vendedor de RepuesTop a partir del Excel propio del vendedor.'],
    ['No cambies los títulos de la hoja "inventario": el sistema los lee tal cual están.'],
  ]);
  XLSX.utils.book_append_sheet(workbook, instrucciones, 'instrucciones');
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

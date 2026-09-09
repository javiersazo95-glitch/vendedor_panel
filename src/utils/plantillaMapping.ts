import {
  normalizarCelda,
  partirRangoAnios,
  type CambioNormalizacion,
} from './plantillaNormalizacion';
import { buscarEnCatalogo, buscarEnTexto } from './plantillaCatalogos';
import { parsearAplicacion, separarAplicaciones } from './plantillaCompatibilidad';
import {
  detectarBandas,
  detectarFilasNoRepuesto,
  type FilaDescartada,
} from './plantillaFilas';
import { MARCAS_VEHICULO_BASE } from './marcasVehiculoBase';

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
    marcasVehiculo: MARCAS_VEHICULO_BASE,
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
  /** Explicación en lenguaje sencillo para el vendedor sobre qué significa este dato. */
  descripcion?: string;
  /** Ejemplo representativo para que el vendedor identifique el dato de inmediato. */
  ejemplo?: string;
  /** Sección temática para agrupar visualmente en la interfaz. */
  seccion?: 'obligatorios' | 'precio_condicion' | 'compatibilidad' | 'opcionales';
}

interface CampoTexto {
  label: string;
  synonyms: string[];
  group?: 'compat' | 'anio' | 'motor';
  descripcion?: string;
  ejemplo?: string;
  seccion?: 'obligatorios' | 'precio_condicion' | 'compatibilidad' | 'opcionales';
}

export interface SeccionMapper {
  id: 'obligatorios' | 'precio_condicion' | 'compatibilidad' | 'opcionales';
  titulo: string;
  descripcion: string;
}

export const SECCIONES_MAPPER: SeccionMapper[] = [
  {
    id: 'obligatorios',
    titulo: '1. Datos Principales del Repuesto (Obligatorios)',
    descripcion: 'RepuesTop necesita estos datos para poder crear y catalogar el repuesto en tu inventario.',
  },
  {
    id: 'precio_condicion',
    titulo: '2. Precio y Condición de Venta',
    descripcion: 'Indica el valor de venta y si el repuesto es original o alternativo homologado.',
  },
  {
    id: 'compatibilidad',
    titulo: '3. Compatibilidad con Vehículos',
    descripcion: 'Indica a qué automóviles le sirve el repuesto (o márcalo como universal si aplica a todos).',
  },
  {
    id: 'opcionales',
    titulo: '4. Datos Adicionales (Opcionales)',
    descripcion: 'Información complementaria que ayuda al comprador a encontrar tu producto con mayor rapidez.',
  },
];

/**
 * Lo único que queda hardcodeado por columna: cómo se le dice al vendedor y con qué
 * encabezados suyos se la reconoce. Si el backend agrega una columna, el panel la
 * muestra igual (con una etiqueta derivada del nombre) y sólo pierde la autodetección
 * hasta que se le agreguen sinónimos acá.
 */
const PLANTILLA_TEXTOS: Record<string, CampoTexto> = {
  nombre_publicado: {
    label: 'Nombre publicado',
    seccion: 'obligatorios',
    descripcion: 'Título principal del repuesto con el que aparecerá en el catálogo y en las búsquedas de clientes.',
    ejemplo: 'Ej: Pastilla de freno delantera Yaris 1.5',
    // "detalle" y "glosa" van al final: si la planilla trae además una columna "Nombre",
    // esa gana, y el detalle queda libre para la descripción.
    synonyms: ['nombre', 'titulo', 'producto', 'articulo', 'item', 'nombre producto', 'descripcion corta', 'descripcion producto', 'descripcion articulo', 'glosa', 'detalle', 'descripcion'],
  },
  sku_proveedor: {
    label: 'SKU / Código',
    seccion: 'obligatorios',
    descripcion: 'Tu código interno de producto o número de parte con el que identificas el repuesto en bodega.',
    ejemplo: 'Ej: PF-100, 0986AB01',
    synonyms: ['sku', 'codigo', 'cod', 'referencia', 'ref', 'codigo interno', 'codigo proveedor', 'part number', 'numero de parte', 'no parte', 'cod art', 'cod articulo', 'codigo articulo', 'cod producto', 'nro parte', 'n parte'],
  },
  marca_repuesto: {
    label: 'Marca del repuesto',
    seccion: 'obligatorios',
    descripcion: 'Fabricante de la pieza o repuesto (por ejemplo Bosch, Valeo, Brembo, o la marca del auto si es genuino).',
    ejemplo: 'Ej: Bosch, Brembo, Valeo, Toyota, Mann',
    synonyms: ['marca', 'fabricante', 'marca pieza', 'marca parte', 'brand', 'mca', 'marca art'],
  },
  categoria: {
    label: 'Categoría',
    seccion: 'obligatorios',
    descripcion: 'Familia o sistema del auto al que pertenece el repuesto dentro del catálogo de RepuesTop.',
    ejemplo: 'Ej: Frenos, Motor, Suspensión, Filtros',
    synonyms: ['rubro', 'familia', 'tipo', 'linea', 'grupo', 'categoria producto'],
  },
  stock: {
    label: 'Stock',
    seccion: 'obligatorios',
    descripcion: 'Cantidad de unidades físicas disponibles para la venta inmediata.',
    ejemplo: 'Ej: 10',
    synonyms: ['cantidad', 'existencias', 'unidades', 'disponible', 'inventario', 'qty', 'stock actual', 'exist', 'existencia', 'cant', 'saldo', 'stock disponible'],
  },

  precio: {
    label: 'Precio',
    seccion: 'precio_condicion',
    descripcion: 'Precio de venta al público en pesos (CLP) sin puntos ni símbolos.',
    ejemplo: 'Ej: 24990',
    synonyms: ['valor', 'pvp', 'precio venta', 'price', 'monto', 'precio unitario', 'p u', 'pu', 'precio unit', 'valor unitario', 'precio neto', 'precio publico'],
  },
  tipo_precio: {
    label: 'Tipo de precio',
    seccion: 'precio_condicion',
    descripcion: 'Indica si el precio se muestra públicamente o si el cliente debe cotizarlo.',
    ejemplo: 'MOSTRAR_PRECIO (precio visible) · SOLO_COTIZAR (a cotizar)',
    synonyms: ['tipo precio', 'modalidad precio', 'modalidad', 'cotizar'],
  },
  condicion: {
    label: 'Condición',
    seccion: 'precio_condicion',
    descripcion: 'Indica si el repuesto es original de fábrica (genuino) o alternativo homologado.',
    ejemplo: 'ORIGINAL (genuino de fábrica) · ALTERNATIVO (homologado)',
    synonyms: ['estado', 'tipo repuesto', 'origen', 'original alternativo'],
  },

  compatibilidad_general: {
    label: 'Compatibilidad universal',
    seccion: 'compatibilidad',
    descripcion: 'Marca "SI" si la pieza sirve para cualquier auto (como aceites, ampolletas o fusibles) o "NO" si es para modelos específicos.',
    ejemplo: 'SI (para cualquier auto) · NO (para modelos específicos)',
    synonyms: ['universal', 'compatibilidad general', 'generico', 'aplica a todos', 'es universal'],
  },
  compatibilidad_marca: {
    label: 'Marca del vehículo',
    group: 'compat',
    seccion: 'compatibilidad',
    descripcion: 'Marca del automóvil al que le sirve este repuesto.',
    ejemplo: 'Ej: Toyota, Chevrolet, Hyundai, Nissan',
    synonyms: ['marca vehiculo', 'marca auto', 'marca compatible', 'vehiculo marca', 'marca del auto'],
  },
  compatibilidad_modelo: {
    label: 'Modelo del vehículo',
    group: 'compat',
    seccion: 'compatibilidad',
    descripcion: 'Modelo del automóvil compatible con el repuesto.',
    ejemplo: 'Ej: Yaris, Sail, Accent, Hilux',
    synonyms: ['modelo', 'modelo vehiculo', 'modelo auto', 'modelo compatible', 'aplicacion', 'aplicaciones', 'aplicacion vehiculo', 'compatibilidad', 'compatible con', 'vehiculo'],
  },
  anio_desde: {
    label: 'Año desde',
    group: 'anio',
    seccion: 'compatibilidad',
    descripcion: 'Año inicial en que se fabricó el automóvil compatible.',
    ejemplo: 'Ej: 2014',
    synonyms: ['anio', 'ano', 'año', 'años', 'anios', 'anos', 'año desde', 'desde', 'year', 'año inicio', 'anio inicial', 'rango de años', 'año modelo'],
  },
  anio_hasta: {
    label: 'Año hasta',
    group: 'anio',
    seccion: 'compatibilidad',
    descripcion: 'Año final en que se fabricó el automóvil compatible.',
    ejemplo: 'Ej: 2020',
    synonyms: ['año hasta', 'hasta', 'año fin', 'year to', 'anio final'],
  },
  motor: {
    label: 'Motor / versión',
    group: 'motor',
    seccion: 'compatibilidad',
    descripcion: 'Cilindrada, tipo de combustible o versión de motor compatible.',
    ejemplo: 'Ej: 1.5cc, 1.6 DOHC, 2.0 Diésel',
    synonyms: ['version', 'cilindrada', 'motorizacion', 'engine', 'motor version'],
  },

  subcategoria: {
    label: 'Subcategoría',
    seccion: 'opcionales',
    descripcion: 'Clasificación más específica dentro de la categoría principal.',
    ejemplo: 'Ej: Pastillas de freno, Discos de freno',
    synonyms: ['subrubro', 'subfamilia', 'sub categoria'],
  },
  referencia_oem: {
    label: 'Referencia OEM',
    seccion: 'opcionales',
    descripcion: 'Código original asignado por la fábrica automotriz del vehículo.',
    ejemplo: 'Ej: 04465-02220',
    synonyms: ['oem', 'codigo oem', 'numero oem', 'ref oem', 'original oem'],
  },
  descripcion: {
    label: 'Descripción',
    seccion: 'opcionales',
    descripcion: 'Información extra sobre especificaciones técnicas, procedencia o recomendaciones.',
    synonyms: ['detalle', 'observaciones', 'notas', 'comentarios', 'descripcion larga', 'detalles'],
  },
  requiere_chasis: {
    label: 'Requiere número de chasis',
    seccion: 'opcionales',
    descripcion: 'Solicita al cliente que ingrese el número de chasis (VIN) de su auto antes de comprar para validar compatibilidad.',
    ejemplo: 'SI (solicitar chasis) · NO (no solicitar)',
    synonyms: ['requiere chasis', 'chasis', 'vin', 'numero chasis', 'pide chasis'],
  },
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
      descripcion: texto?.descripcion,
      ejemplo: texto?.ejemplo,
      seccion: texto?.seccion ?? (obligatorias.has(key) ? 'obligatorios' : 'opcionales'),
    };
    if (texto?.group) campo.group = texto.group;
    if (enumHint?.length) campo.enumHint = enumHint;
    return campo;
  });
}

/** Campos derivados del esquema de respaldo. Default de las funciones de este módulo. */
export const PLANTILLA_CAMPOS: CampoMeta[] = camposDesdeEsquema(ESQUEMA_FALLBACK);

const UNIVERSAL_TRUTHY = new Set(['si', 'sí', 'true', '1', 'universal', 'x', 'yes']);

/**
 * Campos cuyos valores válidos dependen de otro campo de la misma fila. Es lo que hace
 * que un valor fijo para todas las filas no alcance: la subcategoría que corresponde no es
 * la misma para un repuesto de frenos que para uno de suspensión.
 */
export const CAMPO_AGRUPADO_POR: Record<string, string> = { subcategoria: 'categoria' };

export interface GrupoPorCompletar {
  /** Valor del campo que agrupa ("Frenos"), del que dependen los valores válidos. */
  clave: string;
  /** Cuántas filas de ese grupo venían sin el dato. */
  filas: number;
  /** Lo que el vendedor eligió para el grupo, si eligió algo. */
  elegido: string;
}

export interface CampoPorCompletar {
  /** Columna oficial que venía vacía. */
  columna: string;
  /** Total de filas sin el dato, sumando los grupos. */
  filas: number;
  /** Ordenados por cantidad: completar el grupo de 120 vale 120 veces más que el de 1. */
  grupos: GrupoPorCompletar[];
}

/** Lo que un vendedor escribe en la columna de precio cuando el repuesto se cotiza. */
const PRECIO_A_COTIZAR = /^(consultar|consultar precio|a consultar|cotizar|a cotizar|por cotizar|a pedido|preguntar|sin precio|s\/p)$/i;

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
   * La celda de compatibilidad trae varios vehículos a la vez ("Corolla 2014-2018 /
   * Yaris 2015-2019"). La fila se repite una vez por vehículo; los códigos repetidos que
   * eso genera los junta después `separarPorSku` en la hoja `compatibilidades`.
   */
  separarAplicaciones?: boolean;
  /**
   * El archivo no trae columna de marca ni de categoría, pero el nombre del repuesto las
   * menciona ("PASTILLA FRENO ... BOSCH"). Se sacan de ahí contra el catálogo real.
   */
  deducirDelNombre?: boolean;
  /**
   * Lo que el vendedor completó desde el paso 3, por campo y por grupo:
   * `completar.subcategoria['Frenos'] = 'Pastillas'` llena la subcategoría de todos los
   * repuestos de frenos que venían sin ella. Es lo que un valor fijo no puede hacer.
   */
  completar?: Record<string, Record<string, string>>;
  /**
   * La hoja trae filas que no son repuestos —subtotales, el total general, el encabezado
   * repetido cada vez que empieza una página— y hay que dejarlas fuera.
   */
  quitarFilasDeTotales?: boolean;
  /**
   * La categoría está escrita como una fila de título que agrupa a las de abajo ("FRENOS"
   * y debajo los repuestos de frenos), en vez de en una columna.
   */
  usarBandasComoCategoria?: boolean;
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

/**
 * ¿El panel exige este dato para dejar avanzar del paso 2?
 *
 * Son los obligatorios del esquema más el precio. El backend no pide precio —un repuesto
 * puede publicarse a cotizar— pero la revisión rechaza toda fila sin precio que no diga
 * SOLO_COTIZAR, así que sin esta regla el vendedor recorre el asistente entero para llegar
 * a cero repuestos publicables. La lista obligatoria del esquema no se toca: es del
 * backend, y el panel no tiene por qué reescribirla.
 */
export function requiereValorEnPanel(campo: CampoMeta, mapping: Mapping): boolean {
  if (campo.required) return true;
  if (campo.key !== 'precio') return false;
  // Con una columna de tipo de precio la decisión es fila por fila y la toma el paso 3.
  if (mapping.oficial.tipo_precio) return false;
  return (mapping.defaults?.tipo_precio ?? '').toUpperCase() !== 'SOLO_COTIZAR';
}

/**
 * Las filas de la hoja que no son repuestos, según el mapeo actual. Vive acá porque es el
 * único lugar que sabe qué columna del vendedor quedó como código.
 */
export function filasNoRepuesto(
  rows: unknown[][],
  userCols: UserColumn[],
  mapping: Mapping,
): FilaDescartada[] {
  const encabezado: string[] = [];
  const indicesCodigo: number[] = [];
  for (const col of userCols) {
    encabezado[col.index] = col.rawHeader;
    if (mapping.oficial.sku_proveedor === col.id) indicesCodigo.push(col.index);
  }
  return detectarFilasNoRepuesto(rows, encabezado, indicesCodigo);
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
    terminos: [campo.key, ...campo.synonyms].map(normalizeForMatch).filter(Boolean),
    keyTokens: new Set(
      [campo.key, ...campo.synonyms].flatMap((s) => normalizeForMatch(s).split(' ')).filter(Boolean),
    ),
  }));

  // Pasada 1: exacto / sinónimo. Se recorren los términos del campo en orden —el nombre
  // propio primero y los sinónimos del más literal al más suelto— en vez de recorrer las
  // columnas: así una planilla con "Nombre" y "Detalle" se queda con la primera para el
  // nombre publicado, y no con la que aparezca antes en la hoja.
  for (const { campo, terminos } of campos) {
    if (mapping.oficial[campo.key]) continue;
    for (const termino of terminos) {
      const hit = normCols.find(({ col, norm }) => norm && !usados.has(col.id) && norm === termino);
      if (hit) {
        mapping.oficial[campo.key] = hit.col.id;
        usados.add(hit.col.id);
        break;
      }
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
  /**
   * Fila de la hoja (base 0) de la que salió cada una de `rows`. Las filas vacías se
   * saltan, así que sin esto el número que se le muestra al vendedor deja de coincidir
   * con el de su Excel en cuanto su lista tiene un renglón en blanco.
   */
  filasOriginales: number[];
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
  for (let i = 0; i < hasta; i++) {
    if ((aoa[i] ?? []).filter(pareceTitulo).length >= 2) return i;
  }
  // Ninguna fila parece cabecera de tabla (típico de una portada con textos sueltos):
  // se elige la última fila con datos para no inventar filas de datos falsas debajo
  // y que el sistema advierta "debajo de esa fila no hay datos".
  for (let i = hasta - 1; i >= 0; i--) {
    if (filaTieneAlgo(aoa[i])) return i;
  }
  return 0;
}

/** Hoja con la que conviene abrir: la primera que tenga datos suficientes para mapear. */
export function elegirHojaInicial(hojas: HojaUsuario[]): number {
  // 1. Preferir la primera hoja que tenga una tabla real (fila con 3+ títulos y filas de datos debajo).
  const conTablaReal = hojas.findIndex((h) => {
    const fila = detectarFilaEncabezados(h.aoa);
    const { cols, rows } = columnasDeHoja(h.aoa, fila);
    const conTexto = cols.filter((c) => c.rawHeader.trim() !== '').length;
    return conTexto >= 3 && rows.length > 0;
  });
  if (conTablaReal >= 0) return conTablaReal;

  // 2. Si no hay con 3+, buscar al menos con 2 títulos y filas debajo.
  const conColumnas = hojas.findIndex((h) => {
    const fila = detectarFilaEncabezados(h.aoa);
    const { cols, rows } = columnasDeHoja(h.aoa, fila);
    const conTexto = cols.filter((c) => c.rawHeader.trim() !== '').length;
    return conTexto >= 2 && rows.length > 0;
  });
  if (conColumnas >= 0) return conColumnas;

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
  const rows: unknown[][] = [];
  const filasOriginales: number[] = [];
  for (let i = filaEncabezados + 1; i < aoa.length; i++) {
    if (!filaTieneAlgo(aoa[i] as unknown[])) continue;
    rows.push(aoa[i] as unknown[]);
    filasOriginales.push(i);
  }

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

  return { cols, rows, filasOriginales };
}

/**
 * Lectura automática de punta a punta: primera hoja con datos, títulos donde parezca que
 * están. Es el camino que usan los tests y el que el wizard toma como punto de partida
 * antes de que el vendedor corrija hoja o fila.
 */
export async function parseUserFile(file: File): Promise<ParsedUserFile> {
  const hojas = await leerLibro(file);
  const hoja = hojas[elegirHojaInicial(hojas)];
  const leida = columnasDeHoja(hoja.aoa, detectarFilaEncabezados(hoja.aoa));
  if (leida.cols.length === 0) throw new Error('La primera fila del archivo no tiene títulos de columna.');
  if (leida.rows.length === 0) throw new Error('No encontramos filas de datos debajo de los títulos.');
  return leida;
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
): {
  aoa: (string | number)[][];
  cambios: CambioNormalizacion[];
  /** Por cada fila de datos de `aoa`, de qué fila del vendedor salió (base 0). */
  filasOrigen: number[];
  /** Datos que quedaron vacíos y que el vendedor puede completar por grupo. */
  porCompletar: CampoPorCompletar[];
} {
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

  // Las bandas se reparten antes que nada: son filas de la hoja original y hay que
  // leerlas en su posición, antes de que se saque o se duplique ninguna otra. El título
  // viaja en una celda extra al final, en un índice que ninguna columna del vendedor usa.
  // Los detectores miran las celdas del vendedor y nada más, así que todo lo que
  // agregamos —de qué fila salió y bajo qué título estaba— viaja **al lado** de la fila y
  // no dentro. Meterlo en una celda extra hacía que una banda dejara de tener una sola
  // celda llena y no se reconociera.
  const bandas = mapping.usarBandasComoCategoria ? detectarBandas(rows, userCols.length) : [];
  const tituloPorFila = new Map(bandas.map((b) => [b.indice, b.titulo]));
  const fueraPorTotales = new Set(
    (mapping.quitarFilasDeTotales ? filasNoRepuesto(rows, userCols, mapping) : [])
      .map((f) => f.indice),
  );

  /** Fila del vendedor lista para transformar, con lo que sabemos de dónde vino. */
  interface FilaConOrigen {
    row: unknown[];
    /** Índice en el archivo del vendedor (base 0). Sobrevive a que se saquen o dupliquen filas. */
    origen: number;
    /** Título de la banda que la agrupaba, si la lista viene agrupada por familia. */
    banda: string;
  }

  const utiles: FilaConOrigen[] = [];
  let bandaActual = '';
  rows.forEach((fila, i) => {
    const titulo = tituloPorFila.get(i);
    if (titulo !== undefined) {
      bandaActual = titulo;
      return;
    }
    if (fueraPorTotales.has(i)) return;
    utiles.push({ row: fila as unknown[], origen: i, banda: bandaActual });
  });

  // Varios vehículos en una celda: la fila se repite una vez por vehículo antes de
  // transformarla, así cada copia recorre el resto del pipeline como una fila normal.
  const colAplicacion = mapping.separarAplicaciones
    ? mapping.oficial.compatibilidad_modelo ?? mapping.oficial.compatibilidad_marca ?? null
    : null;
  const idxAplicacion = colAplicacion ? idToIndex.get(colAplicacion) : undefined;
  const filas: FilaConOrigen[] = idxAplicacion === undefined ? utiles : utiles.flatMap((f) => {
    const vehiculos = separarAplicaciones(String(f.row[idxAplicacion] ?? ''), marcasVehiculo);
    if (vehiculos.length < 2) return [f];
    return vehiculos.map((vehiculo) => {
      const copia = [...f.row];
      copia[idxAplicacion] = vehiculo;
      return { ...f, row: copia };
    });
  });

  const out: (string | number)[][] = [[...columnas]];
  /** Fila del archivo del vendedor (base 0) de la que sale cada fila de `out`. */
  const filasOrigen: number[] = [];
  /** campo -> grupo -> cuántas filas venían sin el dato. */
  const huecos = new Map<string, Map<string, number>>();

  for (const fila of filas) {
    const row = fila.row;

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
    // Separar por vehículo implica partir cada fragmento: de nada sirve una fila por
    // auto si el auto sigue escrito de corrido en la columna de modelo.
    if (mapping.parsearAplicacion || mapping.separarAplicaciones) {
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

    // El título de la banda es la categoría de todas las filas que venían abajo. Va
    // antes que la deducción por nombre: lo que el vendedor agrupó a mano manda sobre lo
    // que nosotros creamos leer en el texto.
    if (mapping.usarBandasComoCategoria && !cells.categoria) {
      const titulo = fila.banda.trim();
      // El título viene escrito como en una lista impresa, en mayúsculas y sin tildes. Se
      // escribe con el nombre del catálogo porque el backend busca ignorando mayúsculas
      // pero NO tildes: "SUSPENSION" no encuentra a "Suspensión" y la fila se rechaza.
      if (titulo) cells.categoria = buscarEnCatalogo(titulo, catalogos.categorias) ?? titulo;
    }

    // Marca y categoría escondidas en el nombre. Van antes que el valor fijo: lo que
    // dice cada fila es mejor dato que un valor común para todas, y sólo se escribe
    // donde el archivo no dijo nada.
    if (mapping.deducirDelNombre && cells.nombre_publicado) {
      if (!cells.marca_repuesto) {
        cells.marca_repuesto = buscarEnTexto(
          cells.nombre_publicado, catalogos.marcasRepuesto, marcasVehiculo,
        ) ?? '';
      }
      if (!cells.categoria) {
        cells.categoria = buscarEnTexto(cells.nombre_publicado, catalogos.categorias) ?? '';
      }
    }

    // "CONSULTAR" en la columna del precio no es un precio roto: es el tipo de precio
    // escrito en la columna equivocada. Se traduce sólo si el vendedor no declaró uno,
    // y queda listado en los arreglos para que lo vea antes de generar.
    if (cells.precio && !cells.tipo_precio && PRECIO_A_COTIZAR.test(cells.precio)) {
      cambios.push({ columna: 'tipo_precio', antes: cells.precio, despues: 'SOLO_COTIZAR' });
      cells.tipo_precio = 'SOLO_COTIZAR';
      cells.precio = '';
    }

    // Lo que el vendedor completó por grupo desde el paso 3. Va antes que el valor fijo
    // porque es más específico: una subcategoría por categoría gana a una para todas.
    //
    // El conteo de lo que falta se hace acá y no después sobre el archivo terminado: si se
    // contara después, un grupo desaparecería de la lista apenas el vendedor lo completa y
    // se quedaría sin poder ver ni cambiar lo que eligió.
    for (const [campo, campoClave] of Object.entries(CAMPO_AGRUPADO_POR)) {
      if (cells[campo]) continue;
      const clave = cells[campoClave] ?? '';
      if (!clave) continue;
      const porCampo = huecos.get(campo) ?? new Map<string, number>();
      porCampo.set(clave, (porCampo.get(clave) ?? 0) + 1);
      huecos.set(campo, porCampo);
      const elegido = mapping.completar?.[campo]?.[clave];
      if (elegido) cells[campo] = elegido;
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
    filasOrigen.push(fila.origen);
  }

  const porCompletar: CampoPorCompletar[] = [...huecos.entries()].map(([columna, porGrupo]) => ({
    columna,
    filas: [...porGrupo.values()].reduce((n, x) => n + x, 0),
    grupos: [...porGrupo.entries()]
      .map(([clave, filas]) => ({ clave, filas, elegido: mapping.completar?.[columna]?.[clave] ?? '' }))
      .sort((a, b) => b.filas - a.filas || a.clave.localeCompare(b.clave, 'es')),
  }));

  return { aoa: out, cambios, filasOrigen, porCompletar };
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

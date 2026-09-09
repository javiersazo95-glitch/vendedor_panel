/**
 * Revisa el archivo ya transformado a columnas oficiales y dice, fila por fila, qué va a
 * pasar cuando lo lea el backend.
 *
 * El objetivo es que el vendedor vea los problemas **antes** de subir nada. Por eso las
 * reglas de acá son una réplica deliberada de las del backend
 * (`InventarioExcelService.requestDesdeFila` + `InventarioValidationSupport`): si esto
 * marca un error donde el backend no lo marca, el vendedor pierde tiempo corrigiendo algo
 * que estaba bien; si lo deja pasar, descubre el problema después de subir, que es
 * exactamente lo que este paso viene a evitar.
 *
 * Dos severidades, porque el backend tiene dos comportamientos distintos:
 * - `error`: la fila no se publica.
 * - `aviso`: la fila se publica, pero con un valor distinto del que el vendedor escribió
 *   (el backend normaliza en silencio: una condición que no reconoce queda como ORIGINAL).
 */
import type { CampoMeta } from './plantillaMapping';
import { COLUMNAS_NUMERICAS, normalizarNumero } from './plantillaNormalizacion';
import { buscarEnCatalogo, sugerirDelCatalogo } from './plantillaCatalogos';
import type { EsquemaPlantilla } from './plantillaMapping';

export { normalizarNumero };

export type Severidad = 'error' | 'aviso';

export interface Problema {
  /** Columna oficial afectada. */
  columna: string;
  severidad: Severidad;
  /** Texto para el vendedor, sin jerga. */
  mensaje: string;
}

export interface FilaRevisada {
  /** Número de fila en el Excel del vendedor, para que pueda ir a buscarla. */
  numeroFila: number;
  valores: string[];
  problemas: Problema[];
  tieneError: boolean;
}

export interface RevisionArchivo {
  columnas: string[];
  /** Sólo las primeras filas, para mostrar. Los contadores miran el archivo completo. */
  filas: FilaRevisada[];
  total: number;
  publicables: number;
  conError: number;
  conAviso: number;
}

/** El backend toma como "sí" sólo estos valores; cualquier otra cosa es "no". */
const SI_NO = new Set(['SI', 'SÍ', 'TRUE', '1']);
const NO_EXPLICITO = new Set(['NO', 'FALSE', '0', '']);

/**
 * Separadores con los que se listan varios vehículos. La barra se exige con espacio
 * alrededor porque pegada separa años ("2014/2018"), que es otra cosa.
 */
const SEPARADOR_VEHICULOS = /[\n\r;|]|\s\/\s/;

const ANIO = /(?:19|20)\d{2}/g;

/**
 * ¿La celda del modelo trae más de un vehículo? Los separadores no alcanzan: la limpieza
 * ya convirtió el salto de línea en un espacio antes de llegar acá. Un vehículo declara
 * como mucho dos años (desde y hasta), así que más de dos delatan que hay varios.
 */
const pareceVariosVehiculos = (modelo: string): boolean =>
  Boolean(modelo)
  && (SEPARADOR_VEHICULOS.test(modelo) || (modelo.match(ANIO) ?? []).length > 2);

const etiquetaDe = (campos: CampoMeta[], key: string) =>
  campos.find((c) => c.key === key)?.label ?? key;

/**
 * Revisa el AoA oficial (fila 0 = encabezados). `primeraFilaArchivo` es el número de fila
 * del Excel del vendedor que corresponde a la primera fila de datos, para que los
 * mensajes apunten a donde el vendedor puede ir a corregir.
 */
export function revisarAoA(
  aoa: (string | number)[][],
  campos: CampoMeta[],
  opciones: {
    maxFilas?: number;
    primeraFilaArchivo?: number;
    catalogos?: EsquemaPlantilla['catalogos'];
    /**
     * Número de fila del Excel del vendedor de cada fila de datos. Va aparte porque el
     * archivo oficial ya no va fila a fila con el del vendedor: se sacan subtotales, se
     * reparten bandas, se duplica por vehículo y se juntan los códigos repetidos. Sin
     * esto el número que se muestra apunta a la fila equivocada.
     */
    numerosDeFila?: number[];
  } = {},
): RevisionArchivo {
  const { maxFilas = 20, primeraFilaArchivo = 2, catalogos, numerosDeFila } = opciones;
  // Sin catálogos —porque el esquema no respondió— no se revisa nada contra ellos: es
  // preferible no decir nada a inventar un error con una copia local desactualizada.
  const categorias = catalogos?.categorias ?? [];
  const marcas = catalogos?.marcasRepuesto ?? [];
  const subcategoriasPorCategoria = catalogos?.subcategoriasPorCategoria ?? {};
  // Una sugerencia sólo se nombra si existe; el mensaje ya sirve sin ella.
  const conSugerencia = (valor: string, catalogo: string[]) => {
    const [mejor] = sugerirDelCatalogo(valor, catalogo, 1);
    return mejor ? ` ¿Querías decir "${mejor}"?` : '';
  };
  const columnas = (aoa[0] ?? []).map(String);
  const indice = new Map(columnas.map((c, i) => [c, i]));
  const obligatorias = campos.filter((c) => c.required).map((c) => c.key);

  const filas: FilaRevisada[] = [];
  let publicables = 0;
  let conError = 0;
  let conAviso = 0;

  for (let i = 1; i < aoa.length; i++) {
    const valores = columnas.map((_, c) => String(aoa[i][c] ?? ''));
    const leer = (key: string) => {
      const idx = indice.get(key);
      return idx === undefined ? '' : (valores[idx] ?? '').trim();
    };
    const problemas: Problema[] = [];
    const agregar = (columna: string, severidad: Severidad, mensaje: string) =>
      problemas.push({ columna, severidad, mensaje });

    for (const key of obligatorias) {
      if (!leer(key)) agregar(key, 'error', `Falta ${etiquetaDe(campos, key).toLowerCase()}.`);
    }

    for (const key of columnas) {
      if (!COLUMNAS_NUMERICAS.has(key)) continue;
      const bruto = leer(key);
      if (!bruto) continue;
      const { numero, comoMiles } = normalizarNumero(bruto);
      if (numero === null) {
        agregar(key, 'error', `"${bruto}" no es un número.`);
      } else if (numero < 0) {
        agregar(key, 'error', `${etiquetaDe(campos, key)} no puede ser negativo.`);
      } else if (comoMiles) {
        agregar(key, 'aviso', `"${bruto}" se va a publicar como ${numero.toLocaleString('es-CL')}.`);
      }
    }

    // El backend deja el precio vacío sólo cuando el repuesto es "solo cotizar", y un
    // tipo_precio vacío significa "con precio a la vista".
    const soloCotizar = leer('tipo_precio').toUpperCase().includes('COTIZ')
      || leer('tipo_precio').toUpperCase() === 'QUOTE_ONLY';
    if (!soloCotizar && !leer('precio')) {
      agregar('precio', 'error', 'Falta el precio. Si este repuesto se cotiza, pon "SOLO_COTIZAR" en tipo de precio.');
    }

    const condicion = leer('condicion').toUpperCase();
    if (condicion && condicion !== 'ORIGINAL' && condicion !== 'ALTERNATIVO' && condicion !== 'ALT') {
      agregar('condicion', 'aviso', `No reconocemos "${leer('condicion')}": se va a publicar como ORIGINAL.`);
    }

    for (const key of ['compatibilidad_general', 'requiere_chasis']) {
      const bruto = leer(key);
      const upper = bruto.toUpperCase();
      if (bruto && !SI_NO.has(upper) && !NO_EXPLICITO.has(upper)) {
        agregar(key, 'aviso', `No reconocemos "${bruto}": se va a tomar como NO.`);
      }
    }

    // Catálogos: cada columna tiene su propia consecuencia en el backend.
    const categoria = leer('categoria');
    const categoriaOficial = categoria ? buscarEnCatalogo(categoria, categorias) : null;
    if (categoria && categorias.length > 0 && !categoriaOficial) {
      agregar('categoria', 'error',
        `La categoría "${categoria}" no existe en RepuesTop.${conSugerencia(categoria, categorias)}`);
    }

    const subcategoria = leer('subcategoria');
    if (subcategoria && categoriaOficial) {
      const deLaCategoria = subcategoriasPorCategoria[categoriaOficial] ?? [];
      if (deLaCategoria.length > 0 && !buscarEnCatalogo(subcategoria, deLaCategoria)) {
        agregar('subcategoria', 'aviso',
          `"${subcategoria}" no es una subcategoría de ${categoriaOficial}: el repuesto se va a `
          + `publicar sin subcategoría.${conSugerencia(subcategoria, deLaCategoria)}`);
      }
    }

    const marca = leer('marca_repuesto');
    if (marca && marcas.length > 0 && !buscarEnCatalogo(marca, marcas)) {
      agregar('marca_repuesto', 'aviso',
        `"${marca}" no está en el catálogo: se va a crear como marca nueva.${conSugerencia(marca, marcas)}`);
    }

    // Varios autos en la celda del modelo. Es el único caso que pasaba en verde estando
    // mal: se publicaba un modelo que no existe y el repuesto no aparecía en ninguna
    // búsqueda por vehículo. El aviso va aunque el vendedor no active la separación.
    const modelo = leer('compatibilidad_modelo');
    if (pareceVariosVehiculos(modelo)) {
      agregar('compatibilidad_modelo', 'aviso',
        `"${modelo}" parece traer varios autos en una sola celda: se publicaría como un `
        + 'modelo solo. Vuelve atrás y activa la separación por vehículo.');
    }

    const desde = normalizarNumero(leer('anio_desde')).numero;
    const hasta = normalizarNumero(leer('anio_hasta')).numero;
    if (desde !== null && hasta !== null && desde > hasta) {
      agregar('anio_hasta', 'aviso', `El año desde (${desde}) es mayor que el año hasta (${hasta}).`);
    }

    const tieneError = problemas.some((p) => p.severidad === 'error');
    if (tieneError) conError += 1;
    else publicables += 1;
    if (!tieneError && problemas.length > 0) conAviso += 1;

    if (filas.length < maxFilas) {
      filas.push({
        numeroFila: numerosDeFila?.[i - 1] ?? primeraFilaArchivo + i - 1,
        valores,
        problemas,
        tieneError,
      });
    }
  }

  return { columnas, filas, total: aoa.length - 1, publicables, conError, conAviso };
}

/**
 * Los datos de un repuesto tal como los va a ver el comprador, para la tarjeta de vista
 * previa. Replica lo que arma `Repuestop_Market` con la respuesta del backend.
 */
export interface FichaPreview {
  nombre: string;
  marca: string;
  categoria: string;
  subcategoria: string;
  sku: string;
  precio: string;
  stock: string;
  condicion: string;
  compatibilidad: string;
  descripcion: string;
}

const formatoPrecio = (numero: number) =>
  numero.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

/** Arma la ficha del comprador a partir de una fila oficial ya transformada. */
export function fichaDesdeFila(columnas: string[], valores: string[]): FichaPreview {
  const indice = new Map(columnas.map((c, i) => [c, i]));
  const v = (key: string) => {
    const idx = indice.get(key);
    return idx === undefined ? '' : String(valores[idx] ?? '').trim();
  };

  const soloCotizar = v('tipo_precio').toUpperCase().includes('COTIZ');
  const { numero } = normalizarNumero(v('precio'));
  const precio = soloCotizar ? 'Precio a consultar' : numero !== null ? formatoPrecio(numero) : 'Sin precio';

  const condicionCruda = v('condicion').toUpperCase();
  const condicion = condicionCruda === 'ALTERNATIVO' || condicionCruda === 'ALT' ? 'Alternativo' : 'Original';

  const universal = SI_NO.has(v('compatibilidad_general').toUpperCase());
  const anios = [v('anio_desde'), v('anio_hasta')].filter(Boolean).join('-');
  const compatibilidad = universal
    ? 'Compatible con todos los vehículos'
    : [v('compatibilidad_marca'), v('compatibilidad_modelo'), anios, v('motor')].filter(Boolean).join(' ')
      || 'Sin compatibilidad declarada';

  return {
    nombre: v('nombre_publicado') || 'Sin nombre',
    marca: v('marca_repuesto'),
    categoria: v('categoria'),
    subcategoria: v('subcategoria'),
    sku: v('sku_proveedor'),
    precio,
    stock: v('stock'),
    condicion,
    compatibilidad,
    descripcion: v('descripcion'),
  };
}


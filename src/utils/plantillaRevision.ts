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

/**
 * Misma normalización que `InventarioExcelService.normalizarNumero`: saca el signo peso,
 * "CLP" y los espacios, y decide si el punto es separador de miles o decimal. Devuelve
 * null si lo que queda no es un número.
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

/** El backend toma como "sí" sólo estos valores; cualquier otra cosa es "no". */
const SI_NO = new Set(['SI', 'SÍ', 'TRUE', '1']);
const NO_EXPLICITO = new Set(['NO', 'FALSE', '0', '']);

/** Columnas que el backend lee como número. El esquema todavía no declara tipos. */
const COLUMNAS_NUMERICAS = new Set(['precio', 'stock', 'anio_desde', 'anio_hasta']);

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
  opciones: { maxFilas?: number; primeraFilaArchivo?: number } = {},
): RevisionArchivo {
  const { maxFilas = 20, primeraFilaArchivo = 2 } = opciones;
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
      filas.push({ numeroFila: primeraFilaArchivo + i - 1, valores, problemas, tieneError });
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

/**
 * Compatibilidad múltiple desde el Excel del vendedor.
 *
 * Las listas de repuestos se escriben con **una fila por aplicación**: el mismo SKU
 * repetido tantas veces como vehículos le sirven, o una columna "Aplicación" con
 * "Toyota Corolla 2014-2020" escrito de corrido. Hasta ahora el mapper sólo sabía llevar
 * una compatibilidad por repuesto, así que la primera opción terminaba en SKU duplicados
 * —que el backend rechaza— y la segunda en texto que sólo podía ir a la descripción,
 * perdiendo justo lo que hace que el repuesto aparezca en la búsqueda por vehículo.
 *
 * La plantilla oficial ya soporta la hoja `compatibilidades` (una fila por vehículo,
 * agrupadas por `sku_proveedor`); acá se arma.
 */
import { buscarEnCatalogo, normalizarParaComparar } from './plantillaCatalogos';
import { ALIAS_MARCAS_VEHICULO, claveCatalogo } from './nombresCatalogoVehiculo';

/** Columnas de la hoja `compatibilidades`, en el orden que lee el backend. */
export const COLUMNAS_COMPATIBILIDADES = [
  'sku_proveedor',
  'compatibilidad_marca',
  'compatibilidad_modelo',
  'anio_desde',
  'anio_hasta',
  'motor',
  'referencia_oem',
] as const;

export interface SkusRepetidos {
  /** Cuántos SKU aparecen en más de una fila. */
  skus: number;
  /** Cuántas filas son repeticiones (total de filas menos un repuesto por SKU). */
  filasExtra: number;
  /** Un SKU de ejemplo y cuántas veces aparece, para poder mostrarlo. */
  ejemplo: { sku: string; veces: number } | null;
}

/** Mira la columna de SKU del archivo del vendedor y dice si trae repeticiones. */
export function detectarSkusRepetidos(rows: unknown[][], colIndex: number): SkusRepetidos {
  const cuenta = new Map<string, number>();
  for (const row of rows) {
    const sku = String((row as unknown[])[colIndex] ?? '').trim().toUpperCase();
    if (!sku) continue;
    cuenta.set(sku, (cuenta.get(sku) ?? 0) + 1);
  }
  let skus = 0;
  let filasExtra = 0;
  let ejemplo: { sku: string; veces: number } | null = null;
  for (const [sku, veces] of cuenta) {
    if (veces <= 1) continue;
    skus += 1;
    filasExtra += veces - 1;
    if (!ejemplo || veces > ejemplo.veces) ejemplo = { sku, veces };
  }
  return { skus, filasExtra, ejemplo };
}

export interface AplicacionParseada {
  marca: string;
  modelo: string;
  anioDesde: string;
  anioHasta: string;
  /** "Todos", "Universal": la celda dice que sirve para cualquier vehículo. */
  universal?: boolean;
  /** "2012 en adelante": el año hasta se puso en el año actual y conviene decirlo. */
  abierto?: boolean;
}

/** Lo que un vendedor escribe en la columna de aplicación cuando el repuesto sirve para todo. */
const PALABRAS_UNIVERSAL = /^(todos|todas|todo|universal|general|generico|generica|cualquiera|cualquier vehiculo|cualquier auto|todos los vehiculos|todos los autos|todas las marcas|todo vehiculo|multimarca)$/;

const ANIO_ACTUAL = new Date().getFullYear();

/** Sin tildes pero con mayúsculas y separadores: mismo largo que el original, para recortar. */
const sinAcentosConCase = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const escapeRe = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "14" → 2014, "98" → 1998: dos cifras se leen como el año más cercano que no sea futuro. */
const expandirAnio = (dosCifras: string): string => {
  const n = Number(dosCifras);
  return String(n <= (ANIO_ACTUAL + 2) % 100 ? 2000 + n : 1900 + n);
};

const RANGO_4 = /((?:19|20)\d{2})\s*(?:-|–|—|\/|>|a|al|hasta)\s*((?:19|20)\d{2})/i;
const ABIERTO = /((?:19|20)\d{2})\s*(?:en adelante|adelante|a la fecha|al presente|en adelante|\+|→|->|>)/i;
const RANGO_2 = /(?<![\d.])'?(\d{2})\s*(?:-|–|—|\/|a|al)\s*'?(\d{2})(?![\d.])/i;
const ANIO_4 = /(?:19|20)\d{2}/g;

/**
 * Parte una aplicación escrita de corrido ("Toyota Corolla 2014-2020") usando el catálogo
 * de marcas de vehículo como ancla. Sin marca reconocida devuelve null: adivinar cuál de
 * las palabras es la marca terminaría inventando compatibilidades, que es peor que no
 * declarar ninguna.
 *
 * Fase 3 del plan de auditoría de carga: la marca se recorta por posición en el texto y no
 * por cantidad de palabras ("MERCEDES-BENZ SPRINTER" perdía el modelo), se entienden los
 * años de dos cifras ("14-18"), "2012 en adelante" cierra en el año actual y lo dice,
 * y "Todos" o "Universal" marcan el repuesto como universal en vez de quedar como modelo.
 */
export function parsearAplicacion(texto: string, marcasVehiculo: string[]): AplicacionParseada | null {
  const original = String(texto ?? '').trim();
  if (!original) return null;

  const normalizado = normalizarParaComparar(original);
  if (PALABRAS_UNIVERSAL.test(normalizado)) {
    return { marca: '', modelo: '', anioDesde: '', anioHasta: '', universal: true };
  }

  // La marca más larga que calce al principio: "Land Rover" antes que "Land". Se compara
  // letra a letra, admitiendo puntos, guiones o espacios entre medio: "MERCEDES-BENZ",
  // "G.M.C." y "Land-Rover" son la misma marca escrita como la escribe cada vendedor.
  //
  // Fase 5: también se reconocen las marcas como las escribe el padrón ("KIA MOTORS RIO"), y se
  // devuelven con el nombre del catálogo ("Kia"). Sin esto "MOTORS RIO" quedaba como modelo.
  const sinAcentos = sinAcentosConCase(original);
  const alias = Object.entries(ALIAS_MARCAS_VEHICULO)
    .map(([texto, canonica]) => ({ texto, marca: marcasVehiculo.find((m) => claveCatalogo(m) === claveCatalogo(canonica)) }))
    .filter((a): a is { texto: string; marca: string } => !!a.marca);
  const candidatas = [...marcasVehiculo.map((m) => ({ texto: m, marca: m })), ...alias]
    .map(({ texto, marca: m }) => {
      const letras = normalizarParaComparar(texto).replace(/\s+/g, '');
      if (!letras) return null;
      const patron = new RegExp(`^[^a-z0-9]*${[...letras].map(escapeRe).join('[^a-z0-9]*')}(?![a-z0-9])`, 'i');
      const recorte = sinAcentos.match(patron);
      return recorte ? { marca: m, largo: recorte[0].length, letras: letras.length } : null;
    })
    .filter((c): c is { marca: string; largo: number; letras: number } => !!c)
    .sort((a, b) => b.letras - a.letras);
  if (candidatas.length === 0) return null;
  const { marca, largo } = candidatas[0];
  let resto = original.slice(largo).replace(/^[^A-Za-z0-9À-ɏ]+/, '').trim();

  let anioDesde = '';
  let anioHasta = '';
  let abierto = false;
  const rango = resto.match(RANGO_4);
  const rangoAbierto = rango ? null : resto.match(ABIERTO);
  const rangoCorto = rango || rangoAbierto || ANIO_4.test(resto) ? null : resto.match(RANGO_2);
  ANIO_4.lastIndex = 0;
  if (rango) {
    anioDesde = rango[1];
    anioHasta = rango[2];
    resto = resto.replace(rango[0], ' ');
  } else if (rangoAbierto) {
    anioDesde = rangoAbierto[1];
    // El año actual, no el que viene: el backend exige que el catálogo cubra hasta el año final
    // declarado, y el catálogo de un modelo llega a lo más hasta este año. Con el año que viene
    // "2016 en adelante" no se publicaba nunca (prueba en local del 30-sep).
    anioHasta = String(ANIO_ACTUAL);
    abierto = true;
    resto = resto.replace(rangoAbierto[0], ' ');
  } else if (rangoCorto) {
    anioDesde = expandirAnio(rangoCorto[1]);
    anioHasta = expandirAnio(rangoCorto[2]);
    resto = resto.replace(rangoCorto[0], ' ');
  } else {
    const sueltos = resto.match(ANIO_4);
    if (sueltos?.length) {
      anioDesde = sueltos[0];
      if (sueltos.length > 1) anioHasta = sueltos[sueltos.length - 1];
      for (const anio of sueltos) resto = resto.replace(anio, ' ');
    }
  }

  const modelo = resto
    .replace(/\b(en adelante|adelante|a la fecha|al presente)\b/gi, ' ')
    .replace(/[\s,;·|/-]+/g, ' ')
    .trim();
  const salida: AplicacionParseada = { marca, modelo, anioDesde, anioHasta };
  if (abierto) salida.abierto = true;
  return salida;
}

/**
 * Igual que arriba pero para decidir si vale la pena ofrecer el asistente.
 *
 * Una columna de marca por sí sola ("Toyota", "Nissan") es una compatibilidad ya
 * separada, no una aplicación escrita de corrido. Exigimos que después de reconocer
 * la marca quede al menos el modelo o algún año; de lo contrario el mapper ofrecía
 * separar columnas que el vendedor ya había separado correctamente.
 */
export function pareceColumnaDeAplicacion(valores: string[], marcasVehiculo: string[]): boolean {
  if (marcasVehiculo.length === 0) return false;
  const aplicacionesCompletas = valores.filter((v) => {
    const aplicacion = parsearAplicacion(v, marcasVehiculo);
    return !!aplicacion && !!(aplicacion.modelo || aplicacion.anioDesde || aplicacion.anioHasta);
  }).length;
  return aplicacionesCompletas > 0 && aplicacionesCompletas >= valores.length / 2;
}

export interface SeparacionPorSku {
  /** Hoja `inventario`: una fila por repuesto (la primera de cada SKU). */
  inventario: (string | number)[][];
  /** Hoja `compatibilidades`: las filas repetidas, ya con sus columnas. */
  compatibilidades: (string | number)[][];
  /** Diferencias entre las filas de un mismo SKU que conviene contar antes de generar. */
  advertencias: string[];
  /**
   * Por cada fila de `inventario`, qué fila de datos del AoA de entrada la produjo (base
   * 0). Sirve para seguir sabiendo de qué fila del Excel del vendedor viene cada repuesto
   * después de juntar los códigos repetidos.
   */
  indices: number[];
  /**
   * Lo mismo para la hoja `compatibilidades`: de qué fila del AoA salió cada una. Sin esto,
   * corregir un modelo en esa tabla no tendría dónde guardarse.
   */
  indicesCompatibilidades: number[];
}

/** Campos del repuesto que no deberían cambiar entre las filas de un mismo SKU. */
const CAMPOS_DEL_REPUESTO = ['nombre_publicado', 'categoria', 'marca_repuesto', 'precio', 'stock'];

/**
 * Convierte un archivo con el SKU repetido en un repuesto por SKU más su hoja de
 * compatibilidades. La primera fila de cada SKU manda: es la que define el repuesto.
 */
export function separarPorSku(aoa: (string | number)[][]): SeparacionPorSku {
  const columnas = (aoa[0] ?? []).map(String);
  const idx = new Map(columnas.map((c, i) => [c, i]));
  const col = (fila: (string | number)[], key: string) => {
    const i = idx.get(key);
    return i === undefined ? '' : String(fila[i] ?? '').trim();
  };

  const inventario: (string | number)[][] = [[...columnas]];
  const indices: number[] = [];
  const compatibilidades: (string | number)[][] = [[...COLUMNAS_COMPATIBILIDADES]];
  const indicesCompatibilidades: number[] = [];
  const advertencias: string[] = [];
  const primeraPorSku = new Map<string, (string | number)[]>();
  const diferencias = new Map<string, Set<string>>();

  for (let i = 1; i < aoa.length; i++) {
    const fila = aoa[i];
    const sku = col(fila, 'sku_proveedor').toUpperCase();
    const primera = sku ? primeraPorSku.get(sku) : undefined;

    if (!sku || !primera) {
      if (sku) primeraPorSku.set(sku, fila);
      inventario.push(fila);
      indices.push(i - 1);
      continue;
    }

    for (const campo of CAMPOS_DEL_REPUESTO) {
      if (col(fila, campo) && col(fila, campo) !== col(primera, campo)) {
        diferencias.set(sku, (diferencias.get(sku) ?? new Set()).add(campo));
      }
    }

    indicesCompatibilidades.push(i - 1);
    compatibilidades.push([
      col(fila, 'sku_proveedor'),
      col(fila, 'compatibilidad_marca'),
      col(fila, 'compatibilidad_modelo'),
      col(fila, 'anio_desde'),
      col(fila, 'anio_hasta'),
      col(fila, 'motor'),
      col(fila, 'referencia_oem'),
    ]);
  }

  if (diferencias.size > 0) {
    const ejemplo = [...diferencias.entries()][0];
    advertencias.push(
      `${diferencias.size === 1 ? 'Un repuesto tiene' : `${diferencias.size} repuestos tienen`} `
      + `filas repetidas con datos distintos (por ejemplo ${ejemplo[0]}, en ${[...ejemplo[1]].join(' y ')}). `
      + 'Se usa siempre la primera fila de cada código.',
    );
  }

  return { inventario, compatibilidades, advertencias, indices, indicesCompatibilidades };
}

/**
 * Separadores con los que un vendedor lista varios vehículos en una sola celda, sin
 * ambigüedad: salto de línea, punto y coma y barra vertical.
 */
const SEPARADOR_DURO = /[\n\r;|]+/;
/** Los separadores que también podrían ser otra cosa: la barra parte años ("2014/2018"). */
const SEPARADOR_BLANDO = /\s*(?:\/|,|\s+y\s+|\s+e\s+)\s*/i;
const TIENE_SEPARADOR_BLANDO = /\/|,|\s+y\s+|\s+e\s+/i;
const ES_SOLO_ANIOS = /^[\d\s'.\-–—/]*$/;

/**
 * Parte una celda que trae varios vehículos ("Corolla 2014-2018 / Yaris 2015-2019") en un
 * texto por vehículo. Devuelve un solo elemento cuando la celda trae una aplicación sola,
 * y ninguno cuando viene vacía.
 *
 * Fase 3: además de la barra, separan la coma y la " y ". Un trozo sin marca hereda la del
 * trozo anterior ("Toyota Corolla, Yaris 2012-2016"), y si tampoco trae años hereda los
 * años ("Toyota Corolla, Yaris 2012"), siempre que el trozo sea un modelo: uno conocido de
 * esa marca cuando hay catálogo de modelos, o una o dos palabras detrás de una coma o una
 * "y". Detrás de una barra sola no se hereda nada: "Toyota Corolla / delantero" queda
 * entero, porque adivinar ahí inventaría un auto.
 */
export function separarAplicaciones(
  texto: string,
  marcasVehiculo: string[],
  modelosDeMarca?: (marca: string) => string[],
): string[] {
  const original = String(texto ?? '').trim();
  if (!original) return [];

  const partes = original.split(SEPARADOR_DURO).map((t) => t.trim()).filter(Boolean);
  const finales: string[] = [];
  let contexto: AplicacionParseada | null = null;

  for (const parte of partes) {
    const entera = parsearAplicacion(parte, marcasVehiculo);
    if (!TIENE_SEPARADOR_BLANDO.test(parte)) {
      finales.push(parte);
      if (entera && !entera.universal) contexto = entera;
      continue;
    }
    const blando = /,|\s+y\s+|\s+e\s+/i.test(parte);
    const trozos = parte.split(SEPARADOR_BLANDO).map((t) => t.trim()).filter(Boolean);
    const salida: string[] = [];
    let ok = trozos.length > 1;
    let ctx = contexto;
    for (const trozo of trozos) {
      if (!ok) break;
      const app = parsearAplicacion(trozo, marcasVehiculo);
      if (app && !app.universal) {
        salida.push(trozo);
        ctx = app;
        continue;
      }
      // Sin marca: sólo puede ser un modelo que hereda la marca anterior.
      if (!ctx || app?.universal || ES_SOLO_ANIOS.test(trozo)) {
        ok = false;
        break;
      }
      const soloModelo = trozo.replace(ANIO_4, ' ').replace(RANGO_2, ' ').replace(/[\s,;·|/-]+/g, ' ').trim();
      const conocido = modelosDeMarca ? buscarEnCatalogo(soloModelo, modelosDeMarca(ctx.marca)) : null;
      const pareceModelo = blando && soloModelo.split(' ').filter(Boolean).length <= 2 && /[a-z]/i.test(soloModelo);
      if (!conocido && !pareceModelo) {
        ok = false;
        break;
      }
      const traeAnios = ANIO_4.test(trozo) || RANGO_2.test(trozo);
      ANIO_4.lastIndex = 0;
      const anios = traeAnios ? '' : [ctx.anioDesde, ctx.anioHasta].filter(Boolean).join('-');
      salida.push(`${ctx.marca} ${trozo}${anios ? ` ${anios}` : ''}`.trim());
    }
    if (ok && salida.length > 1) finales.push(...salida);
    else finales.push(parte);
    if (entera && !entera.universal) contexto = entera;
  }
  return finales;
}

export interface AplicacionesMultiples {
  /** Cuántas celdas de la muestra traen más de un vehículo. */
  celdas: number;
  /** Total de vehículos que aparecerían al separarlas. */
  vehiculos: number;
  ejemplo: { texto: string; vehiculos: string[] } | null;
}

/** Mira una columna de aplicación y dice si vale la pena ofrecer separarla. */
export function detectarAplicacionesMultiples(
  valores: string[],
  marcasVehiculo: string[],
  modelosDeMarca?: (marca: string) => string[],
): AplicacionesMultiples {
  let celdas = 0;
  let vehiculos = 0;
  let ejemplo: AplicacionesMultiples['ejemplo'] = null;
  for (const valor of valores) {
    const partes = separarAplicaciones(valor, marcasVehiculo, modelosDeMarca);
    if (partes.length < 2) continue;
    celdas += 1;
    vehiculos += partes.length;
    if (!ejemplo || partes.length > ejemplo.vehiculos.length) {
      ejemplo = { texto: valor, vehiculos: partes };
    }
  }
  return { celdas, vehiculos, ejemplo };
}

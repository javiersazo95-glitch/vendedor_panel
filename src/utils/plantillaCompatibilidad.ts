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
import { normalizarParaComparar } from './plantillaCatalogos';

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
}

/**
 * Parte una aplicación escrita de corrido ("Toyota Corolla 2014-2020") usando el catálogo
 * de marcas de vehículo como ancla. Sin marca reconocida devuelve null: adivinar cuál de
 * las palabras es la marca terminaría inventando compatibilidades, que es peor que no
 * declarar ninguna.
 */
export function parsearAplicacion(texto: string, marcasVehiculo: string[]): AplicacionParseada | null {
  const original = String(texto ?? '').trim();
  if (!original) return null;

  const normalizado = normalizarParaComparar(original);
  // La marca más larga que calce al principio: "Land Rover" antes que "Land".
  const marca = marcasVehiculo
    .filter((m) => {
      const n = normalizarParaComparar(m);
      return n && (normalizado === n || normalizado.startsWith(`${n} `));
    })
    .sort((a, b) => b.length - a.length)[0];
  if (!marca) return null;

  let resto = original.slice(0, original.length).trim();
  // Se recorta por palabras para no depender de acentos ni de mayúsculas.
  const palabrasMarca = normalizarParaComparar(marca).split(' ').length;
  resto = resto.split(/\s+/).slice(palabrasMarca).join(' ').trim();

  let anioDesde = '';
  let anioHasta = '';
  const rango = resto.match(/((?:19|20)\d{2})\s*(?:-|–|—|\/|>|a|al|hasta)\s*((?:19|20)\d{2})/i);
  if (rango) {
    anioDesde = rango[1];
    anioHasta = rango[2];
    resto = resto.replace(rango[0], ' ');
  } else {
    const sueltos = resto.match(/(?:19|20)\d{2}/g);
    if (sueltos?.length) {
      anioDesde = sueltos[0];
      if (sueltos.length > 1) anioHasta = sueltos[sueltos.length - 1];
      for (const anio of sueltos) resto = resto.replace(anio, ' ');
    }
  }

  const modelo = resto.replace(/[\s,;·|-]+/g, ' ').trim();
  return { marca, modelo, anioDesde, anioHasta };
}

/** Igual que arriba pero para decidir si vale la pena ofrecer el asistente. */
export function pareceColumnaDeAplicacion(valores: string[], marcasVehiculo: string[]): boolean {
  if (marcasVehiculo.length === 0) return false;
  const conMarca = valores.filter((v) => parsearAplicacion(v, marcasVehiculo) !== null).length;
  return conMarca > 0 && conMarca >= valores.length / 2;
}

export interface SeparacionPorSku {
  /** Hoja `inventario`: una fila por repuesto (la primera de cada SKU). */
  inventario: (string | number)[][];
  /** Hoja `compatibilidades`: las filas repetidas, ya con sus columnas. */
  compatibilidades: (string | number)[][];
  /** Diferencias entre las filas de un mismo SKU que conviene contar antes de generar. */
  advertencias: string[];
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
  const compatibilidades: (string | number)[][] = [[...COLUMNAS_COMPATIBILIDADES]];
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
      continue;
    }

    for (const campo of CAMPOS_DEL_REPUESTO) {
      if (col(fila, campo) && col(fila, campo) !== col(primera, campo)) {
        diferencias.set(sku, (diferencias.get(sku) ?? new Set()).add(campo));
      }
    }

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

  return { inventario, compatibilidades, advertencias };
}

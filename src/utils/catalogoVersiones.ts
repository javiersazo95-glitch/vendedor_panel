/**
 * Las versiones de un modelo de auto en el catálogo de RepuesTop: con qué años y motores existe.
 *
 * El backend registra la compatibilidad de un repuesto buscando versiones del catálogo que
 * cubran los años declarados (`InventarioCompatibilidadSupport.resolverCatalogosPorTexto`): si
 * ninguna los cubre, el repuesto no se publica, y un motor que no aparece en ninguna versión no
 * acota nada. Por eso en la tabla sólo se ofrecen los años y motores que el catálogo tiene para
 * el modelo de cada fila.
 */
import { apiFetch } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import { normalizarParaComparar } from './plantillaCatalogos';

/** Columnas cuyo valor válido depende del modelo de la fila: se eligen contra el catálogo. */
export const COLUMNAS_DE_VERSION = new Set(['anio_desde', 'anio_hasta', 'motor']);

export interface VersionCatalogo {
  id: number;
  modelo: string;
  anioDesde: number | null;
  anioHasta: number | null;
  motor: string;
}

/** Tope del año cuando una versión sigue vigente (sin año final en el catálogo). */
const ANIO_TOPE = new Date().getFullYear() + 1;
/** Detalles de versiones que se piden de una vez. */
const LOTE = 80;

const clave = (marca: string, modelo: string) => `${normalizarParaComparar(marca)}|${normalizarParaComparar(modelo)}`;
export const claveModelo = clave;

async function pedir<T>(ruta: string): Promise<T | null> {
  try {
    const r = await apiFetch(`${API_BASE_URL}/api/v1/catalogos/inventario/${ruta}`);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Las versiones de un modelo, con sus años y motor. Devuelve null si el catálogo no respondió
 * (se sigue sin restringir, como antes) y [] si respondió que el modelo no tiene versiones.
 */
export async function cargarVersiones(marca: string, modelo: string): Promise<VersionCatalogo[] | null> {
  const lista = await pedir<{ id: number | null; nombre: string }[]>(
    `versiones?marca=${encodeURIComponent(marca)}&modelo=${encodeURIComponent(modelo)}`,
  );
  if (lista === null) return null;
  const ids = lista.map((v) => v.id).filter((id): id is number => typeof id === 'number');
  const detalles: VersionCatalogo[] = [];
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = await pedir<{ id: number; modelo: string; anioDesde: number | null; anioHasta: number | null; motor: string | null }[]>(
      `vehiculo-catalogos?ids=${ids.slice(i, i + LOTE).join(',')}`,
    );
    if (lote === null) return null;
    for (const d of lote) {
      detalles.push({ id: d.id, modelo: d.modelo ?? '', anioDesde: d.anioDesde ?? null, anioHasta: d.anioHasta ?? null, motor: (d.motor ?? '').trim() });
    }
  }
  // `/versiones` compara el modelo por prefijo ("Yaris" trae también "Yaris Sport"); el backend,
  // al publicar, usa el modelo exacto. Sólo cuentan las del modelo exacto: antes, sin ninguna
  // exacta se usaban las del prefijo y un modelo "3" de Mazda decía "hay de 1977 a 2004" (el 323).
  return versionesDelModelo(detalles, modelo);
}

/** Las versiones cuyo modelo es exactamente el pedido (sin mayúsculas ni espacios). */
export function versionesDelModelo(detalles: VersionCatalogo[], modelo: string): VersionCatalogo[] {
  return detalles.filter((d) => normalizarParaComparar(d.modelo) === normalizarParaComparar(modelo));
}

const rango = (v: VersionCatalogo) => ({
  desde: v.anioDesde ?? v.anioHasta ?? ANIO_TOPE,
  hasta: v.anioHasta ?? ANIO_TOPE,
});

/** Los años en que existe el modelo, del más nuevo al más viejo. */
export function aniosPermitidos(versiones: VersionCatalogo[]): string[] {
  const anios = new Set<number>();
  for (const v of versiones) {
    const { desde, hasta } = rango(v);
    for (let a = desde; a <= hasta && a - desde < 80; a++) anios.add(a);
  }
  return [...anios].sort((a, b) => b - a).map(String);
}

/** Del primer al último año del modelo en el catálogo: lo que significa "todos los años". */
export function rangoCompleto(versiones: VersionCatalogo[]): { desde: string; hasta: string } | null {
  const anios = aniosPermitidos(versiones).map(Number);
  if (anios.length === 0) return null;
  return { desde: String(Math.min(...anios)), hasta: String(Math.max(...anios)) };
}

/** Los motores del modelo en los años de la fila (todos, si la fila no tiene años). */
export function motoresPermitidos(versiones: VersionCatalogo[], anioDesde?: string, anioHasta?: string): string[] {
  const d = Number(anioDesde) || null;
  const h = Number(anioHasta) || d;
  const motores = new Set<string>();
  for (const v of versiones) {
    if (!v.motor) continue;
    const r = rango(v);
    if (d !== null && h !== null && (r.hasta < d || r.desde > h)) continue;
    motores.add(v.motor);
  }
  return [...motores].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

/** Busca un motor escrito a mano entre los del catálogo (ignora mayúsculas y espacios). */
export function motorDelCatalogo(motor: string, motores: string[]): string | null {
  const n = normalizarParaComparar(motor);
  return motores.find((m) => normalizarParaComparar(m) === n) ?? null;
}

/**
 * Store de la configuración remota del Mantenedor común para el panel (contrato, sección 6).
 *
 * Qué hace, en orden:
 * 1. Al arrancar lee la caché de `localStorage` (`repuestop.remote-config.PANEL.v1`) y la deja
 *    disponible de inmediato; sin caché, los hooks devuelven sus fallbacks. Nunca bloquea el render.
 * 2. En paralelo pide `GET /api/v1/config/bootstrap?cliente=PANEL` con `If-None-Match`:
 *    200 reemplaza y guarda, 304 no cambia nada, error reintenta con backoff 1 s / 5 s / 30 s.
 * 3. Al volver a la pestaña y cada 5 minutos consulta `GET /api/v1/config/version`; si la
 *    versión cambió, vuelve a pedir el bootstrap.
 *
 * Es un store fuera de React (`subscribe`/`get`) para que `utils/pricing.ts` y `utils/garantia.ts`,
 * que no son componentes, lean la misma configuración que los hooks. El provider lo conecta a
 * React con `useSyncExternalStore`.
 *
 * Con `VITE_REMOTE_CONFIG_FIXTURE=true` se usa `fixtures/bootstrap.panel.json` en vez de la red:
 * sirve para probar flags y listas antes de que el backend exponga el endpoint.
 */
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../utils/imageHelper';
import { LISTAS_FALLBACK, MARCAS_VEHICULO_FALLBACK } from './fallbacks';
import type {
  BootstrapDTO, CacheRemota, CatalogoDe, EstadoRemoteConfig, NombreCatalogo, OpcionListaDTO, TipoParametro,
} from './types';

export const CLIENTE_REMOTO = 'PANEL' as const;
export const CLAVE_CACHE = `repuestop.remote-config.${CLIENTE_REMOTO}.v1`;
/** Reintentos tras un error del bootstrap; después del último se espera al próximo chequeo. */
export const BACKOFF_MS: readonly number[] = [1_000, 5_000, 30_000];
export const INTERVALO_VERSION_MS = 5 * 60 * 1_000;

const ESTADO_VACIO: EstadoRemoteConfig = { data: null, origen: 'ninguno', error: null, actualizadoEn: null };

type Oyente = () => void;

let estado: EstadoRemoteConfig = ESTADO_VACIO;
let etagActual: string | null = null;
let cacheLeida = false;
const oyentes = new Set<Oyente>();

let temporizadorReintento: ReturnType<typeof setTimeout> | null = null;
let temporizadorPeriodico: ReturnType<typeof setInterval> | null = null;
let intentoFallido = 0;
let pedidoEnCurso: Promise<void> | null = null;
let activo = false;

function emitir() {
  for (const oyente of oyentes) oyente();
}

function fijar(parcial: Partial<EstadoRemoteConfig>) {
  estado = { ...estado, ...parcial };
  emitir();
}

/** `W/"<version>-PANEL"`, como lo arma el backend; se usa si la caché vieja no guardó el ETag. */
function etagDe(version: number): string {
  return `W/"${version}-${CLIENTE_REMOTO}"`;
}

/** Validación mínima para no guardar basura: lo justo para que los accesores no revienten. */
function esBootstrap(valor: unknown): valor is BootstrapDTO {
  if (!valor || typeof valor !== 'object') return false;
  const v = valor as Record<string, unknown>;
  return typeof v.version === 'number'
    && typeof v.parametros === 'object' && v.parametros !== null
    && typeof v.flags === 'object' && v.flags !== null
    && typeof v.listas === 'object' && v.listas !== null
    && Array.isArray(v.categorias)
    && Array.isArray(v.marcasVehiculo)
    && Array.isArray(v.marcasRepuestoDestacadas);
}

function leerCache(): CacheRemota | null {
  try {
    const crudo = localStorage.getItem(CLAVE_CACHE);
    if (!crudo) return null;
    const cache = JSON.parse(crudo) as Partial<CacheRemota>;
    if (!cache || typeof cache.version !== 'number' || !esBootstrap(cache.data)) return null;
    return { version: cache.version, data: cache.data, guardadoEn: cache.guardadoEn ?? '', etag: cache.etag };
  } catch {
    // Sin localStorage (navegación privada estricta) o JSON corrupto: se sigue con fallbacks.
    return null;
  }
}

function guardarCache(data: BootstrapDTO, etag: string | null) {
  const cache: CacheRemota = { version: data.version, data, guardadoEn: new Date().toISOString(), etag: etag ?? undefined };
  try {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify(cache));
  } catch {
    // Cuota llena o storage bloqueado: la configuración igual queda en memoria para esta pestaña.
  }
}

/** Lee la caché una sola vez, la primera vez que alguien pide el estado o arranca el store. */
function asegurarCache() {
  if (cacheLeida) return;
  cacheLeida = true;
  const cache = leerCache();
  if (!cache) return;
  etagActual = cache.etag ?? etagDe(cache.version);
  estado = { data: cache.data, origen: 'cache', error: null, actualizadoEn: cache.guardadoEn || null };
}

function limpiarReintento() {
  if (temporizadorReintento !== null) {
    clearTimeout(temporizadorReintento);
    temporizadorReintento = null;
  }
}

function programarReintento() {
  limpiarReintento();
  const espera = BACKOFF_MS[intentoFallido];
  // Tras el último backoff no se insiste: el chequeo de versión (foco o 5 min) vuelve a intentar.
  if (espera === undefined) return;
  intentoFallido += 1;
  temporizadorReintento = setTimeout(() => {
    temporizadorReintento = null;
    void pedirBootstrap();
  }, espera);
}

async function pedirBootstrap(): Promise<void> {
  if (!activo) return;
  if (pedidoEnCurso) return pedidoEnCurso;
  pedidoEnCurso = (async () => {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (etagActual) headers['If-None-Match'] = etagActual;
      // `publico`: hasta que el backend exponga el endpoint, Spring responde 401/403 a esta ruta.
      // Eso no es una sesión vencida y no puede sacar al vendedor del panel.
      const respuesta = await apiFetch(
        `${API_BASE_URL}/api/v1/config/bootstrap?cliente=${CLIENTE_REMOTO}`,
        { headers, publico: true },
      );
      if (respuesta.status === 304) {
        intentoFallido = 0;
        if (estado.error) fijar({ error: null });
        return;
      }
      if (!respuesta.ok) throw new Error(`bootstrap HTTP ${respuesta.status}`);
      const cuerpo: unknown = await respuesta.json();
      if (!esBootstrap(cuerpo)) throw new Error('bootstrap con forma inesperada');
      if (!activo) return;
      intentoFallido = 0;
      etagActual = respuesta.headers.get('ETag') ?? etagDe(cuerpo.version);
      guardarCache(cuerpo, etagActual);
      fijar({ data: cuerpo, origen: 'red', error: null, actualizadoEn: new Date().toISOString() });
    } catch (err) {
      if (!activo) return;
      fijar({ error: err instanceof Error ? err.message : String(err) });
      programarReintento();
    } finally {
      pedidoEnCurso = null;
    }
  })();
  return pedidoEnCurso;
}

/** `GET /config/version`: si difiere de lo que tenemos (o no tenemos nada), se pide el bootstrap. */
async function comprobarVersion(): Promise<void> {
  if (!activo || pedidoEnCurso) return;
  if (!estado.data) return pedirBootstrap();
  try {
    const respuesta = await apiFetch(`${API_BASE_URL}/api/v1/config/version`, { headers: { Accept: 'application/json' }, publico: true });
    if (!respuesta.ok) return;
    const cuerpo = (await respuesta.json()) as { version?: unknown };
    if (typeof cuerpo?.version === 'number' && cuerpo.version !== estado.data.version) await pedirBootstrap();
  } catch {
    // Un chequeo fallido no es un error que mostrar: se vuelve a intentar en el próximo foco.
  }
}

function alCambiarVisibilidad() {
  if (document.visibilityState === 'visible') void comprobarVersion();
}

async function cargarFixture(): Promise<void> {
  // Import dinámico: el JSON sólo entra al bundle cuando la variable está activa.
  const modulo = await import('./fixtures/bootstrap.panel.json');
  const data = (modulo as { default?: unknown }).default ?? modulo;
  if (!activo) return;
  if (!esBootstrap(data)) {
    fijar({ error: 'fixtures/bootstrap.panel.json no cumple el contrato' });
    return;
  }
  fijar({ data, origen: 'fixture', error: null, actualizadoEn: new Date().toISOString() });
}

function usarFixture(): boolean {
  return import.meta.env.VITE_REMOTE_CONFIG_FIXTURE === 'true';
}

/**
 * Arranca el ciclo (lo llama el provider al montarse). Devuelve la función que lo detiene:
 * quita temporizadores y oyentes del documento, pero conserva lo ya cargado.
 */
function iniciar(): () => void {
  asegurarCache();
  activo = true;
  if (usarFixture()) {
    void cargarFixture();
  } else {
    void pedirBootstrap();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', alCambiarVisibilidad);
    temporizadorPeriodico = setInterval(() => void comprobarVersion(), INTERVALO_VERSION_MS);
  }
  return detener;
}

function detener() {
  activo = false;
  limpiarReintento();
  if (temporizadorPeriodico !== null) {
    clearInterval(temporizadorPeriodico);
    temporizadorPeriodico = null;
  }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', alCambiarVisibilidad);
}

/** Parsea un parámetro según `parametrosTipos` (contrato, sección 2). `undefined` si no se puede. */
export function parsearParametro(valor: string | undefined, tipo: TipoParametro | undefined): unknown {
  if (valor === undefined) return undefined;
  switch (tipo) {
    case 'NUMBER':
    case 'PERCENT':
    case 'MONEY': {
      const numero = Number(valor);
      return Number.isFinite(numero) ? numero : undefined;
    }
    case 'BOOLEAN':
      return valor === 'true' ? true : valor === 'false' ? false : undefined;
    case 'JSON':
      try {
        return JSON.parse(valor);
      } catch {
        return undefined;
      }
    case 'STRING':
      return valor;
    default:
      // Sin tipo declarado no se adivina: vale el fallback del que lo pide.
      return undefined;
  }
}

/* Accesores puros sobre un estado: los usan los hooks (con el estado del contexto) y el código
 * fuera de React (con `remoteConfig.get()`). Todos devuelven el fallback si el dato no vino. */

export function leerFlag(estado: EstadoRemoteConfig, clave: string, fallback = true): boolean {
  const valor = estado.data?.flags[clave];
  return typeof valor === 'boolean' ? valor : fallback;
}

export function leerLista(
  estado: EstadoRemoteConfig,
  codigo: string,
  fallback: readonly OpcionListaDTO[] = LISTAS_FALLBACK[codigo] ?? [],
): readonly OpcionListaDTO[] {
  const lista = estado.data?.listas[codigo];
  // Una lista presente pero vacía es una decisión del Mantenedor (todo desactivado), no un fallo.
  return Array.isArray(lista) ? lista : fallback;
}

/**
 * Parámetro parseado según su tipo. Si no vino, no se pudo parsear o el tipo resultante no es el
 * del fallback (un "abc" donde se esperaba un número), vale el fallback.
 */
export function leerParametro<T extends number | string | boolean>(estado: EstadoRemoteConfig, clave: string, fallback: T): T {
  const data = estado.data;
  if (!data) return fallback;
  const valor = parsearParametro(data.parametros[clave], data.parametrosTipos[clave]);
  return typeof valor === typeof fallback ? (valor as T) : fallback;
}

/** Parámetro `JSON`, o `STRING` cuando se quiere el texto crudo. Sin validar la forma. */
export function leerParametroJson(estado: EstadoRemoteConfig, clave: string): unknown {
  const data = estado.data;
  if (!data) return undefined;
  return parsearParametro(data.parametros[clave], data.parametrosTipos[clave]);
}

const CATALOGOS_FALLBACK: { [K in NombreCatalogo]: CatalogoDe<K> } = {
  // El panel no tiene categorías de respaldo: las pide a `/catalogos/inventario/categorias-repuesto`.
  categorias: [],
  marcasVehiculo: [...MARCAS_VEHICULO_FALLBACK],
  marcasRepuestoDestacadas: [],
};

export function leerCatalogo<K extends NombreCatalogo>(
  estado: EstadoRemoteConfig,
  nombre: K,
  // TS no correlaciona el índice con el genérico: el mapa está tipado por clave, el cast es seguro.
  fallback: CatalogoDe<K> = CATALOGOS_FALLBACK[nombre] as CatalogoDe<K>,
): CatalogoDe<K> {
  const catalogo = estado.data?.[nombre];
  return Array.isArray(catalogo) && catalogo.length > 0 ? (catalogo as CatalogoDe<K>) : fallback;
}

export const remoteConfig = {
  /** Estado actual; lee la caché la primera vez. Para código fuera de React. */
  get(): EstadoRemoteConfig {
    asegurarCache();
    return estado;
  },
  subscribe(oyente: Oyente): () => void {
    oyentes.add(oyente);
    return () => { oyentes.delete(oyente); };
  },
  iniciar,
  detener,
  /** Fuerza un chequeo de versión (y el bootstrap si cambió). */
  refrescar: comprobarVersion,
  flag: (clave: string, fallback = true) => leerFlag(remoteConfig.get(), clave, fallback),
  lista: (codigo: string, fallback?: readonly OpcionListaDTO[]) => leerLista(remoteConfig.get(), codigo, fallback),
  parametro: <T extends number | string | boolean>(clave: string, fallback: T) => leerParametro(remoteConfig.get(), clave, fallback),
  catalogo: <K extends NombreCatalogo>(nombre: K, fallback?: CatalogoDe<K>) => leerCatalogo(remoteConfig.get(), nombre, fallback),
  /** Sólo para tests: vuelve al estado inicial sin tocar `localStorage`. */
  _reiniciarParaPruebas() {
    detener();
    limpiarReintento();
    estado = ESTADO_VACIO;
    etagActual = null;
    cacheLeida = false;
    intentoFallido = 0;
    pedidoEnCurso = null;
    oyentes.clear();
  },
};

export type RemoteConfigStore = typeof remoteConfig;

import { RequestTimeoutError, SessionExpiredError } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import { clearSession, getStoredSession } from './session';

const DEFAULT_TIMEOUT_MS = 25000;

export type FetchPrivadoInit = RequestInit & { timeoutMs?: number };

/** Arma la URL final: una ruta que empieza con "/" es relativa a la API. */
export function urlPrivada(path: string): string {
  return path.startsWith('/') ? `${API_BASE_URL}${path}` : path;
}

/**
 * El token solo viaja a nuestra API. Una URL absoluta de otro origen (una foto externa, por
 * ejemplo) se pide sin credenciales para no regalarle la sesion del vendedor a un tercero.
 */
function esDeLaApi(url: string): boolean {
  return url === API_BASE_URL || url.startsWith(`${API_BASE_URL}/`);
}

/**
 * Descarga un recurso privado de la API (fotos del borrador de carga, imagenes del chat de
 * soporte) con el token del vendedor.
 *
 * A diferencia de `apiFetch`, un 403 o un 404 NO cierran la sesion: aqui significan "esta
 * imagen ya no existe o no es tuya", algo normal al retomar un borrador o mirar un chat viejo,
 * y no deben sacar al vendedor del panel. Solo un 401 (token vencido) se trata como
 * `apiFetch`: se limpia la sesion, se avisa con 'repuestop:session-expired' y se lanza
 * `SessionExpiredError`.
 */
export async function fetchPrivado(path: string, init: FetchPrivadoInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, signal: senalExterna, ...resto } = init;
  const url = urlPrivada(path);

  const encabezados = new Headers(headers);
  const session = getStoredSession();
  if (session?.token && esDeLaApi(url) && !encabezados.has('Authorization')) {
    encabezados.set('Authorization', `Bearer ${session.token}`);
  }

  const controller = new AbortController();
  let vencido = false;
  const timeoutId = setTimeout(() => {
    vencido = true;
    controller.abort();
  }, timeoutMs);
  const abortarPorFuera = () => controller.abort();
  if (senalExterna) {
    if (senalExterna.aborted) controller.abort();
    else senalExterna.addEventListener('abort', abortarPorFuera, { once: true });
  }

  let response: Response;
  try {
    response = await fetch(url, { ...resto, headers: encabezados, signal: controller.signal });
  } catch (err) {
    if (vencido && err instanceof DOMException && err.name === 'AbortError') {
      throw new RequestTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    senalExterna?.removeEventListener('abort', abortarPorFuera);
  }

  if (response.status === 401) {
    clearSession();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('repuestop:session-expired'));
    }
    throw new SessionExpiredError();
  }

  return response;
}

/** Descarga un recurso privado como Blob. Devuelve null si la API responde con error (403, 404, 500...). */
export async function fetchBlobPrivado(path: string, init?: FetchPrivadoInit): Promise<Blob | null> {
  const response = await fetchPrivado(path, init);
  if (!response.ok) return null;
  return response.blob();
}

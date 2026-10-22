import { clearSession } from './session';

const DEFAULT_TIMEOUT_MS = 25000;

/**
 * La validación de una plantilla grande ejecuta las mismas reglas que una carga real,
 * fila por fila, pero sin guardar. Es el único request interactivo que puede superar el
 * timeout habitual de la API sin estar bloqueado. Mantenemos este límite acotado para
 * que un backend caído no deje la interfaz esperando indefinidamente.
 */
export const BULK_EXCEL_VALIDATION_TIMEOUT_MS = 8 * 60 * 1000;

/** Cabecera que identifica al cliente ante el backend (contrato del Mantenedor, sección 6, punto 6). */
export const X_CLIENT = 'panel';

export interface ApiFetchInit extends RequestInit {
  /**
   * Endpoint público (bootstrap de configuración, versión): un 401/403 ahí no significa que la
   * sesión del vendedor venció, sino que el backend todavía no conoce la ruta o no la dejó
   * abierta. No se limpia la sesión ni se avisa; se devuelve la respuesta tal cual.
   */
  publico?: boolean;
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Tu sesión expiró. Inicia sesión nuevamente.');
    this.name = 'SessionExpiredError';
  }
}

export class RequestTimeoutError extends Error {
  constructor() {
    super('La solicitud tardó demasiado. Revisa tu conexión e intenta nuevamente.');
    this.name = 'RequestTimeoutError';
  }
}

/**
 * Thin wrapper around fetch() shared by every API call in the app:
 * - Aborts and throws RequestTimeoutError if the backend never responds
 *   (previously a hung request left the UI spinner stuck forever, QA-SRC-006).
 * - On 401/403 it clears the local session and broadcasts
 *   'repuestop:session-expired' so App.tsx can bounce the user back to the
 *   login screen instead of leaving them retrying with a dead token
 *   (previously there was no way out of an expired session, QA-SRC-004).
 * - Agrega `X-Client: panel` si el llamador no la puso: el backend sabe desde qué cliente llega
 *   cada llamada (ClientOriginFilter) y el Mantenedor común lo exige en su contrato.
 */
export async function apiFetch(
  input: string,
  init?: ApiFetchInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const { publico = false, ...fetchInit } = init ?? {};
  const headers = new Headers(fetchInit.headers);
  if (!headers.has('X-Client')) headers.set('X-Client', X_CLIENT);

  let response: Response;
  try {
    response = await fetch(input, { ...fetchInit, headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new RequestTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!publico && (response.status === 401 || response.status === 403)) {
    clearSession();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('repuestop:session-expired'));
    }
    throw new SessionExpiredError();
  }

  return response;
}

import { clearSession } from './session';

const DEFAULT_TIMEOUT_MS = 25000;

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
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new RequestTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401 || response.status === 403) {
    clearSession();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('repuestop:session-expired'));
    }
    throw new SessionExpiredError();
  }

  return response;
}

export interface UserSession {
  email: string;
  role: string;
  token: string;
  sellerId: string;
  founder?: boolean;
}

const SESSION_KEY = 'repuestop_session';
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidUserSession(value: unknown): value is UserSession {
  if (!isRecord(value)) return false;

  return (
    typeof value.email === 'string' &&
    typeof value.role === 'string' &&
    typeof value.token === 'string' &&
    typeof value.sellerId === 'string' &&
    (value.founder === undefined || typeof value.founder === 'boolean') &&
    value.email.length > 0 &&
    value.token.length > 0 &&
    value.sellerId.length > 0
  );
}

/** Que habia guardado: una sesion usable, una vencida por TTL, o nada aprovechable. */
type SesionLeida =
  | { estado: 'valida'; user: UserSession }
  | { estado: 'vencida'; user: UserSession }
  | { estado: 'ausente' };

function leerSesion(rawSession: string | null): SesionLeida {
  if (!rawSession) return { estado: 'ausente' };

  try {
    const parsed: unknown = JSON.parse(rawSession);
    if (!isRecord(parsed) || !isValidUserSession(parsed.user) || typeof parsed.timestamp !== 'number') {
      return { estado: 'ausente' };
    }

    if (Date.now() - parsed.timestamp > SESSION_TTL_MS) {
      return { estado: 'vencida', user: parsed.user };
    }

    return { estado: 'valida', user: parsed.user };
  } catch {
    return { estado: 'ausente' };
  }
}

/** Se emite al descartar una sesion vencida que todavia hay que revocar en el servidor. */
export const EVENTO_SESION_VENCIDA = 'repuestop:sesion-vencida';

/**
 * Token de una sesion descartada por vencimiento, a la espera de que alguien la revoque.
 *
 * Vive en memoria y no en el almacenamiento a proposito: cubre el tramo entre que se detecta el
 * vencimiento y que App alcanza a pedir la revocacion, no algo que deba sobrevivir a la pestana.
 */
let tokenPorRevocar: string | null = null;

/**
 * Entrega el token pendiente de revocar, una sola vez.
 *
 * Vencer la sesion en el navegador no la cerraba en el servidor (SEC-MARKET-B03): el panel la
 * daba por terminada a las 2 h mientras el backend la sostenia hasta su `exp`, que son 8 h
 * deslizantes. Con esto las 2 h pasan a ser un control real y no una sugerencia.
 */
export function tomarTokenPorRevocar(): string | null {
  const token = tokenPorRevocar;
  tokenPorRevocar = null;
  return token;
}

export function getStoredSession(): UserSession | null {
  const leida = leerSesion(sessionStorage.getItem(SESSION_KEY));

  localStorage.removeItem(SESSION_KEY);

  if (leida.estado === 'valida') return leida.user;

  // Solo la vencida deja un token que revocar: de una ilegible no se puede sacar uno, y de una
  // ausente no hay nada que cerrar.
  if (leida.estado === 'vencida') {
    tokenPorRevocar = leida.user.token;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_SESION_VENCIDA));
  }

  sessionStorage.removeItem(SESSION_KEY);
  return null;
}

export function saveSession(user: UserSession): void {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      user,
      timestamp: Date.now(),
    })
  );
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

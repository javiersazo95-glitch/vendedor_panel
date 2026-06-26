export interface UserSession {
  email: string;
  role: string;
  token: string;
  sellerId: string;
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
    value.email.length > 0 &&
    value.token.length > 0 &&
    value.sellerId.length > 0
  );
}

function parseSession(rawSession: string | null): UserSession | null {
  if (!rawSession) return null;

  try {
    const parsed: unknown = JSON.parse(rawSession);
    if (!isRecord(parsed) || !isValidUserSession(parsed.user) || typeof parsed.timestamp !== 'number') {
      return null;
    }

    if (Date.now() - parsed.timestamp > SESSION_TTL_MS) {
      return null;
    }

    return parsed.user;
  } catch {
    return null;
  }
}

export function getStoredSession(): UserSession | null {
  const session = parseSession(sessionStorage.getItem(SESSION_KEY));

  localStorage.removeItem(SESSION_KEY);

  if (!session) {
    sessionStorage.removeItem(SESSION_KEY);
  }

  return session;
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

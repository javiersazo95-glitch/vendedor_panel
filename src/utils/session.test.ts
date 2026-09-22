import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EVENTO_SESION_VENCIDA, getStoredSession, saveSession, clearSession, tomarTokenPorRevocar } from './session';

const validUser = { email: 'vendedor@repuestop.cl', role: 'vendedor', token: 'tok-123', sellerId: 'seller-1' };

describe('session storage (ENG-SRC-009)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the saved session right after saveSession()', () => {
    saveSession(validUser);
    expect(getStoredSession()).toEqual(validUser);
  });

  it('returns null and clears storage once the session is older than the 2h TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    saveSession(validUser);

    vi.setSystemTime(new Date('2026-01-01T02:00:01Z')); // TTL + 1s
    expect(getStoredSession()).toBeNull();
    expect(sessionStorage.getItem('repuestop_session')).toBeNull();
  });

  it('returns null for malformed JSON without throwing', () => {
    sessionStorage.setItem('repuestop_session', '{not valid json');
    expect(getStoredSession()).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    sessionStorage.setItem(
      'repuestop_session',
      JSON.stringify({ user: { email: 'a@a.com', role: 'vendedor' }, timestamp: Date.now() })
    );
    expect(getStoredSession()).toBeNull();
  });

  it('clearSession() removes the session from both storages', () => {
    saveSession(validUser);
    localStorage.setItem('repuestop_session', 'leftover');
    clearSession();
    expect(sessionStorage.getItem('repuestop_session')).toBeNull();
    expect(localStorage.getItem('repuestop_session')).toBeNull();
  });
});

describe('revocación de la sesión vencida (SEC-MARKET-B03)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    tomarTokenPorRevocar(); // deja el pendiente en limpio entre pruebas
  });

  afterEach(() => vi.useRealTimers());

  /**
   * Vencer la sesión en el navegador no la cerraba en el servidor: el panel la daba por
   * terminada a las 2 h mientras el backend la sostenía hasta su `exp`, que son 8 h deslizantes.
   * El token se retiene para que App pueda pedir la revocación.
   */
  it('retiene el token de la sesión vencida para revocarlo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    saveSession(validUser);

    vi.setSystemTime(new Date('2026-01-01T02:00:01Z'));
    expect(getStoredSession()).toBeNull();
    expect(tomarTokenPorRevocar()).toBe('tok-123');
  });

  it('entrega el token una sola vez', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    saveSession(validUser);
    vi.setSystemTime(new Date('2026-01-01T02:00:01Z'));
    getStoredSession();

    expect(tomarTokenPorRevocar()).toBe('tok-123');
    expect(tomarTokenPorRevocar()).toBeNull();
  });

  it('avisa por evento, para el vencimiento detectado con la pestaña ya abierta', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    saveSession(validUser);
    const escucha = vi.fn();
    window.addEventListener(EVENTO_SESION_VENCIDA, escucha);

    vi.setSystemTime(new Date('2026-01-01T02:00:01Z'));
    getStoredSession();

    expect(escucha).toHaveBeenCalledTimes(1);
    window.removeEventListener(EVENTO_SESION_VENCIDA, escucha);
  });

  /** De una sesión ilegible no se puede sacar token, y de una ausente no hay nada que cerrar. */
  it('no retiene nada cuando la sesión es ilegible o no existe', () => {
    sessionStorage.setItem('repuestop_session', '{not valid json');
    expect(getStoredSession()).toBeNull();
    expect(tomarTokenPorRevocar()).toBeNull();

    sessionStorage.clear();
    expect(getStoredSession()).toBeNull();
    expect(tomarTokenPorRevocar()).toBeNull();
  });
});

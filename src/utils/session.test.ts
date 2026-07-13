import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getStoredSession, saveSession, clearSession } from './session';

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

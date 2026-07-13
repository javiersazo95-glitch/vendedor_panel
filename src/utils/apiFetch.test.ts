import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, SessionExpiredError, RequestTimeoutError } from './apiFetch';
import { saveSession, getStoredSession } from './session';

describe('apiFetch', () => {
  beforeEach(() => {
    saveSession({ email: 'a@a.com', role: 'vendedor', token: 'tok', sellerId: 'seller-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('clears the session and broadcasts repuestos:session-expired on a 401 (QA-SRC-004)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))));
    const listener = vi.fn();
    window.addEventListener('repuestop:session-expired', listener);

    await expect(apiFetch('https://api.test/x')).rejects.toBeInstanceOf(SessionExpiredError);

    expect(getStoredSession()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('repuestop:session-expired', listener);
  });

  it('clears the session on a 403 the same way as a 401', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 403 }))));
    await expect(apiFetch('https://api.test/x')).rejects.toBeInstanceOf(SessionExpiredError);
    expect(getStoredSession()).toBeNull();
  });

  it('throws RequestTimeoutError instead of hanging forever when the backend never responds (QA-SRC-006)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new DOMException('aborted', 'AbortError');
              reject(err);
            });
          })
      )
    );

    const promise = apiFetch('https://api.test/slow');
    const assertion = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(25000);
    await assertion;
  });

  it('returns the response unchanged on a normal 2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"ok":true}', { status: 200 }))));
    const response = await apiFetch('https://api.test/ok');
    expect(response.status).toBe(200);
    expect(getStoredSession()).not.toBeNull();
  });
});

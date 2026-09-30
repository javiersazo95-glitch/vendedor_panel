import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBlobPrivado, fetchPrivado } from './fetchPrivado';
import { RequestTimeoutError, SessionExpiredError } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import { getStoredSession, saveSession } from './session';

function simularRespuesta(status: number, body: BodyInit | null = null) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(body, { status })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('fetchPrivado', () => {
  beforeEach(() => {
    saveSession({ email: 'a@a.com', role: 'vendedor', token: 'tok', sellerId: '7' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('antepone la URL de la API a las rutas relativas y manda el token', async () => {
    const fetchMock = simularRespuesta(200, 'x');
    await fetchPrivado('/api/v1/uploads/r2/Soporte_carga/a.jpg');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/api/v1/uploads/r2/Soporte_carga/a.jpg`);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('no manda el token a un origen distinto de la API', async () => {
    const fetchMock = simularRespuesta(200, 'x');
    await fetchPrivado('https://otro-sitio.example/foto.jpg');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBeNull();
  });

  it('un 403 NO cierra la sesion: solo devuelve la respuesta', async () => {
    simularRespuesta(403);
    const listener = vi.fn();
    window.addEventListener('repuestop:session-expired', listener);

    const res = await fetchPrivado('/api/v1/x');

    expect(res.status).toBe(403);
    expect(getStoredSession()).not.toBeNull();
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('repuestop:session-expired', listener);
  });

  it('un 404 tampoco cierra la sesion', async () => {
    simularRespuesta(404);
    const res = await fetchPrivado('/api/v1/x');
    expect(res.status).toBe(404);
    expect(getStoredSession()).not.toBeNull();
  });

  it('un 401 cierra la sesion y avisa, igual que apiFetch', async () => {
    simularRespuesta(401);
    const listener = vi.fn();
    window.addEventListener('repuestop:session-expired', listener);

    await expect(fetchPrivado('/api/v1/x')).rejects.toBeInstanceOf(SessionExpiredError);

    expect(getStoredSession()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('repuestop:session-expired', listener);
  });

  it('corta con RequestTimeoutError si el backend no responde', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );

    const promesa = fetchPrivado('/api/v1/lento', { timeoutMs: 1000 });
    const verificacion = expect(promesa).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await verificacion;
  });

  it('fetchBlobPrivado devuelve el Blob si todo sale bien y null si la API responde error', async () => {
    simularRespuesta(200, 'contenido');
    const blob = await fetchBlobPrivado('/api/v1/img');
    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(9);

    simularRespuesta(404);
    expect(await fetchBlobPrivado('/api/v1/img')).toBeNull();
    expect(getStoredSession()).not.toBeNull();
  });
});

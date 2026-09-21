import { describe, it, expect, afterEach, vi } from 'vitest';

describe('API_BASE_URL fallback (ENG-SRC-008)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws instead of silently defaulting to production when VITE_API_URL is missing on a non-local host', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const originalLocation = window.location;
    // jsdom defaults to localhost; simulate a real staging/preview deploy.
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, hostname: 'preview.repuestop.cl' },
      configurable: true,
    });

    await expect(import('./imageHelper')).rejects.toThrow(/VITE_API_URL/);

    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true });
  });

  it('falls back to localhost:8080 without throwing when running locally', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, hostname: 'localhost' },
      configurable: true,
    });

    const mod = await import('./imageHelper');
    expect(mod.API_BASE_URL).toBe('http://localhost:8080');

    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true });
  });

  it('limpia sufijos /api/v1 o /api al final de VITE_API_URL para evitar duplicacion de rutas', async () => {
    vi.stubEnv('VITE_API_URL', 'https://dev-api.repuestop.cl/api/v1');
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, hostname: 'dev-inventario.repuestop.cl' },
      configurable: true,
    });

    const mod = await import('./imageHelper');
    expect(mod.API_BASE_URL).toBe('https://dev-api.repuestop.cl');

    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true });
  });
});

describe('resolveImageUri: escape del fileId (SEC-MARKET-A33)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /**
   * De las tres ramas que extraen el fileId, dos lo acotan con una expresión regular a
   * [a-zA-Z0-9_-]. La que lee el parámetro `id` de la URL no filtraba nada, así que un valor
   * con '/' o '?' alteraba la ruta que se terminaba pidiendo al backend.
   */
  it('escapa un fileId que intentaría salirse del segmento de la ruta', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.repuestop.cl');
    const { resolveImageUri } = await import('./imageHelper');

    const url = resolveImageUri('https://drive.google.com/open?id=..%2F..%2Fadmin');

    expect(url.startsWith('https://api.repuestop.cl/api/v1/uploads/drive/')).toBe(true);
    // Lo que importa: el valor no introduce separadores de ruta nuevos.
    expect(url).not.toContain('/uploads/drive/../');
    expect(new URL(url).pathname).toBe('/api/v1/uploads/drive/..%2F..%2Fadmin');
  });

  it('deja intacto un fileId normal de Drive', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.repuestop.cl');
    const { resolveImageUri } = await import('./imageHelper');

    expect(resolveImageUri('https://drive.google.com/file/d/1AbC_x-yZ/view'))
      .toBe('https://api.repuestop.cl/api/v1/uploads/drive/1AbC_x-yZ');
  });
});

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
});

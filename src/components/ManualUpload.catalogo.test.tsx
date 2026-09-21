import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ManualUpload } from './ManualUpload';

/**
 * SEC-MARKET-A30/A31: las llamadas al catálogo se hacían con `fetch()` crudo, fuera de
 * `apiFetch`, así que quedaban sin el límite de tiempo de la API. Un backend que acepta la
 * conexión y nunca responde dejaba el formulario cargando sin final.
 *
 * La diferencia observable entre los dos caminos es el `AbortSignal`: `apiFetch` lo adjunta
 * para poder cortar en el timeout, y un `fetch()` crudo no lleva ninguno.
 */
describe('ManualUpload: catálogo encaminado por apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('pide el catálogo con un AbortSignal, para que el timeout pueda cortarlo', async () => {
    render(<ManualUpload isOpen onClose={() => {}} onSave={async () => {}} editProduct={null} />);

    const llamadasAlCatalogo = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/v1/catalogos/inventario/'));

    await waitFor(() => expect(llamadasAlCatalogo().length).toBeGreaterThan(0));

    for (const [url, init] of llamadasAlCatalogo()) {
      expect(init?.signal, `sin AbortSignal: ${String(url)}`).toBeInstanceOf(AbortSignal);
    }
  });
});

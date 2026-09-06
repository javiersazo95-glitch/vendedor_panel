import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';

import { useEsquemaPlantilla } from './plantillaEsquema';
import { useMapeosGuardados } from './plantillaMapeos';

/**
 * Regresión: con StrictMode (que es como corre el panel en desarrollo) React monta el
 * efecto, lo desmonta y lo vuelve a montar. El hook llevaba un ref de "ya pedí" y además
 * un flag de "sigo montado": el cleanup del primer montaje invalidaba el pedido en vuelo,
 * el remontaje lo daba por hecho por el ref, y la respuesta llegaba para ser descartada.
 *
 * El sintoma no era un error sino algo peor: el panel seguía con el contrato de respaldo
 * -sin categorías ni marcas- aunque el backend hubiera contestado 200, así que la
 * traducción contra el catálogo no se ofrecía nunca y las categorías inválidas pasaban sin
 * marcarse.
 */
const SESION = { sellerId: '1', token: 'tok', email: 'v@x.cl', role: 'PROVEEDOR' };

const esquemaDelBackend = {
  version: '2.1.0',
  columnas: ['nombre_publicado', 'categoria'],
  columnasObligatorias: ['categoria'],
  hojaCompatibilidadesColumnas: [],
  catalogos: { categorias: ['Frenos', 'Suspensión'], marcasRepuesto: ['Bosch'] },
};

describe('los hooks de la carga masiva bajo StrictMode', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    sessionStorage.setItem('repuestop_session', JSON.stringify({ user: SESION, timestamp: Date.now() }));
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('el esquema del backend llega y reemplaza al contrato de respaldo', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => esquemaDelBackend });

    const { result } = renderHook(() => useEsquemaPlantilla(true), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.usandoRespaldo).toBe(false));
    expect(result.current.esquema.catalogos.categorias).toEqual(['Frenos', 'Suspensión']);
    expect(result.current.esquema.version).toBe('2.1.0');
  });

  it('se pide una sola vez, no una por montaje', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => esquemaDelBackend });

    const { result } = renderHook(() => useEsquemaPlantilla(true), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.usandoRespaldo).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('si el backend no responde se sigue con el respaldo, sin romper la pantalla', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useEsquemaPlantilla(true), { wrapper: StrictMode });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.usandoRespaldo).toBe(true);
    expect(result.current.esquema.version).toBe('2.1.0');
  });

  it('sin la carga masiva abierta no se pide nada', () => {
    renderHook(() => useEsquemaPlantilla(false), { wrapper: StrictMode });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('los mapeos guardados en la cuenta también llegan', async () => {
    const mapeo = { oficial: { categoria: '0' }, extras: {}, valueMap: {} };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ firma: 'codigo|precio', mapeoJson: JSON.stringify(mapeo) }],
    });

    const { result } = renderHook(() => useMapeosGuardados(true), { wrapper: StrictMode });

    await waitFor(() => expect(Object.keys(result.current.mapeos)).toEqual(['codigo|precio']));
  });
});

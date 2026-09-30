import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { fetchBlobPrivado } from './fetchPrivado';
import { cargarImagenPrivada, limpiarCacheImagenesPrivadas, useImagenPrivada } from './useImagenPrivada';

vi.mock('./fetchPrivado', () => ({ fetchBlobPrivado: vi.fn() }));

describe('useImagenPrivada', () => {
  const originales = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };
  let contador = 0;

  beforeEach(() => {
    contador = 0;
    URL.createObjectURL = vi.fn(() => `blob:img-${++contador}`);
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    limpiarCacheImagenesPrivadas();
    URL.createObjectURL = originales.crear;
    URL.revokeObjectURL = originales.revocar;
    vi.clearAllMocks();
  });

  it('descarga la imagen con token y entrega un object URL', async () => {
    vi.mocked(fetchBlobPrivado).mockResolvedValue(new Blob(['x']));
    const { result } = renderHook(() => useImagenPrivada('/api/v1/a.jpg'));

    expect(result.current).toEqual({ url: null, cargando: true, error: false });
    await waitFor(() => expect(result.current.url).toBe('blob:img-1'));
    expect(result.current.cargando).toBe(false);
    expect(fetchBlobPrivado).toHaveBeenCalledWith('/api/v1/a.jpg');
  });

  it('usa el cache: la misma ruta no se descarga dos veces', async () => {
    vi.mocked(fetchBlobPrivado).mockResolvedValue(new Blob(['x']));
    await cargarImagenPrivada('/api/v1/b.jpg');
    const { result } = renderHook(() => useImagenPrivada('/api/v1/b.jpg'));

    // Desde el primer render, sin pasar por "cargando".
    expect(result.current.url).toBe('blob:img-1');
    await act(async () => {});
    expect(result.current.url).toBe('blob:img-1');
    expect(fetchBlobPrivado).toHaveBeenCalledTimes(1);
  });

  it('marca error si la API no entrega la imagen (403/404)', async () => {
    vi.mocked(fetchBlobPrivado).mockResolvedValue(null);
    const { result } = renderHook(() => useImagenPrivada('/api/v1/no-existe.jpg'));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.url).toBeNull();
  });

  it('con ruta null no hace nada', () => {
    const { result } = renderHook(() => useImagenPrivada(null));
    expect(result.current).toEqual({ url: null, cargando: false, error: false });
    expect(fetchBlobPrivado).not.toHaveBeenCalled();
  });

  it('libera las imagenes mas viejas al pasar el tope de 200', async () => {
    vi.mocked(fetchBlobPrivado).mockResolvedValue(new Blob(['x']));
    for (let i = 0; i < 201; i++) await cargarImagenPrivada(`/api/v1/img-${i}.jpg`);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:img-1');
  });
});

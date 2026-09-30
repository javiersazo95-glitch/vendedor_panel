import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  ESTADO_VACIO,
  FotoBorradorRechazadaError,
  guardarBorrador,
  subirImagenBorrador,
  type EstadoBorrador,
} from './miExcelBorrador';
import { useBorradorCarga } from './useBorradorCarga';

vi.mock('./miExcelBorrador', async (importOriginal) => {
  const real = await importOriginal<typeof import('./miExcelBorrador')>();
  return {
    ...real,
    guardarBorrador: vi.fn(),
    subirImagenBorrador: vi.fn(),
    sincronizarImagenesBorrador: vi.fn(async () => 0),
    subirArchivoBorrador: vi.fn(),
  };
});
vi.mock('./imageCompression', () => ({
  comprimirImagen: vi.fn(async (blob: Blob) => ({ blob })),
}));

/**
 * H33 (revisión del 30-sep): una foto que no se pudo guardar por un 429 o un corte quedaba
 * marcada como rechazada para toda la sesión y el borrador se quedaba sin ella.
 */
describe('useBorradorCarga: fotos del borrador', () => {
  const estado: EstadoBorrador = {
    ...ESTADO_VACIO,
    paso: 2,
    fotos: { asignaciones: { 0: ['a.jpg'] }, origen: 'carpeta', totalDisponibles: 1 },
  };
  const imagenes = { 'a.jpg': new Blob(['x'], { type: 'image/jpeg' }) };
  const montar = () => renderHook(() => useBorradorCarga({
    habilitado: true, estado, archivo: null, imagenes, esperaAutoguardado: 600000,
  }));

  beforeEach(() => {
    vi.mocked(guardarBorrador).mockResolvedValue({ version: 1, updatedAt: '2026-09-30T12:00:00Z' } as never);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('una foto que falló por un corte se vuelve a intentar y queda guardada', async () => {
    vi.mocked(subirImagenBorrador)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ id: 9, nombreArchivo: 'a.jpg' } as never);
    const { result, unmount } = montar();

    await act(async () => { await result.current.guardar(); });
    expect(result.current.estadoGuardado).toBe('error');
    expect(result.current.errorGuardado).toBe('falta 1 foto');

    await act(async () => { await result.current.guardar(); });
    expect(subirImagenBorrador).toHaveBeenCalledTimes(2);
    expect(result.current.guardadas).toEqual({ 'a.jpg': 9 });
    expect(result.current.estadoGuardado).toBe('guardado');
    unmount();
  });

  it('las fotos pendientes se reintentan solas aunque el vendedor no toque nada', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(subirImagenBorrador)
        .mockRejectedValueOnce(new Error('Demasiadas solicitudes'))
        .mockResolvedValueOnce({ id: 9, nombreArchivo: 'a.jpg' } as never);
      const { result, unmount } = montar();

      await act(async () => { await result.current.guardar(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });

      expect(subirImagenBorrador).toHaveBeenCalledTimes(2);
      expect(result.current.guardadas).toEqual({ 'a.jpg': 9 });
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('una foto que el servidor rechaza no se vuelve a mandar en cada guardado', async () => {
    vi.mocked(subirImagenBorrador).mockRejectedValue(new FotoBorradorRechazadaError('Solo JPG, PNG o WEBP'));
    const { result, unmount } = montar();

    await act(async () => { await result.current.guardar(); });
    await act(async () => { await result.current.guardar(); });

    expect(subirImagenBorrador).toHaveBeenCalledTimes(1);
    expect(result.current.estadoGuardado).toBe('guardado');
    unmount();
  });
});

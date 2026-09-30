import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clearSession, saveSession } from './session';
import {
  crearChatSoporte,
  listarChatsSoporte,
  obtenerChatActivo,
  obtenerMensajesSoporte,
  obtenerResumenSoporte,
  SoporteApiError,
  type ChatVendedor,
  type MensajeSoporte,
} from './soporteCargaApi';
import { useChatSoporte } from './useChatSoporte';

vi.mock('./soporteCargaApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('./soporteCargaApi')>();
  return {
    ...real,
    obtenerResumenSoporte: vi.fn(),
    obtenerChatActivo: vi.fn(),
    listarChatsSoporte: vi.fn(),
    crearChatSoporte: vi.fn(),
    obtenerMensajesSoporte: vi.fn(),
    enviarTextoSoporte: vi.fn(),
    enviarImagenSoporte: vi.fn(),
    marcarChatLeido: vi.fn(),
    cerrarChatSoporte: vi.fn(),
  };
});

const CHAT: ChatVendedor = {
  id: 5,
  motivo: 'DUDA',
  motivoDetalle: 'hola',
  estado: 'ESPERANDO_SOPORTE',
  contexto: null,
  ultimoMensajeAutor: 'VENDEDOR',
  ultimoMensajeAt: '2026-09-30T10:00:00-03:00',
  noLeidos: 0,
  createdAt: '2026-09-30T10:00:00-03:00',
  cerradoAt: null,
  cierreAutomaticoAt: null,
};

const msg = (id: number, autor: MensajeSoporte['autor'] = 'VENDEDOR'): MensajeSoporte => ({
  id,
  autor,
  autorNombre: null,
  texto: `m${id}`,
  imagenUrl: null,
  createdAt: '2026-09-30T10:00:00-03:00',
});

function fijarVisibilidad(oculta: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => oculta });
  document.dispatchEvent(new Event('visibilitychange'));
}

const avanzar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('useChatSoporte', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveSession({ email: 'a@a.com', role: 'vendedor', token: 'tok', sellerId: '7' });
    vi.mocked(obtenerResumenSoporte).mockResolvedValue({ chatActivoId: null, estado: null, noLeidos: 2 });
    vi.mocked(obtenerChatActivo).mockResolvedValue(null);
    vi.mocked(listarChatsSoporte).mockResolvedValue([]);
    vi.mocked(obtenerMensajesSoporte).mockResolvedValue([]);
  });

  afterEach(() => {
    fijarVisibilidad(false);
    vi.useRealTimers();
    vi.clearAllMocks();
    clearSession();
  });

  it('con el panel cerrado pide el resumen al montar y luego cada 30 s', async () => {
    const { result } = renderHook(() => useChatSoporte({ abierto: false }));
    await avanzar(0);
    expect(obtenerResumenSoporte).toHaveBeenCalledTimes(1);
    expect(result.current.resumen?.noLeidos).toBe(2);

    await avanzar(29_000);
    expect(obtenerResumenSoporte).toHaveBeenCalledTimes(1);
    await avanzar(1_000);
    expect(obtenerResumenSoporte).toHaveBeenCalledTimes(2);
    // Con el panel cerrado no se pide la conversacion ni sus mensajes.
    expect(obtenerChatActivo).not.toHaveBeenCalled();
    expect(obtenerMensajesSoporte).not.toHaveBeenCalled();
  });

  it('sin sesion no hace nada', async () => {
    clearSession();
    renderHook(() => useChatSoporte({ abierto: false }));
    await avanzar(60_000);
    expect(obtenerResumenSoporte).not.toHaveBeenCalled();
  });

  it('se pausa con la pestana oculta y retoma al volver', async () => {
    renderHook(() => useChatSoporte({ abierto: false }));
    await avanzar(0);
    expect(obtenerResumenSoporte).toHaveBeenCalledTimes(1);

    act(() => fijarVisibilidad(true));
    await avanzar(120_000);
    expect(obtenerResumenSoporte).toHaveBeenCalledTimes(1);

    act(() => fijarVisibilidad(false));
    await avanzar(0);
    expect(obtenerResumenSoporte).toHaveBeenCalledTimes(2);
  });

  it('ante errores espera cada vez mas (tope 60 s)', async () => {
    vi.mocked(obtenerResumenSoporte).mockRejectedValue(new Error('red'));
    renderHook(() => useChatSoporte({ abierto: false }));
    await avanzar(0);
    expect(obtenerResumenSoporte).toHaveBeenCalledTimes(1);
    await avanzar(30_000);
    expect(obtenerResumenSoporte).toHaveBeenCalledTimes(1);
    await avanzar(30_000);
    expect(obtenerResumenSoporte).toHaveBeenCalledTimes(2);
  });

  it('con el panel abierto trae los mensajes de a poco (despuesDe) y sin duplicados', async () => {
    vi.mocked(obtenerChatActivo).mockResolvedValue(CHAT);
    vi.mocked(obtenerMensajesSoporte)
      .mockResolvedValueOnce([msg(1, 'SISTEMA'), msg(2)])
      .mockResolvedValueOnce([msg(2), msg(3)])
      .mockResolvedValue([]);

    const { result } = renderHook(() => useChatSoporte({ abierto: true }));
    await avanzar(0);
    await avanzar(0);

    expect(result.current.chat?.id).toBe(5);
    expect(result.current.chatCargado).toBe(true);
    expect(obtenerResumenSoporte).not.toHaveBeenCalled();
    expect(vi.mocked(obtenerMensajesSoporte).mock.calls[0]).toEqual([5, null]);
    expect(result.current.mensajes.map((m) => m.id)).toEqual([1, 2]);

    await avanzar(5_000);
    expect(vi.mocked(obtenerMensajesSoporte).mock.calls[1]).toEqual([5, 2]);
    expect(result.current.mensajes.map((m) => m.id)).toEqual([1, 2, 3]);

    await avanzar(5_000);
    expect(vi.mocked(obtenerMensajesSoporte).mock.calls[2]).toEqual([5, 3]);
  });

  it('revisa el estado de la conversacion cada 15 s con el panel abierto', async () => {
    renderHook(() => useChatSoporte({ abierto: true }));
    await avanzar(0);
    expect(obtenerChatActivo).toHaveBeenCalledTimes(1);
    await avanzar(15_000);
    expect(obtenerChatActivo).toHaveBeenCalledTimes(2);
    // Sin conversacion abierta no se piden mensajes.
    expect(obtenerMensajesSoporte).not.toHaveBeenCalled();
  });

  it('un 429 no se muestra como "sin conexion"; un corte si', async () => {
    vi.mocked(obtenerChatActivo).mockRejectedValueOnce(new SoporteApiError('Demasiadas solicitudes', 429));
    const { result } = renderHook(() => useChatSoporte({ abierto: true }));
    await avanzar(0);
    expect(result.current.sinConexion).toBe(false);

    vi.mocked(obtenerChatActivo).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await avanzar(30_000);
    expect(obtenerChatActivo).toHaveBeenCalledTimes(2);
    expect(result.current.sinConexion).toBe(true);
  });

  it('crear con 409 carga la conversacion que ya estaba abierta', async () => {
    vi.mocked(crearChatSoporte).mockRejectedValue(new SoporteApiError('ya existe', 409));
    const { result } = renderHook(() => useChatSoporte({ abierto: true }));
    await avanzar(0);
    expect(result.current.chat).toBeNull();

    vi.mocked(obtenerChatActivo).mockResolvedValue(CHAT);
    let resultado: string | undefined;
    await act(async () => {
      resultado = await result.current.crear('DUDA', 'hola', null);
    });

    expect(resultado).toBe('existente');
    expect(result.current.chat?.id).toBe(5);
    expect(result.current.aviso).toMatch(/ya tenías una conversación abierta/i);
  });
});

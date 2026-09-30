import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from './imageHelper';
import { saveSession } from './session';
import {
  cerrarChatSoporte,
  crearChatSoporte,
  enviarImagenSoporte,
  enviarTextoSoporte,
  marcarChatLeido,
  obtenerChatActivo,
  obtenerMensajesSoporte,
  obtenerResumenSoporte,
  SoporteApiError,
} from './soporteCargaApi';

vi.mock('./imageCompression', () => ({
  comprimirImagen: vi.fn(async (blob: Blob, nombre: string) => ({ blob, filename: nombre })),
}));

const BASE = `${API_BASE_URL}/api/v1/proveedores/7/soporte-carga`;

type Llamada = [string, RequestInit | undefined];

function responder(...respuestas: Response[]) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  respuestas.forEach((r) => fetchMock.mockResolvedValueOnce(r));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

describe('soporteCargaApi', () => {
  beforeEach(() => {
    saveSession({ email: 'a@a.com', role: 'vendedor', token: 'tok', sellerId: '7' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('pide el resumen con el token del vendedor', async () => {
    const fetchMock = responder(json({ chatActivoId: 3, estado: 'ESPERANDO_VENDEDOR', noLeidos: 2 }));
    const resumen = await obtenerResumenSoporte();

    expect(resumen.noLeidos).toBe(2);
    const [url, init] = fetchMock.mock.calls[0] as Llamada;
    expect(url).toBe(`${BASE}/resumen`);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('obtenerChatActivo devuelve null con 204', async () => {
    responder(new Response(null, { status: 204 }));
    expect(await obtenerChatActivo()).toBeNull();
  });

  it('crea el chat con motivo, detalle y contexto', async () => {
    const fetchMock = responder(json({ id: 9 }, 201));
    await crearChatSoporte({ motivo: 'DUDA', detalle: '  hola  ', contexto: { flujo: 'mi-excel', paso: 2 } });

    const [url, init] = fetchMock.mock.calls[0] as Llamada;
    expect(url).toBe(`${BASE}/chats`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ motivo: 'DUDA', detalle: 'hola', contexto: { flujo: 'mi-excel', paso: 2 } });
  });

  it('un 409 al crear llega como SoporteApiError con status 409 y el mensaje del servidor', async () => {
    responder(json({ message: 'Ya tienes una conversación abierta' }, 409));
    const error = await crearChatSoporte({ motivo: 'OTRO', detalle: 'x', contexto: null }).catch((e) => e);
    expect(error).toBeInstanceOf(SoporteApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe('Ya tienes una conversación abierta');
  });

  it('pide solo los mensajes nuevos con despuesDe', async () => {
    const fetchMock = responder(json([]), json([]));
    await obtenerMensajesSoporte(5, 12);
    await obtenerMensajesSoporte(5);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/chats/5/mensajes?despuesDe=12`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/chats/5/mensajes`);
  });

  it('envia texto, marca leido (204) y cierra', async () => {
    const fetchMock = responder(
      json({ id: 1, autor: 'VENDEDOR', texto: 'hola' }, 201),
      new Response(null, { status: 204 }),
      json({ id: 5, estado: 'CERRADO_POR_VENDEDOR' }),
    );
    await enviarTextoSoporte(5, 'hola');
    await marcarChatLeido(5);
    const cerrado = await cerrarChatSoporte(5);

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/chats/5/mensajes`,
      `${BASE}/chats/5/leido`,
      `${BASE}/chats/5/cerrar`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ texto: 'hola' });
    expect(cerrado.estado).toBe('CERRADO_POR_VENDEDOR');
  });

  it('sube la imagen como multipart con texto opcional', async () => {
    const fetchMock = responder(json({ id: 2, autor: 'VENDEDOR' }, 201));
    const archivo = new File(['abc'], 'captura.png', { type: 'image/png' });
    await enviarImagenSoporte(5, archivo, 'mira esto');

    const [url, init] = fetchMock.mock.calls[0] as Llamada;
    expect(url).toBe(`${BASE}/chats/5/imagenes`);
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('imagen')).toBeInstanceOf(Blob);
    expect(form.get('texto')).toBe('mira esto');
    // El navegador pone el boundary del multipart: no se debe forzar Content-Type.
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
  });

  it('rechaza en el navegador una imagen de tipo no permitido o de mas de 5 MB', async () => {
    const fetchMock = responder();
    await expect(enviarImagenSoporte(5, new File(['x'], 'a.gif', { type: 'image/gif' }))).rejects.toBeInstanceOf(SoporteApiError);

    const grande = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.jpg', { type: 'image/jpeg' });
    await expect(enviarImagenSoporte(5, grande)).rejects.toThrow(/5 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

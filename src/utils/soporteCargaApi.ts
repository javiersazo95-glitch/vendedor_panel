import { apiFetch, SessionExpiredError } from './apiFetch';
import type { ContextoSoporte } from './contextoSoporte';
import { comprimirImagen } from './imageCompression';
import { API_BASE_URL } from './imageHelper';
import { getStoredSession } from './session';
import { encId } from './url';

// --- Tipos del contrato (seccion B + tipos compartidos del chat) ---

export type EstadoChat =
  | 'ESPERANDO_SOPORTE'
  | 'EN_ATENCION'
  | 'ESPERANDO_VENDEDOR'
  | 'CERRADO_POR_VENDEDOR'
  | 'CERRADO_POR_INACTIVIDAD';

export type MotivoChat = 'DUDA' | 'ERROR' | 'AYUDA_CARGA' | 'OTRO';

export type AutorMensaje = 'VENDEDOR' | 'SOPORTE' | 'SISTEMA';

export interface MensajeSoporte {
  id: number;
  autor: AutorMensaje;
  autorNombre: string | null;
  texto: string | null;
  /** Ruta relativa a la API ("/api/v1/uploads/r2/Soporte_carga/..."); se descarga con token. */
  imagenUrl: string | null;
  createdAt: string;
}

export interface ChatVendedor {
  id: number;
  motivo: MotivoChat;
  motivoDetalle: string;
  estado: EstadoChat;
  contexto: ContextoSoporte | null;
  ultimoMensajeAutor: AutorMensaje | null;
  ultimoMensajeAt: string | null;
  /** No leidos por el vendedor. */
  noLeidos: number;
  createdAt: string;
  cerradoAt: string | null;
  cierreAutomaticoAt: string | null;
}

export interface ResumenSoporte {
  chatActivoId: number | null;
  estado: EstadoChat | null;
  noLeidos: number;
}

export interface NuevoChatSoporte {
  motivo: MotivoChat;
  detalle: string;
  contexto: ContextoSoporte | null;
}

export const DETALLE_MAX = 1000;
export const TEXTO_MAX = 2000;
export const IMAGEN_MAX_BYTES = 5 * 1024 * 1024;
export const TIPOS_IMAGEN_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function esChatCerrado(estado: EstadoChat | null | undefined): boolean {
  return estado === 'CERRADO_POR_VENDEDOR' || estado === 'CERRADO_POR_INACTIVIDAD';
}

/** Error de la API de soporte con el status HTTP (0 = validacion local, antes de llamar). */
export class SoporteApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SoporteApiError';
    this.status = status;
  }
}

const MENSAJE_GENERICO = 'No pudimos comunicarnos con soporte. Revisa tu conexión e intenta de nuevo.';

async function leerMensajeError(response: Response, porDefecto: string): Promise<string> {
  try {
    const data = (await response.json()) as { message?: unknown };
    if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  } catch {
    // Cuerpo vacio o no JSON: se usa el texto por defecto.
  }
  return porDefecto;
}

function credenciales(): { base: string; token: string } {
  const session = getStoredSession();
  if (!session) throw new SessionExpiredError();
  return {
    base: `${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/soporte-carga`,
    token: session.token,
  };
}

async function pedir(ruta: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
  const { base, token } = credenciales();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await apiFetch(`${base}${ruta}`, { ...init, headers }, timeoutMs);
  if (!response.ok) {
    // Un 5xx trae texto tecnico que no le sirve al vendedor.
    const mensaje = response.status >= 500 ? MENSAJE_GENERICO : await leerMensajeError(response, MENSAJE_GENERICO);
    throw new SoporteApiError(mensaje, response.status);
  }
  return response;
}

async function pedirJson<T>(ruta: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const response = await pedir(ruta, init, timeoutMs);
  return (await response.json()) as T;
}

// --- Endpoints ---

/** GET /resumen: para el globo de no leidos. */
export function obtenerResumenSoporte(): Promise<ResumenSoporte> {
  return pedirJson<ResumenSoporte>('/resumen');
}

/** GET /activo: la conversacion abierta, o null si no hay (204). */
export async function obtenerChatActivo(): Promise<ChatVendedor | null> {
  const response = await pedir('/activo');
  if (response.status === 204) return null;
  const texto = await response.text();
  return texto ? (JSON.parse(texto) as ChatVendedor) : null;
}

/** GET /chats: ultimas 20 conversaciones, la mas reciente primero. */
export function listarChatsSoporte(): Promise<ChatVendedor[]> {
  return pedirJson<ChatVendedor[]>('/chats');
}

/** POST /chats. Lanza SoporteApiError con status 409 si ya hay una conversacion abierta. */
export function crearChatSoporte(datos: NuevoChatSoporte): Promise<ChatVendedor> {
  const detalle = datos.detalle.trim();
  if (!detalle || detalle.length > DETALLE_MAX) {
    return Promise.reject(new SoporteApiError(`Escribe tu consulta (máximo ${DETALLE_MAX} caracteres).`, 0));
  }
  return pedirJson<ChatVendedor>('/chats', {
    method: 'POST',
    body: JSON.stringify({ motivo: datos.motivo, detalle, contexto: datos.contexto ?? null }),
  });
}

/** GET /chats/{id}/mensajes?despuesDe=: mensajes en orden ascendente (max. 200 por llamada). */
export function obtenerMensajesSoporte(chatId: number, despuesDe?: number | null): Promise<MensajeSoporte[]> {
  const query = despuesDe && despuesDe > 0 ? `?despuesDe=${encId(despuesDe)}` : '';
  return pedirJson<MensajeSoporte[]>(`/chats/${encId(chatId)}/mensajes${query}`);
}

/** POST /chats/{id}/mensajes. 400 si la conversacion esta cerrada. */
export function enviarTextoSoporte(chatId: number, texto: string): Promise<MensajeSoporte> {
  const limpio = texto.trim();
  if (!limpio || limpio.length > TEXTO_MAX) {
    return Promise.reject(new SoporteApiError(`Escribe un mensaje (máximo ${TEXTO_MAX} caracteres).`, 0));
  }
  return pedirJson<MensajeSoporte>(`/chats/${encId(chatId)}/mensajes`, {
    method: 'POST',
    body: JSON.stringify({ texto: limpio }),
  });
}

export function esTipoImagenPermitido(tipo: string): boolean {
  return (TIPOS_IMAGEN_PERMITIDOS as readonly string[]).includes(tipo);
}

/**
 * POST /chats/{id}/imagenes (multipart `imagen` + `texto` opcional).
 * La foto se achica antes de subirla (una foto de celular pesa 3-8 MB) y se rechaza en el
 * navegador si aun asi supera los 5 MB, para no hacer esperar una subida que el servidor rechazara.
 */
export async function enviarImagenSoporte(chatId: number, archivo: File, texto?: string): Promise<MensajeSoporte> {
  if (!esTipoImagenPermitido(archivo.type)) {
    throw new SoporteApiError('Solo puedes adjuntar fotos JPG, PNG o WEBP.', 0);
  }
  const leyenda = texto?.trim() ?? '';
  if (leyenda.length > TEXTO_MAX) {
    throw new SoporteApiError(`El mensaje puede tener máximo ${TEXTO_MAX} caracteres.`, 0);
  }

  const { blob, filename } = await comprimirImagen(archivo, archivo.name || 'foto.jpg');
  if (blob.size > IMAGEN_MAX_BYTES) {
    throw new SoporteApiError('La imagen pesa más de 5 MB. Prueba con una captura o una foto más liviana.', 0);
  }

  const form = new FormData();
  form.append('imagen', blob, filename);
  if (leyenda) form.append('texto', leyenda);
  return pedirJson<MensajeSoporte>(`/chats/${encId(chatId)}/imagenes`, { method: 'POST', body: form }, 60000);
}

/** POST /chats/{id}/leido (204). */
export async function marcarChatLeido(chatId: number): Promise<void> {
  await pedir(`/chats/${encId(chatId)}/leido`, { method: 'POST' });
}

/** POST /chats/{id}/cerrar: devuelve el chat ya cerrado (CERRADO_POR_VENDEDOR). */
export function cerrarChatSoporte(chatId: number): Promise<ChatVendedor> {
  return pedirJson<ChatVendedor>(`/chats/${encId(chatId)}/cerrar`, { method: 'POST' });
}

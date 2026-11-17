import { apiFetch } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import type { EstadoAcceso, InvitadoSesion, NivelInvitado } from './modoInvitado';

/** Respuesta del backend (AccesoAsistidoDTOs.Acceso); solo lo que el panel usa. */
export interface AccesoDTO {
  id: number;
  proveedorId: number;
  tiendaNombre: string;
  estado: EstadoAcceso;
  nivelSolicitado: NivelInvitado;
  nivel: NivelInvitado | null;
  duracionHoras: number | null;
  justificacion: string | null;
  operadorNombre: string | null;
  solicitudExpiraEn: string;
  iniciaEn: string | null;
  expiraEn: string | null;
  comentarioRechazo: string | null;
  serverTime: string;
}

export interface CanjeDTO {
  token: string;
  acceso: AccesoDTO;
}

const BASE = `${API_BASE_URL}/api/v1/acceso-asistido`;

async function leerError(response: Response): Promise<string> {
  try {
    const cuerpo = (await response.json()) as { message?: string };
    return cuerpo.message || 'No se pudo completar la acción.';
  } catch {
    return 'No se pudo completar la acción.';
  }
}

/** Convierte lo que informa el backend en lo que el panel recuerda en su sesion. */
export function aInvitadoSesion(acceso: AccesoDTO, recibidoEn = Date.now()): InvitadoSesion {
  return {
    accesoId: acceso.id,
    tienda: acceso.tiendaNombre,
    estado: acceso.estado,
    nivel: acceso.nivel,
    nivelSolicitado: acceso.nivelSolicitado,
    expiraEn: acceso.expiraEn,
    solicitudExpiraEn: acceso.solicitudExpiraEn,
    offsetMs: Date.parse(acceso.serverTime) - recibidoEn,
  };
}

/**
 * Cambia el ticket de un solo uso (60 s) que trae el enlace desde el backoffice por la sesion de invitado.
 * Va sin sesion previa: el ticket es la credencial.
 */
export async function canjearTicket(ticket: string): Promise<CanjeDTO> {
  const response = await apiFetch(`${BASE}/canje`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
    publico: true,
  });
  if (!response.ok) throw new Error(await leerError(response));
  return (await response.json()) as CanjeDTO;
}

function conToken(token: string, extra?: RequestInit): RequestInit {
  return { ...extra, headers: { Authorization: `Bearer ${token}`, ...(extra?.headers ?? {}) } };
}

export async function estadoDelAcceso(token: string): Promise<AccesoDTO> {
  const response = await apiFetch(`${BASE}/invitado/estado`, conToken(token));
  if (!response.ok) throw new Error(await leerError(response));
  return (await response.json()) as AccesoDTO;
}

export async function reenviarCorreo(token: string): Promise<AccesoDTO> {
  const response = await apiFetch(`${BASE}/invitado/reenviar`, conToken(token, { method: 'POST' }));
  if (!response.ok) throw new Error(await leerError(response));
  return (await response.json()) as AccesoDTO;
}

export async function cancelarSolicitud(token: string): Promise<AccesoDTO> {
  const response = await apiFetch(`${BASE}/invitado/cancelar`, conToken(token, { method: 'POST' }));
  if (!response.ok) throw new Error(await leerError(response));
  return (await response.json()) as AccesoDTO;
}

/** Termina la sesion de invitado: el servidor revoca el token y, si el acceso estaba activo, lo da por terminado. */
export async function salirDelAcceso(token: string): Promise<void> {
  await apiFetch(`${BASE}/invitado/salir`, conToken(token, { method: 'POST' }), 10000);
}

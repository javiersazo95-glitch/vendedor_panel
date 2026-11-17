import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Acceso asistido (17-nov): soporte entra al panel de un vendedor como INVITADO, con su permiso y por un
 * tiempo acotado, solo para CREAR repuestos. Aqui vive lo comun del modo invitado: los tipos, el contexto que
 * las pantallas leen para ocultar lo que soporte no puede hacer, y el contador con el reloj del servidor.
 *
 * Ocultar un boton NO es el control: el backend rechaza cualquier edicion, eliminacion o ruta fuera de su lista
 * blanca. Esto solo evita mostrar acciones que igual fallarian.
 */

export type NivelInvitado = 'BASICO' | 'MEDIO' | 'COMPLETO';

export type EstadoAcceso =
  | 'PENDIENTE_VENDEDOR'
  | 'PENDIENTE_SOPORTE'
  | 'ACTIVO'
  | 'RECHAZADO'
  | 'REVOCADO'
  | 'EXPIRADO'
  | 'CANCELADO'
  | 'FINALIZADO';

/** Lo que el panel recuerda del acceso asistido dentro de su sesion (sessionStorage, por pestana). */
export interface InvitadoSesion {
  accesoId: number;
  tienda: string;
  estado: EstadoAcceso;
  nivel: NivelInvitado | null;
  nivelSolicitado: NivelInvitado;
  /** Fin del acceso concedido (ISO-8601); null mientras la solicitud espera. */
  expiraEn: string | null;
  /** Hasta cuando la solicitud puede esperar la respuesta del vendedor (ISO-8601). */
  solicitudExpiraEn: string;
  /** Diferencia (servidor - navegador) en ms, para que el contador no dependa del reloj del equipo. */
  offsetMs: number;
}

const ORDEN: NivelInvitado[] = ['BASICO', 'MEDIO', 'COMPLETO'];

export type OperacionInvitado = 'CREAR' | 'PRECIOS' | 'EXCEL';

const NIVEL_MINIMO: Record<OperacionInvitado, NivelInvitado> = {
  CREAR: 'BASICO',
  PRECIOS: 'MEDIO',
  EXCEL: 'COMPLETO',
};

export function nivelPermite(nivel: NivelInvitado | null | undefined, operacion: OperacionInvitado): boolean {
  if (!nivel) return false;
  return ORDEN.indexOf(nivel) >= ORDEN.indexOf(NIVEL_MINIMO[operacion]);
}

export const TITULO_NIVEL: Record<NivelInvitado, string> = {
  BASICO: 'Carga uno a uno',
  MEDIO: 'Carga uno a uno y precios',
  COMPLETO: 'Carga completa con Excel',
};

export interface ModoInvitadoValor {
  activo: boolean;
  nivel: NivelInvitado | null;
  tienda: string;
  puede: (operacion: OperacionInvitado) => boolean;
}

export const SIN_INVITADO: ModoInvitadoValor = { activo: false, nivel: null, tienda: '', puede: () => true };

export const ModoInvitadoContext = createContext<ModoInvitadoValor>(SIN_INVITADO);

/** Fuera del modo invitado (el vendedor en su panel) `activo` es false y `puede` siempre responde true. */
export function useModoInvitado(): ModoInvitadoValor {
  return useContext(ModoInvitadoContext);
}

// ---- Contador ----

export interface Restante {
  /** Milisegundos que faltan (0 si ya paso). */
  ms: number;
  vencido: boolean;
  /** "hh:mm:ss"; con dias, "2d 03:04:05". */
  texto: string;
  /** Fraccion transcurrida entre inicio y fin (0..1), para barras de progreso. */
  progreso: number;
}

const dos = (n: number) => String(n).padStart(2, '0');

export function calcularRestante(finIso: string | null, offsetMs: number, ahora = Date.now(), inicioIso?: string | null): Restante {
  const fin = finIso ? Date.parse(finIso) : NaN;
  if (Number.isNaN(fin)) return { ms: 0, vencido: true, texto: '00:00:00', progreso: 1 };
  const ms = Math.max(0, fin - (ahora + offsetMs));
  const total = Math.floor(ms / 1000);
  const dias = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = `${dos(h)}:${dos(m)}:${dos(s)}`;
  const inicio = inicioIso ? Date.parse(inicioIso) : NaN;
  const duracion = Number.isNaN(inicio) ? 0 : fin - inicio;
  const progreso = duracion > 0 ? Math.min(1, Math.max(0, 1 - ms / duracion)) : 0;
  return { ms, vencido: ms === 0, texto: dias > 0 ? `${dias}d ${hms}` : hms, progreso };
}

/** Contador que se actualiza cada segundo con el reloj del servidor. */
export function useRestante(finIso: string | null, offsetMs: number, inicioIso?: string | null): Restante {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return calcularRestante(finIso, offsetMs, ahora, inicioIso);
}

/** Menos de 1 h: rojo; menos de 6 h: ambar; si no, normal. */
export function tonoRestante(ms: number): 'normal' | 'ambar' | 'rojo' {
  if (ms < 60 * 60 * 1000) return 'rojo';
  if (ms < 6 * 60 * 60 * 1000) return 'ambar';
  return 'normal';
}

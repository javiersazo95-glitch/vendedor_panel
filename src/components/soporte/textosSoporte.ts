import type { EstadoChat, MotivoChat } from '../../utils/soporteCargaApi';

export const MOTIVOS: { valor: MotivoChat; texto: string }[] = [
  { valor: 'DUDA', texto: 'Tengo una duda' },
  { valor: 'ERROR', texto: 'Algo no funciona' },
  { valor: 'AYUDA_CARGA', texto: 'Ayuda para cargar mi inventario' },
  { valor: 'OTRO', texto: 'Otro' },
];

export function textoMotivo(motivo: MotivoChat): string {
  return MOTIVOS.find((m) => m.valor === motivo)?.texto ?? 'Otro';
}

export function textoEstado(estado: EstadoChat): string {
  switch (estado) {
    case 'ESPERANDO_SOPORTE':
      return 'Esperando respuesta de soporte';
    case 'EN_ATENCION':
      return 'Soporte está revisando tu caso';
    case 'ESPERANDO_VENDEDOR':
      return 'Soporte te respondió';
    case 'CERRADO_POR_VENDEDOR':
    case 'CERRADO_POR_INACTIVIDAD':
      return 'Conversación cerrada';
  }
}

/** Por que se cerro, en palabras simples. Vacio si sigue abierta. */
export function textoMotivoCierre(estado: EstadoChat): string {
  if (estado === 'CERRADO_POR_VENDEDOR') return 'La cerraste tú.';
  if (estado === 'CERRADO_POR_INACTIVIDAD') return 'Se cerró sola porque no hubo respuesta en 24 horas.';
  return '';
}

const formatoHora = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' });
const formatoFechaHora = new Intl.DateTimeFormat('es-CL', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Hora del mensaje: solo "14:05" si es de hoy, "29 sept, 14:05" si no. */
export function formatearMomento(iso: string, ahora: Date = new Date()): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const mismoDia =
    fecha.getFullYear() === ahora.getFullYear() &&
    fecha.getMonth() === ahora.getMonth() &&
    fecha.getDate() === ahora.getDate();
  return mismoDia ? formatoHora.format(fecha) : formatoFechaHora.format(fecha);
}

/** Fecha y hora completas, para el aviso de cierre automatico: "1 oct, 14:05". */
export function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  return formatoFechaHora.format(fecha);
}

const ERRORES_CON_TEXTO_PARA_EL_VENDEDOR = new Set(['SoporteApiError', 'SessionExpiredError', 'RequestTimeoutError']);

/**
 * Texto de error para mostrar. Solo se usan los mensajes pensados para el vendedor (los de la
 * API y los de sesion/tiempo de espera); un "Failed to fetch" del navegador no le dice nada.
 */
export function mensajeDeError(err: unknown, porDefecto: string): string {
  if (err instanceof Error && err.message && ERRORES_CON_TEXTO_PARA_EL_VENDEDOR.has(err.name)) return err.message;
  return porDefecto;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextoSoporte } from './contextoSoporte';
import { getStoredSession } from './session';
import {
  cerrarChatSoporte,
  crearChatSoporte,
  enviarImagenSoporte,
  enviarTextoSoporte,
  esChatCerrado,
  listarChatsSoporte,
  marcarChatLeido,
  obtenerChatActivo,
  obtenerMensajesSoporte,
  obtenerResumenSoporte,
  SoporteApiError,
  type ChatVendedor,
  type MensajeSoporte,
  type MotivoChat,
  type ResumenSoporte,
} from './soporteCargaApi';

export const INTERVALO_RESUMEN_MS = 30_000;
export const INTERVALO_MENSAJES_MS = 5_000;
export const INTERVALO_ACTIVO_MS = 15_000;
export const ESPERA_MAXIMA_MS = 60_000;

function haySesion(): boolean {
  return Boolean(getStoredSession()?.sellerId);
}

function paginaOculta(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

/**
 * Repite `tarea` cada `intervaloMs` mientras `activo` sea true y la pestana este visible.
 * - Arranca de inmediato al activarse (y al volver a la pestana).
 * - Si la tarea falla, espera el doble cada vez (hasta 60 s) antes de reintentar.
 * - Cambiar `clave` reinicia el ciclo (por ejemplo, al cambiar de conversacion).
 */
function useSondeo(tarea: () => Promise<void>, intervaloMs: number, activo: boolean, clave?: unknown) {
  const tareaRef = useRef(tarea);
  useEffect(() => {
    tareaRef.current = tarea;
  });

  useEffect(() => {
    if (!activo) return;
    let cancelado = false;
    let corriendo = false;
    let fallos = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const limpiarTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const programar = (ms: number) => {
      limpiarTimer();
      timer = setTimeout(() => void ejecutar(), ms);
    };
    const ejecutar = async () => {
      timer = null;
      if (cancelado || corriendo || paginaOculta()) return;
      corriendo = true;
      try {
        await tareaRef.current();
        fallos = 0;
      } catch {
        fallos += 1;
      } finally {
        corriendo = false;
      }
      if (cancelado || paginaOculta()) return;
      programar(fallos === 0 ? intervaloMs : Math.min(intervaloMs * 2 ** fallos, ESPERA_MAXIMA_MS));
    };
    const alCambiarVisibilidad = () => {
      if (paginaOculta()) limpiarTimer();
      else if (!corriendo) programar(0);
    };

    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    programar(0);
    return () => {
      cancelado = true;
      limpiarTimer();
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [activo, intervaloMs, clave]);
}

export type ResultadoCrear = 'creado' | 'existente';

export interface ChatSoporte {
  /** Ultimo resumen (globo de no leidos). */
  resumen: ResumenSoporte | null;
  /** Conversacion en pantalla: la abierta, o una cerrada que el vendedor pidio ver. */
  chat: ChatVendedor | null;
  mensajes: MensajeSoporte[];
  /** true cuando ya se sabe si hay conversacion abierta (primera carga con el panel abierto). */
  chatCargado: boolean;
  /** Ultima conversacion cerrada, para ofrecer verla cuando no hay una abierta. */
  ultimoChatCerrado: ChatVendedor | null;
  /** El ultimo intento de actualizar fallo (se sigue reintentando solo). */
  sinConexion: boolean;
  /** Aviso para el vendedor (ej. ya tenia una conversacion abierta). */
  aviso: string | null;
  descartarAviso: () => void;
  crear: (motivo: MotivoChat, detalle: string, contexto: ContextoSoporte | null) => Promise<ResultadoCrear>;
  enviarTexto: (texto: string) => Promise<void>;
  enviarImagen: (archivo: File, texto?: string) => Promise<void>;
  cerrar: () => Promise<void>;
  marcarLeido: () => Promise<void>;
  /** Muestra una conversacion (por ejemplo la ultima cerrada) en modo lectura. */
  verChat: (chat: ChatVendedor) => Promise<void>;
  /** Deja el panel listo para abrir una conversacion nueva. */
  nuevaConversacion: () => void;
}

function combinar(previos: MensajeSoporte[], nuevos: MensajeSoporte[]): MensajeSoporte[] {
  if (nuevos.length === 0) return previos;
  const porId = new Map(previos.map((m) => [m.id, m]));
  nuevos.forEach((m) => porId.set(m.id, m));
  return [...porId.values()].sort((a, b) => a.id - b.id);
}

/**
 * Estado y acciones del chat de soporte de carga, con polling (no hay websockets):
 * - Panel cerrado: pide el resumen cada 30 s (globo de no leidos).
 * - Panel abierto: revisa la conversacion abierta cada 15 s y, si hay una, trae mensajes nuevos
 *   cada 5 s (`despuesDe` = ultimo id recibido).
 * - Todo se pausa con la pestana oculta y espera cada vez mas (hasta 60 s) si hay errores.
 * - Sin sesion no hace nada.
 */
export function useChatSoporte({ abierto }: { abierto: boolean }): ChatSoporte {
  const [resumen, setResumen] = useState<ResumenSoporte | null>(null);
  const [chat, setChat] = useState<ChatVendedor | null>(null);
  const [mensajes, setMensajes] = useState<MensajeSoporte[]>([]);
  const [chatCargado, setChatCargado] = useState(false);
  const [ultimoChatCerrado, setUltimoChatCerrado] = useState<ChatVendedor | null>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const chatRef = useRef<ChatVendedor | null>(null);
  /** Ultimo id recibido POR POLLING (no por enviar), para no saltarse mensajes intermedios. */
  const ultimoIdRef = useRef(0);
  const historialBuscadoRef = useRef(false);

  const fijarChat = useCallback((c: ChatVendedor | null) => {
    chatRef.current = c;
    setChat(c);
  }, []);

  const cambiarAChat = useCallback(
    (c: ChatVendedor | null) => {
      if (chatRef.current?.id !== c?.id) {
        ultimoIdRef.current = 0;
        setMensajes([]);
      }
      fijarChat(c);
    },
    [fijarChat],
  );

  const agregarMensajes = useCallback((chatId: number, nuevos: MensajeSoporte[], desdePolling: boolean) => {
    if (chatRef.current?.id !== chatId || nuevos.length === 0) return;
    if (desdePolling) {
      ultimoIdRef.current = Math.max(ultimoIdRef.current, ...nuevos.map((m) => m.id));
    }
    setMensajes((prev) => combinar(prev, nuevos));
  }, []);

  /** Trae los mensajes posteriores al ultimo recibido. Devuelve los nuevos. */
  const traerMensajes = useCallback(
    async (chatId: number): Promise<MensajeSoporte[]> => {
      const nuevos = await obtenerMensajesSoporte(chatId, ultimoIdRef.current || null);
      agregarMensajes(chatId, nuevos, true);
      return nuevos;
    },
    [agregarMensajes],
  );

  const refrescarActivo = useCallback(async () => {
    const activo = await obtenerChatActivo();
    const actual = chatRef.current;
    if (activo) {
      cambiarAChat(activo);
    } else if (actual && !esChatCerrado(actual.estado)) {
      // Se cerro mientras la mirabamos (por inactividad o desde otra pestana): mostrar como quedo.
      const lista = await listarChatsSoporte();
      const mismo = lista.find((c) => c.id === actual.id) ?? null;
      cambiarAChat(mismo);
      if (mismo) await traerMensajes(mismo.id);
    } else if (!actual && !historialBuscadoRef.current) {
      historialBuscadoRef.current = true;
      try {
        const lista = await listarChatsSoporte();
        setUltimoChatCerrado(lista.find((c) => esChatCerrado(c.estado)) ?? null);
      } catch {
        historialBuscadoRef.current = false;
      }
    }
    setChatCargado(true);
  }, [cambiarAChat, traerMensajes]);

  const conEstadoDeConexion = useCallback(async (tarea: () => Promise<void>) => {
    if (!haySesion()) return;
    try {
      await tarea();
      setSinConexion(false);
    } catch (err) {
      // H34: un 429 es el servidor pidiendo calma (el tope de peticiones se comparte con la
      // carga de fotos), no un corte: "sin conexión" asustaba sin razón. El sondeo igual espera
      // cada vez más.
      if (!(err instanceof SoporteApiError && err.status === 429)) setSinConexion(true);
      throw err;
    }
  }, []);

  // 1) Panel cerrado: resumen cada 30 s.
  useSondeo(
    async () => {
      if (!haySesion()) return;
      const r = await obtenerResumenSoporte();
      setResumen(r);
    },
    INTERVALO_RESUMEN_MS,
    !abierto,
  );

  // 2) Panel abierto: estado de la conversacion cada 15 s.
  useSondeo(() => conEstadoDeConexion(refrescarActivo), INTERVALO_ACTIVO_MS, abierto);

  // 3) Panel abierto y conversacion abierta: mensajes nuevos cada 5 s.
  const chatAbiertoId = chat && !esChatCerrado(chat.estado) ? chat.id : null;
  useSondeo(
    () =>
      conEstadoDeConexion(async () => {
        const id = chatRef.current?.id;
        if (!id || esChatCerrado(chatRef.current?.estado)) return;
        const esPrimeraCarga = ultimoIdRef.current === 0;
        const nuevos = await traerMensajes(id);
        // Soporte respondio: el estado y el aviso de cierre automatico cambiaron.
        if (!esPrimeraCarga && nuevos.some((m) => m.autor !== 'VENDEDOR')) {
          await refrescarActivo();
        }
      }),
    INTERVALO_MENSAJES_MS,
    abierto && chatAbiertoId !== null,
    chatAbiertoId,
  );

  const crear = useCallback(
    async (motivo: MotivoChat, detalle: string, contexto: ContextoSoporte | null): Promise<ResultadoCrear> => {
      try {
        const nuevo = await crearChatSoporte({ motivo, detalle, contexto });
        cambiarAChat(nuevo);
        setChatCargado(true);
        setResumen((r) => ({ chatActivoId: nuevo.id, estado: nuevo.estado, noLeidos: r?.noLeidos ?? 0 }));
        return 'creado';
      } catch (err) {
        if (err instanceof SoporteApiError && err.status === 409) {
          const existente = await obtenerChatActivo();
          if (existente) {
            cambiarAChat(existente);
            setChatCargado(true);
            setAviso('Ya tenías una conversación abierta con soporte. Puedes seguir escribiendo aquí.');
            return 'existente';
          }
        }
        throw err;
      }
    },
    [cambiarAChat],
  );

  /** Tras un rechazo por conversacion cerrada (400), actualiza el estado para que la vista lo refleje. */
  const revisarSiSeCerro = useCallback(
    async (err: unknown) => {
      if (err instanceof SoporteApiError && err.status === 400) {
        try {
          await refrescarActivo();
        } catch {
          // Se reintentara con el polling.
        }
      }
    },
    [refrescarActivo],
  );

  const alEnviar = useCallback(
    (chatId: number, mensaje: MensajeSoporte) => {
      agregarMensajes(chatId, [mensaje], false);
      const actual = chatRef.current;
      if (actual && actual.id === chatId) {
        fijarChat({
          ...actual,
          estado: actual.estado === 'EN_ATENCION' ? 'EN_ATENCION' : 'ESPERANDO_SOPORTE',
          ultimoMensajeAutor: 'VENDEDOR',
          ultimoMensajeAt: mensaje.createdAt,
          cierreAutomaticoAt: null,
        });
      }
    },
    [agregarMensajes, fijarChat],
  );

  const enviarTexto = useCallback(
    async (texto: string) => {
      const actual = chatRef.current;
      if (!actual) return;
      try {
        const mensaje = await enviarTextoSoporte(actual.id, texto);
        alEnviar(actual.id, mensaje);
      } catch (err) {
        await revisarSiSeCerro(err);
        throw err;
      }
    },
    [alEnviar, revisarSiSeCerro],
  );

  const enviarImagen = useCallback(
    async (archivo: File, texto?: string) => {
      const actual = chatRef.current;
      if (!actual) return;
      try {
        const mensaje = await enviarImagenSoporte(actual.id, archivo, texto);
        alEnviar(actual.id, mensaje);
      } catch (err) {
        await revisarSiSeCerro(err);
        throw err;
      }
    },
    [alEnviar, revisarSiSeCerro],
  );

  const cerrar = useCallback(async () => {
    const actual = chatRef.current;
    if (!actual) return;
    const cerrado = await cerrarChatSoporte(actual.id);
    fijarChat(cerrado);
    setUltimoChatCerrado(cerrado);
    setResumen({ chatActivoId: null, estado: null, noLeidos: 0 });
    try {
      await traerMensajes(cerrado.id);
    } catch {
      // El mensaje de sistema de cierre es informativo; si no llega ahora no pasa nada.
    }
  }, [fijarChat, traerMensajes]);

  const marcarLeido = useCallback(async () => {
    const actual = chatRef.current;
    if (!actual) return;
    try {
      await marcarChatLeido(actual.id);
    } catch {
      return;
    }
    if (chatRef.current?.id === actual.id && chatRef.current.noLeidos !== 0) {
      fijarChat({ ...chatRef.current, noLeidos: 0 });
    }
    setResumen((r) => (r && r.noLeidos !== 0 ? { ...r, noLeidos: 0 } : r));
  }, [fijarChat]);

  const verChat = useCallback(
    async (c: ChatVendedor) => {
      cambiarAChat(c);
      await traerMensajes(c.id);
    },
    [cambiarAChat, traerMensajes],
  );

  const nuevaConversacion = useCallback(() => {
    cambiarAChat(null);
    setAviso(null);
  }, [cambiarAChat]);

  const descartarAviso = useCallback(() => setAviso(null), []);

  return {
    resumen,
    chat,
    mensajes,
    chatCargado,
    ultimoChatCerrado,
    sinConexion,
    aviso,
    descartarAviso,
    crear,
    enviarTexto,
    enviarImagen,
    cerrar,
    marcarLeido,
    verChat,
    nuevaConversacion,
  };
}

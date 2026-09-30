/**
 * Guarda el progreso del asistente de carga con Excel en el servidor: a pedido ("Guardar
 * progreso") y solo, unos segundos después del último cambio. Va al borrador del tipo de carga
 * del estado (`estado.tipo`): su propio Excel y la plantilla de RepuesTop se guardan por separado.
 *
 * Cada guardado hace, en orden:
 *  1. el estado del asistente (JSON), con la versión esperada para no pisar lo que guardó otra
 *     pestaña (el servidor responde 409 y se le pregunta al vendedor qué hacer);
 *  2. el Excel, la primera vez o si cambió;
 *  3. las fotos asignadas que el servidor todavía no tiene, y borra las que ya no se usan.
 *
 * Los guardados nunca corren dos a la vez: si llega un cambio durante uno, se guarda de nuevo al
 * terminar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SessionExpiredError } from './apiFetch';
import {
  ConflictoBorradorError,
  FotoBorradorRechazadaError,
  archivoParaBorrador,
  fotosAsignadas,
  guardarBorrador,
  serializarBorrador,
  sincronizarImagenesBorrador,
  subirArchivoBorrador,
  subirImagenBorrador,
  eliminarBorrador,
  type BorradorCarga,
  type EstadoBorrador,
} from './miExcelBorrador';
import { comprimirImagen } from './imageCompression';

export type EstadoGuardado = 'sin-cambios' | 'sin-guardar' | 'guardando' | 'guardado' | 'error' | 'conflicto';

export interface ArchivoDelBorrador {
  file: File;
  sha256: string;
  aoa: unknown[][];
  nombreHoja: string;
}

interface Opciones {
  /** Recién con un archivo elegido hay algo que valga la pena guardar. */
  habilitado: boolean;
  estado: EstadoBorrador;
  archivo: ArchivoDelBorrador | null;
  /** Fotos en memoria (carpeta o ZIP), por nombre. */
  imagenes: Record<string, Blob>;
  /** Milisegundos de calma antes del guardado automático. */
  esperaAutoguardado?: number;
}

const FOTOS_EN_PARALELO = 3;
/**
 * Un guardado que falló por algo pasajero (un corte, un 5xx, un 429 que no cedió, fotos que
 * quedaron pendientes) se vuelve a intentar solo después de esto: la pantalla dice "Seguimos
 * intentando" y el guardado automático sólo corre cuando algo cambia.
 */
const REINTENTO_MS = 30000;

export function useBorradorCarga({ habilitado, estado, archivo, imagenes, esperaAutoguardado = 4000 }: Opciones) {
  const [estadoGuardado, setEstadoGuardado] = useState<EstadoGuardado>('sin-cambios');
  const [ultimoGuardado, setUltimoGuardado] = useState<string | null>(null);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<{ version: number; updatedAt: string | null } | null>(null);
  const [progresoFotos, setProgresoFotos] = useState<{ hechas: number; total: number } | null>(null);
  /** Fotos que ya están en el servidor: nombre -> id. */
  const [guardadas, setGuardadas] = useState<Record<string, number>>({});
  /** El JSON de lo último que quedó en el servidor (estado, para poder compararlo al dibujar). */
  const [jsonGuardado, setJsonGuardadoEstado] = useState<string | null>(null);

  const versionRef = useRef<number | null>(null);
  const jsonGuardadoRef = useRef<string | null>(null);
  const shaArchivoRef = useRef<string | null>(null);
  const guardadasRef = useRef<Record<string, number>>({});
  /** Fotos que el servidor ya rechazó: no se reintentan en cada guardado automático. */
  const rechazadasRef = useRef<Set<string>>(new Set());
  const enCursoRef = useRef<Promise<boolean> | null>(null);
  /** Sube en 1 cada vez que un guardado queda a medias por algo pasajero: programa el reintento. */
  const [reintentos, setReintentos] = useState(0);
  const pendienteRef = useRef(false);
  const actualRef = useRef({ estado, archivo, imagenes, habilitado });
  useEffect(() => {
    actualRef.current = { estado, archivo, imagenes, habilitado };
  });

  const setJsonGuardado = useCallback((valor: string | null) => {
    jsonGuardadoRef.current = valor;
    setJsonGuardadoEstado(valor);
  }, []);

  const json = serializarBorrador(estado);
  const hayCambios = habilitado && json !== jsonGuardado;

  /** Retoma un borrador: lo que ya está en el servidor cuenta como guardado. */
  const adoptar = useCallback((borrador: BorradorCarga, estadoLeido: EstadoBorrador) => {
    versionRef.current = borrador.version;
    setJsonGuardado(serializarBorrador(estadoLeido));
    shaArchivoRef.current = borrador.tieneArchivo ? borrador.archivoSha256 : null;
    const mapa = Object.fromEntries(borrador.imagenes.map((i) => [i.nombreArchivo, i.id]));
    guardadasRef.current = mapa;
    setGuardadas(mapa);
    setUltimoGuardado(borrador.updatedAt);
    setEstadoGuardado('guardado');
  }, [setJsonGuardado]);

  /** Da por guardado el estado actual sin mandarlo (p. ej. justo después de adoptar). */
  const marcarComoGuardado = useCallback((estadoActual: EstadoBorrador) => {
    setJsonGuardado(serializarBorrador(estadoActual));
  }, [setJsonGuardado]);

  /** Devuelve cuántas fotos quedaron sin guardar por un problema pasajero (se reintentan). */
  const sincronizarFotos = async (asignadas: string[], enMemoria: Record<string, Blob>): Promise<number> => {
    let pendientes = 0;
    const faltan = asignadas.filter((n) => guardadasRef.current[n] === undefined && enMemoria[n] && !rechazadasRef.current.has(n));
    if (faltan.length > 0) {
      let hechas = 0;
      setProgresoFotos({ hechas, total: faltan.length });
      for (let i = 0; i < faltan.length; i += FOTOS_EN_PARALELO) {
        await Promise.all(faltan.slice(i, i + FOTOS_EN_PARALELO).map(async (nombre) => {
          try {
            const { blob } = await comprimirImagen(enMemoria[nombre], nombre);
            const guardada = await subirImagenBorrador(actualRef.current.estado.tipo, blob, nombre);
            guardadasRef.current = { ...guardadasRef.current, [nombre]: guardada.id };
          } catch (err) {
            if (err instanceof SessionExpiredError) throw err;
            if (err instanceof FotoBorradorRechazadaError) {
              // Una foto que el servidor no acepta (un GIF, una demasiado pesada) no puede impedir
              // guardar el resto del progreso: sigue en memoria y se sube igual al publicar.
              rechazadasRef.current.add(nombre);
            } else {
              // H33: un 429 que no cedió, un 5xx o un corte. Antes quedaba como rechazada para
              // toda la sesión y el borrador se quedaba sin esa foto; ahora se vuelve a intentar.
              pendientes += 1;
            }
          } finally {
            hechas += 1;
            setProgresoFotos({ hechas, total: faltan.length });
          }
        }));
      }
      setProgresoFotos(null);
    }
    const sobran = Object.keys(guardadasRef.current).filter((n) => !asignadas.includes(n));
    if (sobran.length > 0) {
      await sincronizarImagenesBorrador(actualRef.current.estado.tipo, asignadas);
      const quedan = { ...guardadasRef.current };
      for (const n of sobran) delete quedan[n];
      guardadasRef.current = quedan;
    }
    setGuardadas(guardadasRef.current);
    return pendientes;
  };

  const guardarUnaVez = async (): Promise<boolean> => {
    const { estado: e, archivo: a, imagenes: imgs, habilitado: h } = actualRef.current;
    if (!h) return true;
    const jsonAhora = serializarBorrador(e);
    setEstadoGuardado('guardando');
    setErrorGuardado(null);
    try {
      const { version, updatedAt } = await guardarBorrador(e, versionRef.current);
      versionRef.current = version;
      setJsonGuardado(jsonAhora);
      if (a && shaArchivoRef.current !== a.sha256) {
        const paraSubir = await archivoParaBorrador(a.file, a.aoa, a.nombreHoja);
        if (paraSubir) {
          await subirArchivoBorrador(e.tipo, paraSubir.archivo, a.sha256, paraSubir.recortado);
          shaArchivoRef.current = a.sha256;
        }
      }
      const pendientes = await sincronizarFotos(fotosAsignadas(e.fotos.asignaciones), imgs);
      setUltimoGuardado(updatedAt);
      if (pendientes > 0) {
        setReintentos((n) => n + 1);
        setErrorGuardado(`${pendientes === 1 ? 'falta 1 foto' : `faltan ${pendientes} fotos`}`);
        setEstadoGuardado('error');
        return true;
      }
      setEstadoGuardado(serializarBorrador(actualRef.current.estado) === jsonAhora ? 'guardado' : 'sin-guardar');
      return true;
    } catch (err) {
      setProgresoFotos(null);
      if (err instanceof ConflictoBorradorError) {
        setConflicto({ version: err.version, updatedAt: err.updatedAt });
        setEstadoGuardado('conflicto');
      } else {
        setErrorGuardado(err instanceof Error ? err.message : 'No se pudo guardar tu progreso.');
        setEstadoGuardado('error');
        // Con la sesión vencida no hay nada que reintentar: el panel ya pide volver a entrar.
        if (!(err instanceof SessionExpiredError)) setReintentos((n) => n + 1);
      }
      return false;
    }
  };

  const guardar = useCallback(async (): Promise<boolean> => {
    if (enCursoRef.current) {
      pendienteRef.current = true;
      return enCursoRef.current;
    }
    const correr = async (): Promise<boolean> => {
      let ok = await guardarUnaVez();
      while (ok && pendienteRef.current) {
        pendienteRef.current = false;
        ok = await guardarUnaVez();
      }
      return ok;
    };
    enCursoRef.current = correr().finally(() => { enCursoRef.current = null; });
    return enCursoRef.current;
    // guardarUnaVez lee todo por referencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El guardado automático sólo corre cuando algo cambia: sin esto, un guardado que falló por un
  // 429 o un corte (o que dejó fotos pendientes) esperaría a que el vendedor tocara otra cosa.
  useEffect(() => {
    if (reintentos === 0) return undefined;
    const t = setTimeout(() => { void guardar(); }, REINTENTO_MS);
    return () => clearTimeout(t);
  }, [reintentos, guardar]);

  /**
   * Guarda un estado que todavía no llegó a la pantalla (p. ej. "la publicación quedó a medias",
   * justo antes de subir las fotos). El render siguiente vuelve a poner el estado real.
   */
  const guardarConEstado = useCallback((e: EstadoBorrador) => {
    actualRef.current = { ...actualRef.current, estado: e };
    return guardar();
  }, [guardar]);

  /** "Conservar lo de esta pestaña": se guarda encima de la versión que ganó. */
  const resolverConflictoConservando = useCallback(async () => {
    if (!conflicto) return false;
    versionRef.current = conflicto.version;
    setConflicto(null);
    return guardar();
  }, [conflicto, guardar]);

  /**
   * Deja de seguir el borrador actual sin borrarlo del servidor: p. ej. el vendedor cambió a un
   * archivo de otro tipo, que se guarda en su propio borrador (el anterior queda para retomarlo).
   */
  const olvidar = useCallback(() => {
    versionRef.current = null;
    setJsonGuardado(null);
    shaArchivoRef.current = null;
    guardadasRef.current = {};
    rechazadasRef.current = new Set();
    setGuardadas({});
    setUltimoGuardado(null);
    setConflicto(null);
    setEstadoGuardado('sin-cambios');
  }, [setJsonGuardado]);

  const descartar = useCallback(async () => {
    await eliminarBorrador(actualRef.current.estado.tipo);
    olvidar();
  }, [olvidar]);

  // Guardado automático: unos segundos después del último cambio, y enseguida al cambiar de etapa.
  const pasoAnterior = useRef(estado.paso);
  useEffect(() => {
    if (!hayCambios || estadoGuardado === 'conflicto') return undefined;
    const cambioDePaso = pasoAnterior.current !== estado.paso;
    pasoAnterior.current = estado.paso;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (estadoGuardado !== 'guardando') setEstadoGuardado('sin-guardar');
    const t = setTimeout(() => { void guardar(); }, cambioDePaso ? 0 : esperaAutoguardado);
    return () => clearTimeout(t);
    // Se reprograma con cada cambio del JSON: eso es el "después del último cambio".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, hayCambios]);

  return {
    estadoGuardado,
    ultimoGuardado,
    errorGuardado,
    conflicto,
    progresoFotos,
    guardadas,
    hayCambios,
    hayCambiosSinGuardar: () => actualRef.current.habilitado
      && serializarBorrador(actualRef.current.estado) !== jsonGuardadoRef.current,
    guardar,
    guardarConEstado,
    adoptar,
    marcarComoGuardado,
    resolverConflictoConservando,
    olvidar,
    descartar,
  };
}

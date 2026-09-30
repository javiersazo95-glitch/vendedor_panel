/**
 * El progreso guardado del asistente "Mi propio Excel".
 *
 * Todo vive en el servidor (un borrador por vendedor): el estado del asistente como JSON, el
 * Excel original y SOLO las fotos que ya se asignaron a un repuesto. Las fotos sin asignar no se
 * guardan -una carpeta puede traer miles y subirlas todas costaría tiempo y espacio sin servir de
 * nada-, así que al retomar se le pide al vendedor volver a elegir su carpeta, y se le dice por qué.
 *
 * Las filas del Excel nunca van en el JSON: se reconstruyen leyendo el archivo guardado. Así el
 * estado pesa lo que pesan las decisiones del vendedor, no su inventario entero.
 */
import { apiFetch } from './apiFetch';
import { conReintento429, type OpcionesReintento } from './reintento429';
import { API_BASE_URL } from './imageHelper';
import { getStoredSession } from './session';
import { encId } from './url';
import type { Mapping } from './plantillaMapping';

export interface BorradorImagen {
  id: number;
  nombreArchivo: string;
  bytes: number;
}

export interface BorradorCarga {
  estadoJson: string;
  paso: number;
  version: number;
  archivoNombre: string | null;
  archivoBytes: number | null;
  archivoSha256: string | null;
  archivoRecortado: boolean;
  tieneArchivo: boolean;
  imagenes: BorradorImagen[];
  createdAt: string;
  updatedAt: string;
}

export type PasoMiExcel = 1 | 2 | 3 | 4;

/** Lo que se guarda del asistente. `v` permite migrar borradores viejos si el formato cambia. */
export interface EstadoBorrador {
  v: 1;
  paso: PasoMiExcel;
  archivo: {
    nombre: string;
    sha256: string;
    hojaIndex: number;
    filaEncabezados: number;
    recortado: boolean;
    /** Filas de datos, sólo para el resumen del aviso "¿quieres retomarlo?". */
    filas: number;
  } | null;
  mapping: Mapping | null;
  /** Columnas opcionales que el vendedor decidió dejar vacías en todas las filas. */
  opcionalesVacios: string[];
  fotos: {
    /** Clave de fila -> nombres de archivo (máx. 4). */
    asignaciones: Record<string, string[]>;
    origen: 'carpeta' | 'zip' | null;
    /** Cuántas fotos traía la carpeta o el ZIP, para explicarlo al retomar. */
    totalDisponibles: number;
  };
  vistaPaso4: 'lista' | 'tarjetas';
  /**
   * Una publicación que quedó a medias: los productos ya se crearon pero faltaban fotos. Con
   * esto, retomar ofrece terminar de subirlas en vez de volver a publicar.
   */
  publicacion: { etapa: 'fotos'; productoPorClave: Record<string, number>; skuPorClave: Record<string, string> } | null;
}

export const ESTADO_VACIO: EstadoBorrador = {
  v: 1,
  paso: 1,
  archivo: null,
  mapping: null,
  opcionalesVacios: [],
  fotos: { asignaciones: {}, origen: null, totalDisponibles: 0 },
  vistaPaso4: 'tarjetas',
  publicacion: null,
};

/** Tope del backend para el archivo del borrador (multipart de 10 MB). */
export const MAX_BYTES_ARCHIVO_BORRADOR = 10 * 1024 * 1024;

/**
 * El servidor no acepta esta foto (tipo, tamaño, tope de fotos): volver a mandarla no sirve.
 * Un 429, un 5xx o un corte de red NO son esto: la foto se vuelve a intentar.
 */
export class FotoBorradorRechazadaError extends Error {}

export class ConflictoBorradorError extends Error {
  version: number;
  updatedAt: string | null;
  constructor(version: number, updatedAt: string | null) {
    super('Tu progreso se guardó desde otra ventana o pestaña.');
    this.name = 'ConflictoBorradorError';
    this.version = version;
    this.updatedAt = updatedAt;
  }
}

export function serializarBorrador(estado: EstadoBorrador): string {
  return JSON.stringify(estado);
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Lee un borrador guardado. Si no se entiende, devuelve null en vez de romper el asistente. */
export function deserializarBorrador(json: string): EstadoBorrador | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!esObjeto(data) || data.v !== 1) return null;
  const paso = [1, 2, 3, 4].includes(Number(data.paso)) ? (Number(data.paso) as PasoMiExcel) : 1;
  const fotos = esObjeto(data.fotos) ? data.fotos : {};
  const asignaciones: Record<string, string[]> = {};
  if (esObjeto(fotos.asignaciones)) {
    for (const [clave, nombres] of Object.entries(fotos.asignaciones)) {
      if (Array.isArray(nombres)) asignaciones[clave] = nombres.filter((n): n is string => typeof n === 'string').slice(0, 4);
    }
  }
  const archivo = esObjeto(data.archivo) && typeof data.archivo.nombre === 'string'
    ? {
      nombre: data.archivo.nombre,
      sha256: String(data.archivo.sha256 ?? ''),
      hojaIndex: Number(data.archivo.hojaIndex) || 0,
      filaEncabezados: Number(data.archivo.filaEncabezados) || 0,
      recortado: data.archivo.recortado === true,
      filas: Number(data.archivo.filas) || 0,
    }
    : null;
  const mapping = esObjeto(data.mapping) && esObjeto(data.mapping.oficial) ? (data.mapping as unknown as Mapping) : null;
  const publicacion = esObjeto(data.publicacion) && data.publicacion.etapa === 'fotos'
    && esObjeto(data.publicacion.productoPorClave)
    ? {
      etapa: 'fotos' as const,
      productoPorClave: data.publicacion.productoPorClave as Record<string, number>,
      skuPorClave: (esObjeto(data.publicacion.skuPorClave) ? data.publicacion.skuPorClave : {}) as Record<string, string>,
    }
    : null;
  return {
    v: 1,
    paso,
    archivo,
    mapping,
    opcionalesVacios: Array.isArray(data.opcionalesVacios) ? data.opcionalesVacios.filter((c): c is string => typeof c === 'string') : [],
    fotos: {
      asignaciones,
      origen: fotos.origen === 'carpeta' || fotos.origen === 'zip' ? fotos.origen : null,
      totalDisponibles: Number(fotos.totalDisponibles) || 0,
    },
    vistaPaso4: data.vistaPaso4 === 'lista' ? 'lista' : 'tarjetas',
    publicacion,
  };
}

/** Los nombres de archivo de todas las fotos asignadas, sin repetir. */
export function fotosAsignadas(asignaciones: Record<string, string[]>): string[] {
  return [...new Set(Object.values(asignaciones).flat())];
}

/** Huella del archivo, para reconocer que el vendedor volvió a elegir el mismo Excel. */
export async function huellaArchivo(file: Blob & { name?: string; lastModified?: number }): Promise<string> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const buffer = await new Response(file).arrayBuffer();
      const digest = await subtle.digest('SHA-256', buffer);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* Sin WebCrypto se usa la huella simple de abajo. */
  }
  return `simple:${file.name ?? ''}:${file.size}:${file.lastModified ?? 0}`;
}

/**
 * El archivo que se guarda. Si el Excel pasa del tope del servidor, se guarda sólo la hoja que
 * se está cargando, reescrita: suele bastar, porque lo pesado de un Excel son las demás hojas,
 * los formatos y las imágenes pegadas. Si ni así cabe, se devuelve null y el borrador se guarda
 * sin archivo (al retomar se pide elegir el mismo Excel de nuevo).
 */
export async function archivoParaBorrador(
  file: File, aoa: unknown[][], nombreHoja: string,
): Promise<{ archivo: File; recortado: boolean } | null> {
  if (file.size <= MAX_BYTES_ARCHIVO_BORRADOR) return { archivo: file, recortado: false };
  const XLSX = await import('xlsx');
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(aoa), nombreHoja.slice(0, 31) || 'Hoja1');
  const salida = XLSX.write(libro, { bookType: 'xlsx', type: 'array', compression: true });
  const recortado = new File([salida], file.name.replace(/\.[^.]+$/, '') + '.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return recortado.size <= MAX_BYTES_ARCHIVO_BORRADOR ? { archivo: recortado, recortado: true } : null;
}

/* --------------------------------- API --------------------------------- */

const sesion = () => {
  const s = getStoredSession();
  if (!s?.sellerId || !s?.token) throw new Error('Sesión requerida: no encontramos un proveedor activo.');
  return s;
};

const base = (sellerId: string) =>
  `${API_BASE_URL}/api/v1/proveedores/${encId(sellerId)}/inventario/borrador-carga`;

const mensajeDe = async (r: Response, fallback: string) => {
  try {
    const data = await r.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
};

/** Ruta (relativa a la API) de una foto guardada en el borrador, para `useImagenPrivada`. */
export function rutaImagenBorrador(imagenId: number): string {
  const s = getStoredSession();
  return `/api/v1/proveedores/${encId(s?.sellerId ?? '')}/inventario/borrador-carga/imagenes/${encId(imagenId)}`;
}

export async function obtenerBorrador(): Promise<BorradorCarga | null> {
  const s = sesion();
  const r = await apiFetch(base(s.sellerId), { headers: { Authorization: `Bearer ${s.token}` } });
  if (r.status === 204 || r.status === 404) return null;
  if (!r.ok) throw new Error(await mensajeDe(r, 'No pudimos revisar si tienes un progreso guardado.'));
  return r.json();
}

export async function guardarBorrador(
  estado: EstadoBorrador, versionEsperada: number | null, reintento?: OpcionesReintento,
): Promise<{ version: number; updatedAt: string }> {
  const s = sesion();
  // H33: el guardado comparte el tope de 120 peticiones por minuto con todo el panel.
  const r = await conReintento429(() => apiFetch(base(s.sellerId), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ estadoJson: serializarBorrador(estado), paso: estado.paso, versionEsperada }),
  }), reintento);
  if (r.status === 409) {
    let version = versionEsperada ?? 0;
    let updatedAt: string | null = null;
    try {
      const data = await r.json();
      version = Number(data.version ?? version);
      updatedAt = data.updatedAt ?? null;
    } catch { /* sin cuerpo: se queda con lo que se sabía */ }
    throw new ConflictoBorradorError(version, updatedAt);
  }
  if (!r.ok) throw new Error(await mensajeDe(r, 'No se pudo guardar tu progreso.'));
  return r.json();
}

export async function subirArchivoBorrador(archivo: File, sha256: string, recortado: boolean): Promise<BorradorCarga> {
  const s = sesion();
  const form = new FormData();
  form.append('file', archivo);
  form.append('sha256', sha256);
  form.append('recortado', String(recortado));
  const r = await conReintento429(() => apiFetch(`${base(s.sellerId)}/archivo`, {
    method: 'PUT', headers: { Authorization: `Bearer ${s.token}` }, body: form,
  }, 120000));
  if (!r.ok) throw new Error(await mensajeDe(r, 'No se pudo guardar tu Excel.'));
  return r.json();
}

export async function descargarArchivoBorrador(nombre: string): Promise<File> {
  const s = sesion();
  const r = await apiFetch(`${base(s.sellerId)}/archivo`, { headers: { Authorization: `Bearer ${s.token}` } }, 120000);
  if (!r.ok) throw new Error(await mensajeDe(r, 'No pudimos traer el Excel que guardaste.'));
  const blob = await r.blob();
  return new File([blob], nombre, { type: blob.type || 'application/octet-stream' });
}

export async function subirImagenBorrador(
  imagen: Blob,
  nombreArchivo: string,
  reintento?: OpcionesReintento,
): Promise<BorradorImagen> {
  const s = sesion();
  const form = new FormData();
  form.append('imagen', imagen, nombreArchivo);
  form.append('nombreArchivo', nombreArchivo);
  // H33: el guardado sube una petición por foto y comparte el tope de 120 por minuto de
  // /api/v1/proveedores/** con todo el panel. Ante un 429 se espera lo que diga Retry-After.
  const r = await conReintento429(() => apiFetch(`${base(s.sellerId)}/imagenes`, {
    method: 'POST', headers: { Authorization: `Bearer ${s.token}` }, body: form,
  }, 60000), reintento);
  if (!r.ok) {
    const mensaje = await mensajeDe(r, 'No se pudo guardar una foto.');
    const definitivo = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429;
    throw definitivo ? new FotoBorradorRechazadaError(mensaje) : new Error(mensaje);
  }
  return r.json();
}

export async function descargarImagenBorrador(imagenId: number): Promise<Blob | null> {
  const s = sesion();
  const r = await apiFetch(`${base(s.sellerId)}/imagenes/${encId(imagenId)}`, { headers: { Authorization: `Bearer ${s.token}` } }, 60000);
  return r.ok ? r.blob() : null;
}

export async function sincronizarImagenesBorrador(nombresAsignados: string[]): Promise<number> {
  const s = sesion();
  const r = await apiFetch(`${base(s.sellerId)}/imagenes/sincronizar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombresAsignados }),
  });
  if (!r.ok) return 0;
  const data = await r.json().catch(() => ({}));
  return Number(data.eliminadas ?? 0);
}

export async function eliminarBorrador(): Promise<void> {
  const s = sesion();
  const r = await apiFetch(base(s.sellerId), { method: 'DELETE', headers: { Authorization: `Bearer ${s.token}` } });
  if (!r.ok && r.status !== 404) throw new Error(await mensajeDe(r, 'No se pudo descartar tu progreso.'));
}

/** "30-09-2026" y "14:05", como se lee en Chile. */
export function fechaYHora(iso: string): { fecha: string; hora: string } {
  const d = new Date(iso);
  return {
    fecha: d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    hora: d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
  };
}

/**
 * Las llamadas de la carga masiva por Excel: revisar sin guardar (`/excel/validar`), publicar
 * (`/excel/cargar`) y esperar una carga grande que el backend procesa en segundo plano.
 *
 * Son funciones sin estado de pantalla: el avance se informa por callbacks, para que las use
 * tanto la plantilla oficial como el asistente "Mi propio Excel".
 */
import { apiFetch, BULK_EXCEL_VALIDATION_TIMEOUT_MS, SessionExpiredError } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import { encId } from './url';
import { conReintento429 } from './reintento429';

export interface FilaResultado {
  /** Fila de la hoja "inventario" del archivo enviado, contando el encabezado como la 1. */
  fila: number;
  sku: string;
  estado: 'OK' | 'ADVERTENCIA' | 'ERROR';
  mensajes: string[];
  productoId?: number | null;
}

export interface CargaExcelResponse {
  jobId?: number | null;
  estado?: string | null;
  filasProcesadas?: number | null;
  totalFilas: number;
  productosCargados: number;
  productosConError: number;
  productosConAdvertencia: number;
  errores: string[];
  advertencias: string[];
  avisosGenerales?: string[];
  filas: FilaResultado[];
  archivoRepetido?: boolean;
  archivoYaCargadoEl?: string | null;
}

export const JOB_ESTADOS_EN_CURSO = new Set(['PENDIENTE', 'PROCESANDO']);
const POLL_INTERVAL_MS = 2000;
const POLL_TOPE_MS = 30 * 60 * 1000;
const POLL_ESPERA_MAXIMA_MS = 30 * 1000;

export class CargaSigueProcesandoError extends Error {
  constructor() {
    super('Tu archivo se sigue procesando. Puedes seguir usando el panel y revisar el resultado en "Historial de cargas" en unos minutos.');
  }
}

export const MENSAJE_SKU_DUPLICADO = 'SKU repetido dentro de la misma plantilla: ya hay otra fila válida con este mismo SKU, así que esta no se cargaría.';

/** Mismo criterio que el backend: las filas con advertencia cuentan como cargadas. */
export function recalcularAgregados(base: CargaExcelResponse, filas: FilaResultado[]): CargaExcelResponse {
  return {
    ...base,
    filas,
    productosConAdvertencia: filas.filter((f) => f.estado === 'ADVERTENCIA').length,
    productosConError: filas.filter((f) => f.estado === 'ERROR').length,
    productosCargados: filas.filter((f) => f.estado === 'OK' || f.estado === 'ADVERTENCIA').length,
  };
}

/**
 * El dry-run del backend no ve SKUs repetidos dentro del mismo archivo (cada fila se simula en su
 * propia transacción). La primera aparición queda como vino y las siguientes pasan a ERROR, igual
 * que pasaría en la carga real.
 */
export function marcarSkuDuplicados(data: CargaExcelResponse): CargaExcelResponse {
  const vistos = new Set<string>();
  const filas = data.filas.map((fila) => {
    if (fila.estado === 'ERROR') return fila;
    const clave = fila.sku.trim().toUpperCase();
    if (clave && vistos.has(clave)) return { ...fila, estado: 'ERROR' as const, mensajes: [MENSAJE_SKU_DUPLICADO] };
    if (clave) vistos.add(clave);
    return fila;
  });
  return recalcularAgregados(data, filas);
}

export async function leerMensajeError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

const url = (sellerId: string, ruta: string) =>
  `${API_BASE_URL}/api/v1/proveedores/${encId(sellerId)}/inventario/excel/${ruta}`;

/** Revisa el archivo sin guardar nada. Devuelve la revisión ya con los SKUs repetidos marcados. */
export async function validarExcel(sellerId: string, token: string, file: File): Promise<CargaExcelResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiFetch(
    url(sellerId, 'validar'),
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData },
    BULK_EXCEL_VALIDATION_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(await leerMensajeError(response, 'No se pudo revisar el archivo.'));
  return marcarSkuDuplicados(await response.json());
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Espera una carga que el backend procesa en segundo plano. Un 429, un 5xx o un corte de red no
 * la dan por perdida: se vuelve a preguntar con una espera cada vez más larga.
 */
export async function esperarCarga(
  sellerId: string,
  token: string,
  jobId: number,
  onAvance?: (procesadas: number, total: number, mensaje?: string) => void,
): Promise<CargaExcelResponse> {
  const limite = Date.now() + POLL_TOPE_MS;
  let fallos = 0;
  const trasFallo = async () => {
    fallos += 1;
    onAvance?.(0, 0, 'No pudimos ver el avance. Tu carga sigue en proceso; volvemos a mirar en un momento...');
    await esperar(Math.min(POLL_INTERVAL_MS * 2 ** fallos, POLL_ESPERA_MAXIMA_MS));
  };
  while (true) {
    if (Date.now() > limite) throw new CargaSigueProcesandoError();
    let response: Response;
    try {
      response = await conReintento429(
        () => apiFetch(url(sellerId, `cargas/${encId(jobId)}`), { headers: { Authorization: `Bearer ${token}` } }),
        { esperar },
      );
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      await trasFallo();
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(await leerMensajeError(response, 'No se pudo consultar el avance de la carga.'));
    }
    if (!response.ok) { await trasFallo(); continue; }
    fallos = 0;
    const data: CargaExcelResponse = await response.json();
    if (!data.estado || !JOB_ESTADOS_EN_CURSO.has(data.estado)) return data;
    onAvance?.(data.filasProcesadas ?? 0, data.totalFilas);
    await esperar(POLL_INTERVAL_MS);
  }
}

/** Publica el archivo. Si el backend lo deja en segundo plano, espera a que termine. */
export async function cargarExcel(
  sellerId: string,
  token: string,
  file: File,
  onAvance?: (procesadas: number, total: number, mensaje?: string) => void,
  onJob?: (jobId: number) => void,
): Promise<CargaExcelResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiFetch(
    url(sellerId, 'cargar'),
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData },
    BULK_EXCEL_VALIDATION_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(await leerMensajeError(response, 'No se pudo publicar el archivo.'));
  const data: CargaExcelResponse = await response.json();
  if (data.jobId != null && data.estado && JOB_ESTADOS_EN_CURSO.has(data.estado)) {
    onJob?.(data.jobId);
    onAvance?.(data.filasProcesadas ?? 0, data.totalFilas);
    return { ...(await esperarCarga(sellerId, token, data.jobId, onAvance)), archivoRepetido: data.archivoRepetido, archivoYaCargadoEl: data.archivoYaCargadoEl };
  }
  return data;
}

/**
 * Descarga la plantilla de RepuesTop (con sus listas para elegir categoría, marca, modelo, años y
 * motor según el catálogo) y la guarda en el computador del vendedor.
 */
export async function descargarPlantilla(sellerId: string, token: string): Promise<void> {
  const r = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(sellerId)}/inventario/excel/plantilla`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await leerMensajeError(r, 'No se pudo descargar la plantilla. Intenta de nuevo en un momento.'));
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `plantilla-inventario-repuestop_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

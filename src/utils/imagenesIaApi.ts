/**
 * Imágenes referenciales con IA para los repuestos que se publican sin foto (24-nov-2026). El panel sólo las
 * pide y muestra el avance: las crea el backend en segundo plano, aunque se cierre la pestaña.
 */
import { apiFetch } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import { encId } from './url';
import { conReintento429 } from './reintento429';
import { leerMensajeError } from './cargaExcelApi';
import { condicionDesdeTexto, esUsadoOReacondicionado } from './condicionProducto';

/** El flag del Mantenedor. Sin configuración remota vale apagado: la función depende del backend. */
export const FLAG_IMAGENES_IA = 'panel.imagenes-ia';

export interface CupoImagenesIa {
  activo: boolean;
  cupoDiario: number;
  restantes: number;
  enCola: number;
  capacidadHoy: number;
  capacidadDiaria: number;
}

export interface ResultadoImagenesIa {
  lote: string;
  encolados: number;
  sinCupo: number;
  conFoto: number;
  usados: number;
  noValidos: number;
}

export interface LoteImagenesIa {
  lote: string;
  creadoEn: string;
  total: number;
  listas: number;
  enProceso: number;
  fallidas: number;
}

export type EstadoImagenIa = 'PENDIENTE' | 'PROCESANDO' | 'LISTA' | 'FALLIDA' | 'OMITIDA' | 'CANCELADA' | 'DESCARTADA';

export interface ItemImagenIa {
  productoId: number;
  sku: string | null;
  nombre: string | null;
  estado: EstadoImagenIa;
  imagenUrl: string | null;
  mensaje: string | null;
}

export interface DetalleLoteImagenesIa {
  resumen: LoteImagenesIa;
  items: ItemImagenIa[];
  pagina: number;
  paginas: number;
}

interface Sesion { sellerId: string; token: string }

async function pedir<T>(sesion: Sesion, ruta: string, fallback: string, init: RequestInit = {}): Promise<T> {
  const respuesta = await conReintento429(() => apiFetch(
    `${API_BASE_URL}/api/v1/proveedores/${encId(sesion.sellerId)}/inventario/imagenes-ia${ruta}`,
    { ...init, headers: { Authorization: `Bearer ${sesion.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } },
  ));
  if (!respuesta.ok) throw new Error(await leerMensajeError(respuesta, fallback));
  return respuesta.status === 204 ? (undefined as T) : respuesta.json();
}

export const obtenerCupoImagenesIa = (s: Sesion) =>
  pedir<CupoImagenesIa>(s, '/cupo', 'No pudimos consultar las imágenes referenciales.');

export const pedirImagenesIa = (s: Sesion, productoIds: number[]) =>
  pedir<ResultadoImagenesIa>(s, '', 'No pudimos pedir las imágenes referenciales.', { method: 'POST', body: JSON.stringify({ productoIds }) });

export const listarLotesImagenesIa = (s: Sesion) =>
  pedir<LoteImagenesIa[]>(s, '/lotes', 'No pudimos cargar las imágenes referenciales.');

export const detalleLoteImagenesIa = (s: Sesion, lote: string, pagina = 0) =>
  pedir<DetalleLoteImagenesIa>(s, `/lotes/${encId(lote)}?page=${pagina}`, 'No pudimos cargar las imágenes referenciales.');

export const regenerarImagenIa = (s: Sesion, productoId: number) =>
  pedir<ResultadoImagenesIa>(s, `/${encId(productoId)}/regenerar`, 'No pudimos pedir otra imagen.', { method: 'POST' });

export const descartarImagenIa = (s: Sesion, productoId: number) =>
  pedir<void>(s, `/${encId(productoId)}/descartar`, 'No pudimos quitar la imagen.', { method: 'POST' });

/**
 * Cuántos repuestos por publicar podrían recibir una imagen referencial. Los usados y reacondicionados quedan
 * fuera: el contrato exige que sus fotos sean del producto ofrecido (el backend aplica la misma regla).
 */
export function contarParaImagenIa(filas: { tieneFoto: boolean; condicion: string }[]): { candidatos: number; usados: number } {
  const sinFoto = filas.filter((f) => !f.tieneFoto);
  const usados = sinFoto.filter((f) => esUsadoOReacondicionado(condicionDesdeTexto(f.condicion))).length;
  return { candidatos: sinFoto.length - usados, usados };
}

/** En cuánto estarían listas `cantidad` imágenes, según lo que ya espera y lo que cabe por día. */
export function plazoEstimado(cantidad: number, cupo: CupoImagenesIa): string {
  const faltan = cantidad + cupo.enCola - cupo.capacidadHoy;
  if (faltan <= 0) return 'hoy mismo';
  if (cupo.capacidadDiaria <= 0) return 'cuando se renueve el cupo mensual';
  const dias = Math.ceil(faltan / cupo.capacidadDiaria);
  return dias === 1 ? 'en cerca de 1 día' : `en cerca de ${dias.toLocaleString('es-CL')} días`;
}

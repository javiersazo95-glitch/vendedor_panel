/**
 * El repuesto a partir del código del fabricante impreso en la caja (25-nov-2026). El panel sólo pide y muestra: qué
 * vehículos le sirven lo decide el backend contra el catálogo chileno, y nada se publica sin que el vendedor confirme.
 */
import { apiFetch } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import { encId } from './url';
import { leerMensajeError } from './cargaExcelApi';

/** Flags del Mantenedor. Sin configuración remota valen apagados: la función depende del backend. */
export const FLAG_FICHA_CODIGO = 'global.ficha-codigo';
export const FLAG_CARGA_CON_CODIGOS = 'panel.carga-con-codigos';

export const CODIGO_MAX = 60;
/** El backend no busca más códigos que estos de una vez. */
export const MAXIMO_CODIGOS = 2000;

export interface GrupoVehiculo {
  marca: string;
  modelo: string;
  anioDesde: number | null;
  anioHasta: number | null;
  motor: string | null;
  vehiculoCatalogoIds: number[];
  versiones: string[];
  /** false = no se pudo confirmar el motor: se muestra, pero no se marca solo. */
  segura: boolean;
}

export interface FichaCodigo {
  fichaId: number;
  codigo: string;
  marca: string;
  nombre: string;
  confianza: 'ALTA' | 'MEDIA';
  verificada: boolean;
  categoria: string | null;
  subcategoria: string | null;
  categoriaExterna: string | null;
  referenciaOem: string | null;
  compatibilidad: { grupos: GrupoVehiculo[]; fueraDeCatalogo: string[] };
  detalle?: { fotos?: { url: string }[] } | null;
}

export type EstadoCodigo = 'PENDIENTE' | 'RECONOCIDO' | 'ELEGIR_MARCA' | 'NO_ENCONTRADO' | 'NO_DISPONIBLE';

export interface BusquedaCodigo {
  estado: EstadoCodigo;
  mensaje: string | null;
  opciones: { marca: string; nombre: string }[];
  ficha: FichaCodigo | null;
}

export interface ItemLote {
  id: number;
  orden: number;
  codigo: string;
  marca: string | null;
  estado: EstadoCodigo;
  opciones: string[];
  ficha: FichaCodigo | null;
}

export interface LoteCodigos {
  id: string;
  total: number;
  pendientes: number;
  /** Quedan por buscar y por hoy se acabó el cupo: siguen solos mañana. */
  sinCupo: boolean;
  items: ItemLote[];
}

interface Sesion { sellerId: string; token: string }

async function pedir<T>(sesion: Sesion, ruta: string, opciones: RequestInit = {}, fallo = 'No pudimos buscar el código.'): Promise<T> {
  const respuesta = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(sesion.sellerId)}/inventario/codigos${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${sesion.token}`, ...(opciones.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!respuesta.ok) throw new Error(await leerMensajeError(respuesta, fallo));
  return respuesta.json();
}

export function buscarCodigo(sesion: Sesion, codigo: string, marca?: string, condicion?: string): Promise<BusquedaCodigo> {
  const q = new URLSearchParams({ codigo });
  if (marca?.trim()) q.set('marca', marca.trim());
  if (condicion) q.set('condicion', condicion);
  return pedir(sesion, `?${q.toString()}`);
}

export function crearLote(sesion: Sesion, codigos: { codigo: string; marca?: string; usado?: boolean }[]): Promise<LoteCodigos> {
  return pedir(sesion, '/lotes', { method: 'POST', body: JSON.stringify({ codigos }) }, 'No pudimos buscar tus códigos.');
}

export function obtenerLote(sesion: Sesion, id: string): Promise<LoteCodigos> {
  return pedir(sesion, `/lotes/${encId(id)}`, {}, 'No pudimos leer el avance de tu lista.');
}

export function elegirMarcaDeLote(sesion: Sesion, id: string, itemId: number, marca: string): Promise<LoteCodigos> {
  return pedir(sesion, `/lotes/${encId(id)}/${itemId}/marca`, { method: 'POST', body: JSON.stringify({ marca }) }, 'No pudimos guardar la marca.');
}

/** Sólo los vehículos que el catálogo confirma: con años y con versiones. */
export const gruposSeguros = (ficha: FichaCodigo) => ficha.compatibilidad.grupos.filter((g) => g.segura && g.anioDesde);
/** Los que hay que revisar a mano antes de publicarlos. */
export const gruposPorRevisar = (ficha: FichaCodigo) => ficha.compatibilidad.grupos.filter((g) => !g.segura && g.anioDesde);

export const textoGrupo = (g: GrupoVehiculo) => [
  `${g.marca} ${g.modelo}`,
  g.anioDesde ? (g.anioHasta && g.anioHasta !== g.anioDesde ? `${g.anioDesde}-${g.anioHasta}` : String(g.anioDesde)) : '',
  g.motor ? `motor ${g.motor}` : '',
].filter(Boolean).join(' · ');

/** "Juego de pastillas de freno, freno de disco" + TRW + GDB3424 -> título corto de la publicación. */
export function nombrePropuesto(ficha: FichaCodigo, maximo = 80): string {
  const pieza = ficha.nombre.split(',')[0].trim();
  const conMarca = `${pieza} ${ficha.marca}`.trim();
  const completo = `${conMarca} ${ficha.codigo}`.trim();
  if (completo.length <= maximo) return completo;
  return (conMarca.length <= maximo ? conMarca : pieza).slice(0, maximo).trim();
}

/** Descripción sólo con datos que el vendedor ya está confirmando (pieza, marca, código y vehículos). */
export function descripcionPropuesta(ficha: FichaCodigo, grupos: GrupoVehiculo[]): string {
  const autos = [...new Set(grupos.map((g) => `${g.marca} ${g.modelo}`))];
  const lista = autos.slice(0, 6).join(', ') + (autos.length > 6 ? ` y ${autos.length - 6} modelos más` : '');
  return [
    `${ficha.nombre.split(',')[0].trim()} marca ${ficha.marca}, código ${ficha.codigo}.`,
    autos.length > 0 ? `Sirve para: ${lista}. Revisa los años y el motor en la compatibilidad o compruébalo con tu patente.` : '',
  ].filter(Boolean).join(' ');
}

/* ------- Lo último que eligió la tienda al publicar: se propone en el siguiente repuesto ------- */

export interface UltimaEleccion { condicion?: 'ORIGINAL' | 'ALTERNATIVO'; garantia?: string }

const claveUltima = (sellerId: string) => `repuestop_ultima_publicacion_${sellerId}`;

export function leerUltimaEleccion(sellerId?: string): UltimaEleccion {
  if (!sellerId) return {};
  try {
    const dato = JSON.parse(localStorage.getItem(claveUltima(sellerId)) ?? '{}');
    return {
      condicion: dato?.condicion === 'ORIGINAL' || dato?.condicion === 'ALTERNATIVO' ? dato.condicion : undefined,
      garantia: typeof dato?.garantia === 'string' ? dato.garantia : undefined,
    };
  } catch {
    return {};
  }
}

export function guardarUltimaEleccion(sellerId: string | undefined, eleccion: { condicion?: string; garantia?: string }): void {
  if (!sellerId) return;
  try {
    localStorage.setItem(claveUltima(sellerId), JSON.stringify(eleccion));
  } catch {
    // Sin almacenamiento sólo se deja de recordar.
  }
}

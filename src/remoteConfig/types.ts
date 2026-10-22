/**
 * Tipos del bootstrap del Mantenedor común, uno a uno con el contrato
 * `docs/arquitectura/contrato-mantenedor-bootstrap.md` (sección 2) del mono-repo. Si el contrato
 * cambia, cambia primero allá y después acá.
 *
 * Los campos sin valor llegan como `null` (nunca se omiten), así que acá no hay opcionales.
 */

export type ClienteRemoto = 'APP' | 'MARKET' | 'PANEL' | 'BACKOFFICE';

/** Cómo parsear cada parámetro: los valores viajan siempre como string. */
export type TipoParametro = 'NUMBER' | 'PERCENT' | 'MONEY' | 'BOOLEAN' | 'STRING' | 'JSON';

export interface OpcionListaDTO {
  valor: string;
  etiqueta: string;
  descripcion: string | null;
  orden: number;
  esDefault: boolean;
  iconoUrl: string | null;
  color: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SubcategoriaDTO {
  id: number;
  nombre: string;
  slug: string;
  orden: number;
  imagenUrl: string | null;
}

export interface CategoriaDTO {
  id: number;
  nombre: string;
  slug: string;
  familia: string | null;
  orden: number;
  iconoUrl: string | null;
  iconoNombre: string | null;
  color: string | null;
  imagenUrl: string | null;
  subcategorias: SubcategoriaDTO[];
}

export interface MarcaVehiculoDTO {
  id: number;
  nombre: string;
  slug: string;
  orden: number;
  iconoUrl: string | null;
  color: string | null;
  destacada: boolean;
}

export interface MarcaRepuestoDestacadaDTO {
  id: number;
  nombre: string;
  slug: string;
  orden: number;
  iconoUrl: string | null;
  color: string | null;
  calidadReferencial: string | null;
}

export interface BootstrapDTO {
  version: number;
  cliente: ClienteRemoto;
  generadoEn: string;
  parametros: Record<string, string>;
  parametrosTipos: Record<string, TipoParametro>;
  /** Ya resuelto para este cliente (fila PANEL manda sobre TODOS). Ausente = usa tu fallback. */
  flags: Record<string, boolean>;
  flagsMetadata: Record<string, Record<string, unknown>>;
  listas: Record<string, OpcionListaDTO[]>;
  categorias: CategoriaDTO[];
  marcasVehiculo: MarcaVehiculoDTO[];
  marcasRepuestoDestacadas: MarcaRepuestoDestacadaDTO[];
}

export type NombreCatalogo = 'categorias' | 'marcasVehiculo' | 'marcasRepuestoDestacadas';

export type CatalogoDe<T extends NombreCatalogo> = BootstrapDTO[T];

/** Lo que se guarda en `localStorage` (contrato, sección 6, punto 1). */
export interface CacheRemota {
  version: number;
  data: BootstrapDTO;
  guardadoEn: string;
  /** ETag tal como lo mandó el servidor, para el `If-None-Match`. Si falta se arma desde `version`. */
  etag?: string;
}

/** De dónde salió lo que se está mostrando. Útil para depurar y para los tests. */
export type OrigenConfig = 'ninguno' | 'cache' | 'red' | 'fixture';

export interface EstadoRemoteConfig {
  /** `null` mientras no haya ni caché ni respuesta: los hooks devuelven sus fallbacks. */
  data: BootstrapDTO | null;
  origen: OrigenConfig;
  /** Último error de red o de parseo, sólo informativo: nunca bloquea el render. */
  error: string | null;
  /** Cuándo se obtuvo lo que se muestra (ISO-8601), o `null` sin datos. */
  actualizadoEn: string | null;
}

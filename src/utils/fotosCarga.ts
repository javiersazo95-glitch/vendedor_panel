/**
 * Fotos de la carga masiva: leer una carpeta o un ZIP, emparejar cada foto con su repuesto por
 * el nombre del archivo, y subirlas a los productos ya publicados.
 *
 * Lo usan la plantilla oficial (`FullCreationUpload`) y el asistente "Mi propio Excel". Las
 * asignaciones van por una clave genérica: la plantilla usa el SKU y el asistente la clave de la
 * fila, porque ahí el SKU se puede corregir en la tabla y no sirve de identificador.
 */
import { apiFetch } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import { encId } from './url';
import { conReintento429 } from './reintento429';
import { comprimirImagen } from './imageCompression';
import { esUrlDeImagen } from './plantillaFotos';

export const MAX_IMAGES_PER_PRODUCT = 4;
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
/** H32: 6 en paralelo -- cada producto son 2 peticiones y el backend limita a 120/min. */
export const PHOTO_UPLOAD_BATCH_SIZE = 6;

export function mimeTypeForExtension(ext: string): string {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'application/octet-stream';
}

/**
 * El formato ZIP no guarda el Content-Type de sus archivos y JSZip tampoco lo infiere. Sin
 * ponerlo a mano, cada foto viaja como application/octet-stream y el backend la rechaza
 * ("Solo se permiten imagenes de producto") aunque el contenido sea una imagen real.
 */
export async function extractZipImages(zipFile: Blob): Promise<Record<string, Blob>> {
  const imageFilesMap: Record<string, Blob> = {};
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const contents = await zip.loadAsync(zipFile);
  for (const [filename, fileObj] of Object.entries(contents.files)) {
    if (fileObj.dir) continue;
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext || !IMAGE_EXTENSIONS.includes(ext)) continue;
    const arrayBuffer = await fileObj.async('arraybuffer');
    const cleanName = filename.split('/').pop() || filename;
    imageFilesMap[cleanName.toLowerCase()] = new Blob([arrayBuffer], { type: mimeTypeForExtension(ext) });
  }
  return imageFilesMap;
}

/** Las imágenes de una carpeta elegida con `webkitdirectory`, por nombre en minúsculas. */
export function extractFolderImages(files: FileList | File[]): Record<string, File> {
  const imageFilesMap: Record<string, File> = {};
  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext && IMAGE_EXTENSIONS.includes(ext)) imageFilesMap[file.name.toLowerCase()] = file;
  }
  return imageFilesMap;
}

/**
 * Nombre de archivo = SKU (Fase 15). Se permite un sufijo (SKU-123_1.jpg, SKU-123-2.jpg) para
 * declarar más de una foto por producto sin inventar nombres distintos.
 */
export function matchesSku(filenameLower: string, sku: string): boolean {
  const base = filenameLower.replace(/\.[^.]+$/, '');
  const skuLower = sku.trim().toLowerCase();
  if (!skuLower) return false;
  if (base === skuLower) return true;
  return base.startsWith(`${skuLower}_`) || base.startsWith(`${skuLower}-`) || base.startsWith(`${skuLower} `);
}

/**
 * Los nombres de archivo que el vendedor declaró en su Excel para un repuesto, cuando existen de
 * verdad entre las fotos que subió. Mandan sobre el emparejamiento por SKU.
 */
export function declaradasEntre(declaradas: string[], filenames: string[]): string[] {
  return declaradas
    .filter((d) => !esUrlDeImagen(d))
    .map((d) => {
      const nombre = d.split(/[\\/]/).pop()?.trim().toLowerCase() ?? '';
      return filenames.find((f) => f.toLowerCase() === nombre);
    })
    .filter((f): f is string => !!f);
}

/**
 * Empareja fotos con repuestos. `filas` trae la clave con la que se guarda la asignación y el SKU
 * con el que se busca; `declaradasPorSku`, lo que dice la columna de fotos del Excel.
 */
export function asignarPorCodigo(
  filas: { clave: string; sku: string }[],
  filenames: string[],
  declaradasPorSku: Record<string, string[]> = {},
): Record<string, string[]> {
  const asignaciones: Record<string, string[]> = {};
  for (const { clave, sku } of filas) {
    const declaradas = declaradasEntre(declaradasPorSku[sku] ?? [], filenames);
    const matches = (declaradas.length > 0 ? declaradas : filenames.filter((f) => matchesSku(f, sku)))
      .sort()
      .slice(0, MAX_IMAGES_PER_PRODUCT);
    if (matches.length > 0) asignaciones[clave] = matches;
  }
  return asignaciones;
}

export interface FotoUploadResultado {
  /** La clave de la asignación (el SKU en la plantilla, la clave de fila en "Mi propio Excel"). */
  clave: string;
  sku: string;
  ok: boolean;
  mensaje?: string;
}

export interface SubidaFotos {
  sellerId: string;
  token: string;
  productos: { clave: string; sku: string; productoId: number }[];
  asignaciones: Record<string, string[]>;
  /** De dónde sale cada foto: la carpeta en memoria, o la copia guardada en el borrador. */
  obtenerImagen: (nombre: string) => Promise<Blob | null> | Blob | null;
  onProgreso?: (hechas: number, total: number) => void;
  /** Aviso de pausa por el límite de peticiones (segundos). */
  onEspera?: (segundos: number) => void;
}

const leerMensaje = async (response: Response, fallback: string) => {
  try {
    const data = await response.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
};

/**
 * Los productos ya existen (Fase A, /excel/cargar). Se reutiliza el endpoint de edición, que ya
 * sube fotos a R2: un multipart por producto, en lotes paralelos acotados. Ese endpoint es un
 * reemplazo completo del producto, así que se trae el producto y se reenvía tal cual más las fotos.
 */
export async function subirFotosAProductos({
  sellerId, token, productos, asignaciones, obtenerImagen, onProgreso, onEspera,
}: SubidaFotos): Promise<FotoUploadResultado[]> {
  const conFotos = productos.filter((p) => (asignaciones[p.clave] ?? []).length > 0);
  const resultados: FotoUploadResultado[] = [];
  let completadas = 0;
  onProgreso?.(0, conFotos.length);
  const base = `${API_BASE_URL}/api/v1/proveedores/${encId(sellerId)}/inventario`;

  for (let i = 0; i < conFotos.length; i += PHOTO_UPLOAD_BATCH_SIZE) {
    const lote = conFotos.slice(i, i + PHOTO_UPLOAD_BATCH_SIZE);
    await Promise.all(lote.map(async (fila) => {
      try {
        const getResponse = await conReintento429(() => apiFetch(
          `${base}/${encId(fila.productoId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ), { onEspera });
        if (!getResponse.ok) {
          const mensaje = getResponse.status === 404
            ? 'Este producto ya no existe en tu inventario (puede haber sido eliminado). No se pudo subir la foto para este SKU.'
            : await leerMensaje(getResponse, 'No se pudo leer el producto antes de subir la foto.');
          resultados.push({ clave: fila.clave, sku: fila.sku, ok: false, mensaje });
          return;
        }
        const producto = await getResponse.json();

        const formData = new FormData();
        formData.append('skuProveedor', producto.skuProveedor ?? fila.sku);
        formData.append('nombrePublicado', producto.nombrePublicado ?? '');
        formData.append('categoria', producto.categoria ?? '');
        if (producto.subcategoria) formData.append('subcategoria', producto.subcategoria);
        formData.append('marcaRepuesto', producto.marcaRepuesto ?? '');
        formData.append('referenciaOem', producto.referenciaOem ?? '');
        formData.append('compatibilidadMarca', producto.compatibilidadMarca ?? '');
        formData.append('compatibilidadModelo', producto.compatibilidadModelo ?? '');
        if (producto.anioDesde != null) formData.append('anioDesde', String(producto.anioDesde));
        if (producto.anioHasta != null) formData.append('anioHasta', String(producto.anioHasta));
        formData.append('motor', producto.motor ?? '');
        formData.append('pricingMode', producto.pricingMode ?? 'SHOW_PRICE');
        if (producto.precio != null) formData.append('precio', String(producto.precio));
        formData.append('stock', String(producto.stock ?? 0));
        formData.append('descripcion', producto.descripcion ?? '');
        formData.append('condicion', producto.condicion ?? 'ORIGINAL');
        formData.append('requiereChasis', String(producto.requiereChasis === true));
        formData.append('compatibilityGroupsJson', producto.compatibilityGroupsJson ?? '');
        (producto.vehiculoCatalogoIds ?? []).forEach((id: number) => formData.append('vehiculoCatalogoIds', String(id)));
        formData.append('activo', String(producto.activo !== false));
        // Se comprime acá, justo antes de subir: cubre todas las fuentes por igual.
        for (const nombre of asignaciones[fila.clave] ?? []) {
          const blob = await obtenerImagen(nombre);
          if (!blob) continue;
          const { blob: comprimido, filename } = await comprimirImagen(blob, nombre);
          formData.append('imagenes', comprimido, filename);
        }

        const response = await conReintento429(() => apiFetch(
          `${base}/${encId(fila.productoId)}/editar`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData },
        ), { onEspera });
        resultados.push(response.ok
          ? { clave: fila.clave, sku: fila.sku, ok: true }
          : { clave: fila.clave, sku: fila.sku, ok: false, mensaje: await leerMensaje(response, 'No se pudo subir la foto.') });
      } catch (err) {
        resultados.push({ clave: fila.clave, sku: fila.sku, ok: false, mensaje: err instanceof Error ? err.message : 'Error al subir la foto.' });
      } finally {
        completadas += 1;
        onProgreso?.(completadas, conFotos.length);
      }
    }));
  }
  return resultados;
}

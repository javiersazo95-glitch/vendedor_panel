/**
 * Fotos declaradas en el propio Excel del vendedor.
 *
 * La plantilla oficial no tiene columna de imagen: las fotos se suben en una fase B
 * posterior, emparejando por nombre de archivo = SKU. Pero muchos vendedores ya traen la
 * foto en su lista, sea como URL (la de su web o su proveedor) o como el nombre del
 * archivo dentro de la carpeta que van a subir igual. Hasta ahora esa columna sólo podía
 * ir a la descripción, y el vendedor tenía que renombrar cientos de archivos a mano.
 *
 * **Por qué esto vive en el panel y no en el contrato del backend.** Poner una columna
 * `imagen` en la plantilla obliga al servidor a descargar URLs que escribe el vendedor, y
 * eso es un SSRF de manual: basta con apuntar a una dirección interna para que el servidor
 * la consulte por ti. Bajarlas desde el navegador del vendedor no tiene ese problema —es su
 * red y sus URLs— y termina en el mismo lugar: la fase B que ya sube las fotos como
 * archivos. Por eso el contrato del Excel no cambia.
 */

/** Extensiones que el backend acepta como imagen. */
const EXTENSIONES = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

const extensionDe = (valor: string): string => {
  const limpio = valor.split(/[?#]/)[0];
  const punto = limpio.lastIndexOf('.');
  return punto === -1 ? '' : limpio.slice(punto + 1).toLowerCase();
};

export function esUrlDeImagen(valor: string): boolean {
  const texto = String(valor ?? '').trim();
  if (!/^https?:\/\//i.test(texto)) return false;
  try {
    new URL(texto);
  } catch {
    return false;
  }
  // Una URL sin extensión reconocible igual puede ser una imagen (un CDN con parámetros),
  // así que no se descarta: se intenta y el tipo real lo dice la respuesta.
  return true;
}

export function esNombreDeArchivoDeImagen(valor: string): boolean {
  const texto = String(valor ?? '').trim();
  if (!texto || /^https?:\/\//i.test(texto)) return false;
  return EXTENSIONES.includes(extensionDe(texto));
}

/** Una celda puede traer varias fotos separadas por coma, punto y coma o salto de línea. */
export function separarFotos(valor: string): string[] {
  return String(valor ?? '')
    .split(/[\n;,|]+/)
    .map((v) => v.trim())
    .filter((v) => esUrlDeImagen(v) || esNombreDeArchivoDeImagen(v));
}

export type TipoColumnaFotos = 'url' | 'archivo' | null;

/**
 * Qué trae la columna: URLs, nombres de archivo, o nada aprovechable. Se decide por
 * mayoría para que una celda vacía o un "sin foto" suelto no cambien el diagnóstico.
 */
export function tipoColumnaFotos(valores: string[]): TipoColumnaFotos {
  const conDato = valores.map((v) => separarFotos(v)).filter((f) => f.length > 0);
  if (conDato.length === 0 || conDato.length < valores.length / 2) return null;
  const urls = conDato.filter((fotos) => fotos.every(esUrlDeImagen)).length;
  return urls >= conDato.length / 2 ? 'url' : 'archivo';
}

/** Nombre con el que se guarda una foto bajada de una URL. */
export function nombreDesdeUrl(url: string, sku: string, indice: number): string {
  let base: string;
  try {
    base = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    base = '';
  }
  // Sin extensión reconocible el último tramo de la URL no dice nada ("img", "download"):
  // se usa el código del repuesto, que es lo que el vendedor va a reconocer en la lista.
  const tieneExtension = EXTENSIONES.includes(extensionDe(base));
  const extension = tieneExtension ? extensionDe(base) : 'jpg';
  const limpio = tieneExtension
    ? base.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40)
    : '';
  const sufijo = indice > 0 ? `_${indice + 1}` : '';
  return `${limpio || sku.trim() || 'foto'}${sufijo}.${extension}`;
}

/**
 * Fotos declaradas por SKU, leídas de la columna que eligió el vendedor. La clave es el
 * SKU tal como quedó en el archivo oficial, que es el que la fase B usa para emparejar.
 */
export function fotosPorSku(
  rows: unknown[][],
  colFotos: number,
  colSku: number,
  max = 4,
): Record<string, string[]> {
  const salida: Record<string, string[]> = {};
  for (const row of rows) {
    const sku = String((row as unknown[])[colSku] ?? '').trim();
    if (!sku) continue;
    const fotos = separarFotos(String((row as unknown[])[colFotos] ?? ''));
    if (fotos.length === 0) continue;
    const acumuladas = salida[sku] ?? [];
    for (const foto of fotos) {
      if (acumuladas.length >= max) break;
      if (!acumuladas.includes(foto)) acumuladas.push(foto);
    }
    salida[sku] = acumuladas;
  }
  return salida;
}

export interface DescargaFotos {
  /** nombre de archivo -> contenido, listo para la fase B. */
  archivos: Record<string, Blob>;
  /** SKU -> nombres de archivo descargados. */
  asignaciones: Record<string, string[]>;
  /** Fotos que no se pudieron traer, con el motivo en lenguaje llano. */
  fallidas: { sku: string; url: string; motivo: string }[];
}

/**
 * Baja las fotos declaradas desde el navegador del vendedor.
 *
 * Falla foto por foto a propósito: que el sitio de una imagen no permita descargarla
 * (CORS, la causa más común) no puede dejar sin fotos al resto del catálogo.
 */
export async function descargarFotos(
  declaradas: Record<string, string[]>,
  onProgreso?: (hechas: number, total: number) => void,
): Promise<DescargaFotos> {
  const entradas = Object.entries(declaradas).flatMap(([sku, urls]) =>
    urls.filter(esUrlDeImagen).map((url, i) => ({ sku, url, indice: i })));

  const archivos: Record<string, Blob> = {};
  const asignaciones: Record<string, string[]> = {};
  const fallidas: DescargaFotos['fallidas'] = [];
  let hechas = 0;

  for (const { sku, url, indice } of entradas) {
    try {
      const respuesta = await fetch(url);
      if (!respuesta.ok) throw new Error(`el sitio respondió ${respuesta.status}`);
      const blob = await respuesta.blob();
      if (!blob.type.startsWith('image/')) throw new Error('el enlace no es una imagen');
      let nombre = nombreDesdeUrl(url, sku, indice);
      // Dos productos pueden apuntar a "foto.jpg" en carpetas distintas.
      while (archivos[nombre]) nombre = `${nombre.replace(/\.[^.]+$/, '')}-${sku}.${nombre.split('.').pop()}`;
      archivos[nombre] = blob;
      asignaciones[sku] = [...(asignaciones[sku] ?? []), nombre];
    } catch (err) {
      fallidas.push({
        sku,
        url,
        // fetch lanza TypeError tanto si el navegador bloquea la respuesta (CORS, lo más
        // común) como si el sitio no responde. Desde acá no se distinguen, así que el
        // mensaje no afirma cuál de las dos fue.
        motivo: err instanceof TypeError
          ? 'no pudimos conectarnos con el sitio de la foto'
          : err instanceof Error ? err.message : 'no se pudo descargar',
      });
    }
    hechas += 1;
    onProgreso?.(hechas, entradas.length);
  }

  return { archivos, asignaciones, fallidas };
}

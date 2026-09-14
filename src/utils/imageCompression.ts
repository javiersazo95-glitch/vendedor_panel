/**
 * Redimensiona y recomprime una foto de producto ANTES de subirla a R2.
 *
 * Es la pieza que decide cuánto dura el bucket. R2 son 10 GB compartidos con las fotos de
 * Repuestop_Market, mobile y este panel; una foto de celular sale entre 3 y 8 MB en crudo,
 * y la carga masiva (carpeta, ZIP o fotos bajadas por URL del Excel) puede traer cientos de
 * una sola vez sin este paso. Bajando el lado mayor a 1600px y guardando en JPEG al 80%, una
 * foto de repuesto queda en 200-400 KB — mismo criterio que ya usa Repuestop_Market.
 *
 * 1600px es de sobra para mirar una pieza en pantalla o ampliarla; el detalle que importa
 * (un número de parte, una rotura) se sigue leyendo.
 *
 * Si algo falla (formato raro, canvas bloqueado) se devuelve el blob original tal cual —
 * nunca se pierde la foto por culpa de la compresión; el límite de 5MB del backend
 * (InventarioImagenSupport) sigue siendo la última red.
 */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

export interface ImagenComprimida {
  blob: Blob;
  filename: string;
}

const jpegFilename = (nombreOriginal: string): string => {
  const sinExtension = nombreOriginal.replace(/\.[^./\\]+$/, '');
  return `${sinExtension || 'foto'}.jpg`;
};

export async function comprimirImagen(
  archivo: Blob,
  nombreOriginal: string,
  { maxDimension = MAX_DIMENSION, quality = JPEG_QUALITY }: { maxDimension?: number; quality?: number } = {},
): Promise<ImagenComprimida> {
  const tipo = archivo.type || '';
  // Los GIF pierden la animacion al pasar por canvas y los SVG no son raster.
  if (!tipo.startsWith('image/') || tipo === 'image/gif' || tipo === 'image/svg+xml') {
    return { blob: archivo, filename: nombreOriginal };
  }

  try {
    const bitmap = await createImageBitmap(archivo);
    const { width, height } = bitmap;
    const mayor = Math.max(width, height);
    const escala = mayor > maxDimension ? maxDimension / mayor : 1;

    // Ya es chica y liviana: recomprimir solo agregaria perdida sin ganar nada.
    if (escala === 1 && archivo.size <= 400 * 1024) {
      bitmap.close?.();
      return { blob: archivo, filename: nombreOriginal };
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * escala);
    canvas.height = Math.round(height * escala);
    const contexto = canvas.getContext('2d');
    if (!contexto) {
      bitmap.close?.();
      return { blob: archivo, filename: nombreOriginal };
    }
    contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const comprimido = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!comprimido || comprimido.size >= archivo.size) {
      return { blob: archivo, filename: nombreOriginal };
    }
    return { blob: comprimido, filename: jpegFilename(nombreOriginal) };
  } catch {
    return { blob: archivo, filename: nombreOriginal };
  }
}

/** Comprime cada archivo de la lista, preservando el orden. Fallas individuales no detienen al resto (ver comprimirImagen). */
export async function comprimirImagenes(
  archivos: { blob: Blob; filename: string }[],
): Promise<ImagenComprimida[]> {
  return Promise.all(archivos.map(({ blob, filename }) => comprimirImagen(blob, filename)));
}

import { useEffect, useState } from 'react';
import { fetchBlobPrivado } from './fetchPrivado';

/**
 * Cache de imagenes privadas ya descargadas (ruta -> object URL).
 *
 * Las imagenes del chat de soporte y del borrador de carga viven en un bucket privado: el
 * navegador no puede mostrarlas con un <img src> directo porque la API pide el token. Se
 * descargan con `fetchBlobPrivado` y se muestran como object URL. El cache evita volver a
 * bajarlas cada vez que el polling re-renderiza la conversacion.
 *
 * Es un LRU acotado: al pasar el tope se libera (URL.revokeObjectURL) la imagen usada hace
 * mas tiempo, salvo que alguna vista la este mostrando en ese momento.
 */
const MAX_ENTRADAS = 200;

const cache = new Map<string, string>();
const enCurso = new Map<string, Promise<string | null>>();
const enUso = new Map<string, number>();

function revocar(url: string) {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // jsdom u otros entornos sin soporte: no hay nada que liberar.
  }
}

function recortarCache() {
  if (cache.size <= MAX_ENTRADAS) return;
  for (const [ruta, url] of cache) {
    if (cache.size <= MAX_ENTRADAS) break;
    if ((enUso.get(ruta) ?? 0) > 0) continue;
    cache.delete(ruta);
    revocar(url);
  }
}

function guardarEnCache(ruta: string, url: string) {
  const anterior = cache.get(ruta);
  if (anterior && anterior !== url) revocar(anterior);
  cache.delete(ruta);
  cache.set(ruta, url);
  recortarCache();
}

/** Mira el cache sin descargar nada (ni marcar la entrada como usada recien). */
export function imagenPrivadaEnCache(ruta: string): string | null {
  return cache.get(ruta) ?? null;
}

/**
 * Descarga (o toma del cache) una imagen privada y devuelve su object URL.
 * Devuelve null si la API respondio con error (403/404...). Los errores de red se propagan.
 * Pedidos simultaneos de la misma ruta comparten una sola descarga.
 */
export function cargarImagenPrivada(ruta: string): Promise<string | null> {
  const enCacheUrl = cache.get(ruta);
  if (enCacheUrl) {
    // Tocarla la deja al final del LRU.
    cache.delete(ruta);
    cache.set(ruta, enCacheUrl);
    return Promise.resolve(enCacheUrl);
  }

  const pendiente = enCurso.get(ruta);
  if (pendiente) return pendiente;

  const promesa = fetchBlobPrivado(ruta)
    .then((blob) => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      guardarEnCache(ruta, url);
      return url;
    })
    .finally(() => {
      enCurso.delete(ruta);
    });
  enCurso.set(ruta, promesa);
  return promesa;
}

/** Saca una imagen del cache (por ejemplo, si se reemplazo en el servidor con el mismo id). */
export function olvidarImagenPrivada(ruta: string): void {
  const url = cache.get(ruta);
  if (!url) return;
  cache.delete(ruta);
  if ((enUso.get(ruta) ?? 0) === 0) revocar(url);
}

/** Vacia todo el cache (al cerrar sesion o en tests). */
export function limpiarCacheImagenesPrivadas(): void {
  for (const url of cache.values()) revocar(url);
  cache.clear();
  enCurso.clear();
  enUso.clear();
}

function retener(ruta: string) {
  enUso.set(ruta, (enUso.get(ruta) ?? 0) + 1);
}

function soltar(ruta: string) {
  const n = (enUso.get(ruta) ?? 0) - 1;
  if (n > 0) enUso.set(ruta, n);
  else enUso.delete(ruta);
  recortarCache();
}

export interface ImagenPrivada {
  url: string | null;
  cargando: boolean;
  error: boolean;
}

interface Resultado {
  ruta: string;
  url: string | null;
  error: boolean;
}

/**
 * Muestra una imagen privada de la API: `const { url, cargando, error } = useImagenPrivada(ruta)`.
 * `ruta` es relativa a la API (ej. "/api/v1/uploads/r2/Soporte_carga/..." o
 * "/api/v1/proveedores/{id}/inventario/borrador-carga/imagenes/{imagenId}"). Con null no hace nada.
 */
export function useImagenPrivada(path: string | null): ImagenPrivada {
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    if (!path) return;
    let vivo = true;
    retener(path);
    cargarImagenPrivada(path).then(
      (url) => {
        if (vivo) setResultado({ ruta: path, url, error: url === null });
      },
      () => {
        if (vivo) setResultado({ ruta: path, url: null, error: true });
      },
    );
    return () => {
      vivo = false;
      soltar(path);
    };
  }, [path]);

  if (!path) return { url: null, cargando: false, error: false };
  if (resultado && resultado.ruta === path) {
    return { url: resultado.url, cargando: false, error: resultado.error };
  }
  const enCacheUrl = imagenPrivadaEnCache(path);
  if (enCacheUrl) return { url: enCacheUrl, cargando: false, error: false };
  return { url: null, cargando: true, error: false };
}

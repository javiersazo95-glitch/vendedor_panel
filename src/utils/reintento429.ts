/**
 * H32 (pruebas de lanzamiento, 29-sep): el backend limita `/api/v1/proveedores/**` a 120
 * peticiones por minuto por IP (SEC-BACKEND-073, contra la enumeración de ids). La subida
 * masiva de fotos hace dos por producto, así que un catálogo de más de ~60 productos con foto
 * chocaba con el límite y el panel daba esas fotos por perdidas al primer 429.
 *
 * El límite queda como está: acá el 429 se trata como "espera y vuelve a intentar", con la
 * pausa que indica `Retry-After` (el backend la envía desde H32).
 */

const ESPERA_POR_DEFECTO_S = 5;
const ESPERA_MAXIMA_S = 60;
const INTENTOS_POR_DEFECTO = 8;

/** Segundos a esperar según `Retry-After` (entero o fecha HTTP), acotados a [1, 60]. */
export function segundosDeEspera(respuesta: Response): number {
  const valor = respuesta.headers.get('Retry-After');
  let segundos = ESPERA_POR_DEFECTO_S;
  if (valor) {
    const numero = Number(valor);
    if (Number.isFinite(numero)) {
      segundos = numero;
    } else {
      const fecha = Date.parse(valor);
      if (!Number.isNaN(fecha)) segundos = Math.ceil((fecha - Date.now()) / 1000);
    }
  }
  return Math.min(ESPERA_MAXIMA_S, Math.max(1, Math.ceil(segundos)));
}

export interface OpcionesReintento {
  intentos?: number;
  /** Avisa que se va a esperar, para mostrarlo en pantalla. */
  onEspera?: (segundos: number) => void;
  esperar?: (ms: number) => Promise<void>;
}

/**
 * Ejecuta la petición y, si responde 429, espera y la repite. Devuelve la última respuesta
 * (que puede seguir siendo 429 si se agotaron los intentos). Cualquier otro estado se
 * devuelve tal cual, sin reintentar: un 400 o un 404 no se arreglan esperando.
 */
export async function conReintento429(
  hacer: () => Promise<Response>,
  { intentos = INTENTOS_POR_DEFECTO, onEspera, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }: OpcionesReintento = {},
): Promise<Response> {
  let respuesta = await hacer();
  for (let i = 1; i < intentos && respuesta.status === 429; i++) {
    const segundos = segundosDeEspera(respuesta);
    onEspera?.(segundos);
    // Un poco de dispersión para que las subidas en paralelo no reintenten todas juntas.
    await esperar(segundos * 1000 + Math.floor(Math.random() * 400));
    respuesta = await hacer();
  }
  return respuesta;
}

/**
 * Escapa un segmento antes de interpolarlo en una URL de la API.
 *
 * Los IDs que usamos (sellerId, product.id, jobId, etc.) hoy los asigna el backend, pero
 * el cliente no puede garantizar que nunca traigan "/", "?" o "#": sin este escape, un valor
 * asi alteraria la ruta o el query real enviado al servidor sin que nadie lo note.
 */
export function encId(value: string | number): string {
  return encodeURIComponent(String(value));
}

/** Dominio de la pasarela de pago. El subdominio cambia entre sandbox y produccion. */
const PASARELA_HOST = 'flow.cl';

/**
 * Confirma que una URL de cobro sea un destino legitimo antes de mandar ahi al vendedor.
 *
 * El panel se abandona a si mismo con `window.location.href` justo antes de pagar, que es
 * donde una redireccion desviada valdria mas para un atacante (SEC-MARKET-C07). La URL la
 * emite el backend, asi que esto es defensa en profundidad: si esa respuesta llegara
 * alterada, el vendedor no termina escribiendo sus datos en un formulario de pago ajeno.
 *
 * Hay dos destinos validos y no uno solo:
 *
 *  1. La pasarela. Se compara el host completo y no un "contiene": `evilflow.cl` y
 *     `flow.cl.attacker.com` no pasan.
 *  2. **El propio backend.** Cuando la pasarela corre en modo simulado —perfil local o dev,
 *     sin claves de Flow— no devuelve una URL de flow.cl sino una del backend mismo
 *     (`/api/v1/pagos/flow/retorno?token=mock_...`). Es el mismo origen con el que el panel
 *     ya habla para todo lo demas, asi que no es una redireccion abierta; dejarlo fuera
 *     hacia imposible probar la recarga en local.
 */
export function esDestinoDePagoPermitido(valor: string, origenBackend: string): boolean {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return false;
  }

  try {
    if (url.origin === new URL(origenBackend).origin) return true;
  } catch {
    // Un origen de backend mal formado no valida nada: se sigue con el control de la pasarela.
  }

  if (url.protocol !== 'https:') return false;
  return url.hostname === PASARELA_HOST || url.hostname.endsWith(`.${PASARELA_HOST}`);
}

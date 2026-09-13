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

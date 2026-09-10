/**
 * RUT chileno: formato y dígito verificador.
 *
 * Es el mismo par de funciones que ya tenían el market web (`services/adapters.js`) y la app
 * (`isValidRut`). Se repite acá y no se importa porque son repos distintos, pero el algoritmo
 * tiene que ser el mismo: el backend valida con módulo 11 antes de cobrar, así que un panel más
 * permisivo solo conseguiría que el vendedor descubra el error después de apretar "Pagar".
 */

/** Deja el RUT como se escribe en Chile: 12.345.678-9. */
export function formatRut(value: string): string {
  if (!value) return '';
  const cleaned = String(value).replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9);
  if (cleaned.length <= 1) return cleaned;
  const body = cleaned.slice(0, -1);
  const verifier = cleaned.slice(-1);
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${verifier}`;
}

/** Verifica el dígito verificador (módulo 11), no solo el formato. */
export function isValidRut(value: string): boolean {
  const clean = String(value || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 8) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const expectedValue = 11 - (sum % 11);
  const expected = expectedValue === 11 ? '0' : expectedValue === 10 ? 'K' : String(expectedValue);
  return dv === expected;
}

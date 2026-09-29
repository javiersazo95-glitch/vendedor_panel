/**
 * Nombres de marcas y modelos de vehículo con la misma regla que el backend
 * (`NombreCatalogo.clave` y la tabla de alias, Fase 5 del plan de auditoría de carga).
 *
 * El catálogo ya viene con un solo nombre por marca y modelo, pero el panel igual lo protege:
 * un "Mazda 2" y un "Mazda2" en la lista son dos opciones para el mismo auto, y una persona
 * mayor no tiene cómo saber cuál elegir.
 */
import { normalizarParaComparar } from './plantillaCatalogos';

/**
 * Cómo escriben algunas marcas el padrón y el SII, y cómo se llaman en el catálogo. Es la misma
 * tabla del backend: sólo marcas que no se parecen letra a letra ("KIA MOTORS" no es "Kia").
 */
export const ALIAS_MARCAS_VEHICULO: Record<string, string> = {
  'KIA MOTORS': 'Kia',
  'SANYANG SYM': 'SYM',
};

/** Sin tildes, mayúsculas ni separadores: "Mazda 2", "MAZDA2" y "mazda-2" dan "mazda2". */
export function claveCatalogo(valor: string): string {
  return normalizarParaComparar(valor).replace(/\s+/g, '');
}

const ALIAS_POR_CLAVE = new Map(
  Object.entries(ALIAS_MARCAS_VEHICULO).map(([alias, canonica]) => [claveCatalogo(alias), canonica]),
);

/** "KIA MOTORS" → "Kia"; cualquier otra marca vuelve tal cual. */
export function marcaCanonica(valor: string): string {
  return ALIAS_POR_CLAVE.get(claveCatalogo(valor)) ?? valor;
}

/** Misma marca o modelo aunque esté escrito distinto ("MERCEDES BENZ" y "Mercedes-Benz"). */
export function mismoNombreCatalogo(a: string, b: string): boolean {
  return claveCatalogo(marcaCanonica(a)) === claveCatalogo(marcaCanonica(b));
}

/**
 * Una sola vez cada nombre (gana el primero que llega, que es el del catálogo) y en orden
 * alfabético español, con los números en su orden natural: "Mazda2" antes que "Mazda6",
 * "208" antes que "2008".
 */
export function nombresUnicosOrdenados(nombres: string[]): string[] {
  const porClave = new Map<string, string>();
  for (const nombre of nombres) {
    const limpio = String(nombre ?? '').trim();
    const clave = claveCatalogo(limpio);
    if (!clave || porClave.has(clave)) continue;
    porClave.set(clave, limpio);
  }
  return Array.from(porClave.values()).sort((a, b) =>
    a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true }),
  );
}

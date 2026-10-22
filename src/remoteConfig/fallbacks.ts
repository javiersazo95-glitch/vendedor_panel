/**
 * Fallbacks locales de la configuración remota (plan del Mantenedor común, D.0 y D.2).
 *
 * Regla central: las constantes que el panel tenía hardcodeadas no se borran, se renombran a
 * `*_FALLBACK` y se usan cuando el bootstrap del Mantenedor no está disponible (API caída, build
 * viejo, backend sin el endpoint todavía). Así el panel se comporta exactamente como hoy aunque
 * nunca llegue la configuración remota.
 *
 * Las tarifas (`comision.*`, `pasarela.*`) viven en `utils/pricing.ts` como fallback propio:
 * `pricing` lee el store y este archivo no puede importar `pricing` sin un ciclo.
 */
import { MARCAS_VEHICULO_BASE } from '../utils/marcasVehiculoBase';
import type { MarcaVehiculoDTO, OpcionListaDTO } from './types';

/** Marcas de repuesto sugeridas mientras no responde `/catalogos/inventario/marcas-repuesto`. */
export const PART_BRANDS_FALLBACK: readonly string[] = [
  'Bosch',
  'NGK',
  'TRW',
  'Monroe',
  'Varta',
  'SKF',
  'Gates',
  'Febi',
  'Mann-Filter',
  'Brembo',
  'Sachs',
  'Valeo',
  'Delphi',
  'Denso',
  'Hella',
  'Continental',
  'Goodyear',
  'ACDelco',
];

/** Marcas de vehículo del 1 a 1 cuando ni el catálogo ni el bootstrap responden. */
export const VEHICLE_BRANDS_FALLBACK: readonly string[] = [
  'Toyota',
  'Hyundai',
  'Kia',
  'Nissan',
  'Chevrolet',
  'Ford',
  'Honda',
  'Mazda',
  'Mitsubishi',
  'Volkswagen',
  'Mercedes-Benz',
  'BMW',
];

/** Modelos por marca para el 1 a 1 cuando `/marcas-vehiculo/{id}/modelos` no responde. */
export const MODELS_FALLBACK: Readonly<Record<string, readonly string[]>> = {
  Toyota: ['Corolla', 'Hilux', 'RAV4', 'Yaris'],
  Hyundai: ['Accent', 'Elantra', 'Tucson', 'Santa Fe'],
  Kia: ['Rio', 'Sportage', 'Sorento', 'Cerato'],
  Nissan: ['Versa', 'Sentra', 'Frontier', 'X-Trail'],
  Chevrolet: ['Spark', 'Sail', 'Tracker', 'Colorado'],
  Ford: ['Ranger', 'Escape', 'Explorer', 'F-150'],
  Honda: ['Civic', 'CR-V', 'HR-V', 'Accord'],
  Mazda: ['Mazda 2', 'Mazda 3', 'CX-5', 'BT-50'],
  Mitsubishi: ['L200', 'Outlander', 'Montero', 'ASX'],
  Volkswagen: ['Gol', 'Jetta', 'Tiguan', 'Amarok'],
  'Mercedes-Benz': ['Clase C', 'Sprinter', 'GLC', 'Clase E'],
  BMW: ['Serie 3', 'X1', 'X3', 'Serie 5'],
};

/**
 * Garantía del producto (2026-10-19). Parte en 6 meses: los repuestos nuevos ya tienen esa
 * garantía legal, y una opción menor haría creer al comprador que tiene menos protección. El
 * backend guarda el texto tal cual (máximo 80 caracteres); "Otra" deja escribirla a mano. Son
 * las mismas opciones de la app y el Market, y las semillas de la lista `GARANTIA_PRODUCTO`.
 */
export const GARANTIA_OPCIONES_FALLBACK = [
  '6 meses (garantía legal)',
  '1 año',
  '2 años',
  '3 años',
  'Garantía del fabricante',
] as const;

/** Arma una opción de lista a partir de un valor y su etiqueta, como las que manda el backend. */
export function opcionLista(valor: string, etiqueta: string = valor, orden = 0, esDefault = false): OpcionListaDTO {
  return { valor, etiqueta, descripcion: null, orden, esDefault, iconoUrl: null, color: null, metadata: null };
}

/**
 * Listas de desplegables que el panel usa hoy, con los valores que tenía hardcodeados. Sólo las
 * que el panel consume: las demás listas del contrato (couriers, bancos...) no se usan acá.
 */
export const LISTAS_FALLBACK: Readonly<Record<string, readonly OpcionListaDTO[]>> = {
  CONDICION_PRODUCTO: [
    opcionLista('ORIGINAL', 'Original', 0, true),
    opcionLista('ALTERNATIVO', 'Alternativo', 1),
  ],
  TIPO_PRECIO: [
    opcionLista('MOSTRAR_PRECIO', 'Mostrar precio', 0, true),
    opcionLista('SOLO_COTIZAR', 'Sólo cotizar', 1),
  ],
  GARANTIA_PRODUCTO: GARANTIA_OPCIONES_FALLBACK.map((valor, orden) => opcionLista(valor, valor, orden, orden === 0)),
};

/** Slug con la misma regla que la migración del backend (`lower` + no alfanuméricos a guion). */
export function slugDe(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Las 261 marcas de `utils/marcasVehiculoBase.ts` con la forma del bootstrap. Sin `id` real
 * (`0`): quien necesite pedir modelos por id debe usar el catálogo `/marcas-vehiculo`, no esto.
 */
export const MARCAS_VEHICULO_FALLBACK: readonly MarcaVehiculoDTO[] = MARCAS_VEHICULO_BASE.map((nombre, orden) => ({
  id: 0,
  nombre,
  slug: slugDe(nombre),
  orden,
  iconoUrl: null,
  color: null,
  destacada: false,
}));

import type { Product } from '../db';
import { getProductTopStatus } from './productTop';

/**
 * Orden por defecto del Inventario General.
 *
 * Hasta ahora el panel no ordenaba nada: mostraba el orden en que llegaban del backend, que es
 * `updatedAt DESC`. O sea, arriba quedaba lo último que el vendedor tocó, no lo que le importa.
 *
 * El orden "recomendado" pone adelante lo que cuesta plata y lo que no se puede vender:
 *
 *  1. **Top vencido** — es lo único que YA está costando: pagó por una posición que dejó de
 *     tener, y renovarla es un clic.
 *  2. **Top vigente**, del que menos días le quedan al que más. "Los Top primero" a secas dejaría
 *     al que vence mañana en cualquier parte de la lista.
 *  3. **Necesita atención** — sin stock y pausados: lo que directamente no se puede comprar.
 *  4. **Stock bajo** — se vende, solo hay que reponer.
 *  5. **El resto**, por última modificación, que es el orden que el panel tenía siempre.
 *
 * El stock bajo va aparte de "necesitan atención" y no adentro. Con un catálogo real -- 149
 * repuestos, 54 de ellos bajo 10 unidades -- meterlo ahí dejaba a más de un tercio del inventario
 * marcado como urgente, y un grupo que ocupa un tercio de la lista ya no señala nada. Separado,
 * "necesitan atención" vuelve a ser la lista corta sobre la que hay que hacer algo hoy.
 *
 * `updatedAt DESC` no se tira a la basura: sigue siendo el desempate dentro de los grupos 3, 4 y
 * 5, y es un modo aparte porque después de una carga masiva lo que el vendedor quiere ver es lo
 * que acaba de subir, no sus productos Top.
 */

export type OrdenInventario = 'recomendado' | 'reciente';

export type GrupoInventario = 'top-vencido' | 'top-vigente' | 'atencion' | 'stock-bajo' | 'resto' | 'todos';

/** Umbral de "stock bajo". Es el mismo con el que la tabla pinta el badge ámbar. */
const STOCK_BAJO = 10;

export const ETIQUETAS_GRUPO: Record<GrupoInventario, string> = {
  'top-vencido': 'Tu insignia Top venció · renuévala para recuperar la prioridad',
  'top-vigente': 'Tus productos Top · con prioridad en las búsquedas',
  atencion: 'Necesitan tu atención · nadie puede comprarlos así',
  'stock-bajo': 'Stock bajo · conviene reponer',
  resto: 'Resto del inventario',
  todos: 'Tu inventario, del más reciente al más antiguo',
};

/** Orden de los grupos. El índice es la prioridad: más chico, más arriba. */
const PRIORIDAD: GrupoInventario[] = ['top-vencido', 'top-vigente', 'atencion', 'stock-bajo', 'resto'];

function modificadoEn(product: Product): number {
  const fecha = product.lastUpdated ? new Date(product.lastUpdated).getTime() : NaN;
  // Sin fecha legible se manda al fondo de su grupo en vez de arriba: no se sabe si es reciente.
  return Number.isNaN(fecha) ? 0 : fecha;
}

/** Sin stock antes que pausado: el pausado lo decidió el vendedor, el otro se le pasó. */
function urgenciaDeAtencion(product: Product): number {
  return product.stock === 0 ? 0 : 1;
}

export function grupoDe(product: Product, now = Date.now()): GrupoInventario {
  const top = getProductTopStatus(product, now);
  if (top.state === 'expired') return 'top-vencido';
  if (top.state === 'active') return 'top-vigente';
  if (product.stock === 0 || product.pausado) return 'atencion';
  if (product.stock < STOCK_BAJO) return 'stock-bajo';
  return 'resto';
}

export interface InventarioOrdenado {
  productos: Product[];
  /** A qué grupo quedó cada producto, para que la lista pueda mostrar los separadores. */
  grupos: Map<string, GrupoInventario>;
}

export function ordenarInventario(products: Product[], orden: OrdenInventario = 'recomendado', now = Date.now()): InventarioOrdenado {
  if (orden === 'reciente') {
    return {
      productos: [...products].sort((a, b) => modificadoEn(b) - modificadoEn(a)),
      grupos: new Map(products.map((product) => [product.id, 'todos' as GrupoInventario])),
    };
  }

  const grupos = new Map<string, GrupoInventario>();
  for (const product of products) grupos.set(product.id, grupoDe(product, now));

  const productos = [...products].sort((a, b) => {
    const grupoA = grupos.get(a.id) as GrupoInventario;
    const grupoB = grupos.get(b.id) as GrupoInventario;
    if (grupoA !== grupoB) return PRIORIDAD.indexOf(grupoA) - PRIORIDAD.indexOf(grupoB);

    if (grupoA === 'top-vigente') {
      // El que está por vencer va primero: es el que se pierde si nadie lo mira.
      const venceA = getProductTopStatus(a, now).expiresAt?.getTime() ?? Infinity;
      const venceB = getProductTopStatus(b, now).expiresAt?.getTime() ?? Infinity;
      if (venceA !== venceB) return venceA - venceB;
    }

    if (grupoA === 'top-vencido') {
      // El que venció recién primero: es el que el vendedor todavía tiene fresco.
      const venceA = getProductTopStatus(a, now).expiresAt?.getTime() ?? 0;
      const venceB = getProductTopStatus(b, now).expiresAt?.getTime() ?? 0;
      if (venceA !== venceB) return venceB - venceA;
    }

    if (grupoA === 'atencion') {
      const urgenciaA = urgenciaDeAtencion(a);
      const urgenciaB = urgenciaDeAtencion(b);
      if (urgenciaA !== urgenciaB) return urgenciaA - urgenciaB;
    }

    return modificadoEn(b) - modificadoEn(a);
  });

  return { productos, grupos };
}

/**
 * "Cambiar precios y stock" (antes Actualización Rápida / Express): lectura del archivo del
 * vendedor y armado de los cambios, sin tocar nada todavía.
 *
 * Fase 6 del plan de auditoría de carga. Antes este modo leía el precio con `Number()`, así que
 * "4.990" se guardaba como 4,99 pesos y pasaba en verde; exigía los encabezados exactos `sku`,
 * `precio`, `stock`; y un producto "Sólo cotizar" no se podía actualizar porque su precio 0 era
 * un error. Ahora:
 *
 * - Las columnas se reconocen con los mismos sinónimos de la plantilla ("Código", "Precio Venta",
 *   "Cantidad").
 * - Los números se leen como se escriben en Chile (`normalizarNumero`, el mismo criterio del
 *   backend): "$ 12.900" es 12900. Si un punto se leyó como separador de miles, se avisa con el
 *   número final.
 * - Retener o avisar: un precio con decimales o un stock que no es entero casi seguro están mal,
 *   y la fila se retiene. Lo que puede estar bien (un código que no está en el inventario, un
 *   producto pausado) sólo se avisa.
 */
import type { Product } from '../db';
import { autoDetectMapping, PLANTILLA_CAMPOS, type UserColumn } from './plantillaMapping';
import { normalizarNumero } from './plantillaNormalizacion';

/** El único nombre del modo, en todas las pantallas. */
export const NOMBRE_EXPRESS = 'Cambiar precios y stock';

export interface ColumnasExpress {
  sku: number | null;
  precio: number | null;
  stock: number | null;
}

/** Una fila que se retiene: no se manda y el vendedor ve por qué. */
export interface FilaRetenida {
  fila: number;
  sku: string;
  motivo: string;
}

/** Un cambio listo para confirmar. `null` en precio o stock = ese dato no se toca. */
export interface CambioExpress {
  fila: number;
  sku: string;
  nombre: string;
  precioAntes: number;
  precioDespues: number | null;
  stockAntes: number;
  stockDespues: number | null;
  soloCotizar: boolean;
  avisos: string[];
}

export interface AnalisisExpress {
  cambios: CambioExpress[];
  retenidas: FilaRetenida[];
  /** Códigos que no están en el inventario: se omiten (no se crean productos acá). */
  noEncontrados: FilaRetenida[];
  /** Filas cuyo precio y stock ya eran esos: no hay nada que mandar. */
  sinCambios: number;
}

const CAMPOS_EXPRESS = PLANTILLA_CAMPOS.filter((c) => ['sku_proveedor', 'precio', 'stock'].includes(c.key));

/** Qué columna del archivo es el código, el precio y el stock, por su encabezado. */
export function detectarColumnasExpress(encabezados: string[]): ColumnasExpress {
  const userCols: UserColumn[] = encabezados.map((rawHeader, index) => ({
    id: String(index),
    rawHeader: String(rawHeader ?? ''),
    displayHeader: String(rawHeader ?? ''),
    index,
  }));
  const { oficial } = autoDetectMapping(userCols, CAMPOS_EXPRESS);
  const indice = (key: string) => (oficial[key] == null ? null : Number(oficial[key]));
  return { sku: indice('sku_proveedor'), precio: indice('precio'), stock: indice('stock') };
}

const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;
const celda = (fila: unknown[], indice: number | null) =>
  indice == null ? '' : String(fila[indice] ?? '').trim();

type Lectura = { vacio: true } | { vacio: false; numero: number | null; comoMiles: boolean };

/** "4.990 c/u", "$ 12.900", "10 unid": se ignora la unidad escrita detrás del número. */
function leerNumero(texto: string): Lectura {
  if (!texto) return { vacio: true };
  const directo = normalizarNumero(texto);
  if (directo.numero !== null) return { vacio: false, ...directo };
  const m = texto.match(/^([^A-Za-zÀ-ÿ]*\d[\d.,]*)\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ./\s]*$/);
  return m ? { vacio: false, ...normalizarNumero(m[1]) } : { vacio: false, numero: null, comoMiles: false };
}

/**
 * Arma los cambios de un archivo ya leído. `filas` son las filas de datos, sin el encabezado;
 * `primeraFila` es el número de fila de la primera en el Excel (para decirle al vendedor dónde).
 */
export function analizarExpress(
  filas: unknown[][],
  columnas: ColumnasExpress,
  productos: Product[],
  primeraFila = 2,
): AnalisisExpress {
  const porSku = new Map(productos.map((p) => [p.sku.trim().toUpperCase(), p]));
  const vistos = new Set<string>();
  const resultado: AnalisisExpress = { cambios: [], retenidas: [], noEncontrados: [], sinCambios: 0 };

  filas.forEach((fila, i) => {
    const numeroFila = primeraFila + i;
    const sku = celda(fila, columnas.sku);
    const textoPrecio = celda(fila, columnas.precio);
    const textoStock = celda(fila, columnas.stock);
    if (!sku && !textoPrecio && !textoStock) return; // fila en blanco

    const retener = (motivo: string) => resultado.retenidas.push({ fila: numeroFila, sku: sku || '—', motivo });

    if (!sku) {
      retener('Falta el código del repuesto.');
      return;
    }
    const clave = sku.toUpperCase();
    if (vistos.has(clave)) {
      retener('Este código ya aparece más arriba en el archivo. Se usa sólo la primera vez.');
      return;
    }
    vistos.add(clave);

    const producto = porSku.get(clave);
    if (!producto) {
      resultado.noEncontrados.push({
        fila: numeroFila,
        sku,
        motivo: 'No está en tu inventario. Aquí sólo se cambian repuestos que ya publicaste.',
      });
      return;
    }

    const soloCotizar = producto.pricingMode === 'quote_only';
    const avisos: string[] = [];
    let precioDespues: number | null = null;
    let stockDespues: number | null = null;

    const precio = leerNumero(textoPrecio);
    if (!precio.vacio) {
      if (precio.numero === null) {
        retener(`El precio "${textoPrecio}" no es un número.`);
        return;
      }
      if (!Number.isInteger(precio.numero)) {
        retener(`El precio "${textoPrecio}" tiene decimales. Escríbelo en pesos, sin decimales (por ejemplo 4990).`);
        return;
      }
      if (precio.numero <= 0) {
        retener('El precio tiene que ser mayor que cero.');
        return;
      }
      precioDespues = precio.numero;
      if (precio.comoMiles) avisos.push(`El precio "${textoPrecio}" se leyó como ${pesos(precio.numero)}.`);
      if (soloCotizar) avisos.push('Sigue como "Sólo cotizar": el precio no se muestra al comprador.');
    }

    const stock = leerNumero(textoStock);
    if (!stock.vacio) {
      if (stock.numero === null) {
        retener(`El stock "${textoStock}" no es un número.`);
        return;
      }
      if (!Number.isInteger(stock.numero)) {
        retener(`El stock "${textoStock}" no es un número entero de unidades.`);
        return;
      }
      if (stock.numero < 0) {
        retener('El stock no puede ser negativo.');
        return;
      }
      stockDespues = stock.numero;
      if (stock.comoMiles) avisos.push(`El stock "${textoStock}" se leyó como ${stock.numero.toLocaleString('es-CL')} unidades.`);
    }

    if (precioDespues === null && stockDespues === null) {
      retener(soloCotizar ? 'Falta el stock.' : 'Faltan el precio y el stock.');
      return;
    }
    if (precioDespues === producto.price) precioDespues = null;
    if (stockDespues === producto.stock) stockDespues = null;
    if (precioDespues === null && stockDespues === null) {
      resultado.sinCambios += 1;
      return;
    }

    if (producto.pausado || producto.activo === false) {
      avisos.push('Está pausado y sigue pausado: el cambio se guarda, pero no se muestra hasta que lo actives.');
    }

    resultado.cambios.push({
      fila: numeroFila,
      sku: producto.sku,
      nombre: producto.name,
      precioAntes: producto.price,
      precioDespues,
      stockAntes: producto.stock,
      stockDespues,
      soloCotizar,
      avisos,
    });
  });

  return resultado;
}

/** Lo que se manda al backend: sólo los datos que cambian (`null` = no tocar). */
export function itemsParaEnviar(cambios: CambioExpress[]) {
  return cambios.map((c) => ({ skuProveedor: c.sku, precio: c.precioDespues, stock: c.stockDespues }));
}

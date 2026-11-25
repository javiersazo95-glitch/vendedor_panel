/**
 * Carga masiva "Con códigos del fabricante": de la lista del vendedor (código, marca, precio, stock) y de lo que el
 * backend reconoció, al mismo Excel de la plantilla de RepuesTop. Publicar sigue siendo el camino de siempre.
 */
import { COLUMNAS_COMPATIBILIDADES } from './plantillaCompatibilidad';
import type { EsquemaPlantilla } from './plantillaMapping';
import { condicionDesdeTexto } from './condicionProducto';
import { sanitizeAoaForExport } from './xlsxSafety';
import { esModoInvitado } from './session';
import { descripcionPropuesta, nombrePropuesto, type FichaCodigo, type GrupoVehiculo, type ItemLote } from './fichaCodigoApi';

export interface FilaCodigo {
  codigo: string;
  marca: string;
  /** null = vacío o ilegible: se completa después. */
  precio: number | null;
  stock: number | null;
  sku: string;
  condicion: string;
  garantia: string;
}

type Columna = keyof FilaCodigo;

/** Cómo titulan esas columnas las listas de los vendedores. */
const TITULOS: Record<Columna, string[]> = {
  codigo: ['codigo', 'codigo fabricante', 'codigo del fabricante', 'codigo de fabrica', 'codigo caja', 'codigo de la caja', 'cod', 'cod fabricante',
    'numero de parte', 'n de parte', 'part number', 'part no', 'referencia', 'ref', 'codigo_fabricante', 'codigo producto', 'codigo de barras', 'ean'],
  marca: ['marca', 'marca repuesto', 'marca del repuesto', 'fabricante', 'brand', 'marca_repuesto'],
  precio: ['precio', 'precio venta', 'precio de venta', 'valor', 'pvp', 'precio publico', 'price'],
  stock: ['stock', 'cantidad', 'cant', 'existencia', 'existencias', 'unidades', 'qty', 'inventario'],
  sku: ['sku', 'sku proveedor', 'sku_proveedor', 'codigo interno', 'cod interno', 'codigo tienda'],
  condicion: ['condicion', 'estado', 'tipo'],
  garantia: ['garantia', 'meses garantia'],
};
const ORDEN_SIN_TITULOS: Columna[] = ['codigo', 'marca', 'precio', 'stock'];

const normal = (v: unknown) => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[°º.:]/g, '').replace(/\s+/g, ' ');

/** "$ 32.990" -> 32990. En pesos no hay centavos: "15990,5" no se adivina. */
export function enteroDe(valor: unknown): number | null {
  const t = String(valor ?? '').replace(/[$\s]/g, '').replace(/clp$/i, '');
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ''));
  if (/^\d+[.,]0+$/.test(t)) return Number(t.split(/[.,]/)[0]);
  return null;
}

export interface LecturaCodigos { filas: FilaCodigo[]; sinCodigo: number; repetidas: number; conTitulos: boolean }

/** Lee la hoja (o lo pegado). La fila de títulos puede no ser la primera, y puede no haber. */
export function leerFilasDeCodigos(aoa: unknown[][]): LecturaCodigos {
  const filas = aoa.filter((f) => Array.isArray(f) && f.some((c) => String(c ?? '').trim() !== ''));
  let mapa: Partial<Record<Columna, number>> = {};
  let inicio = 0;
  let conTitulos = false;
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const encontrado: Partial<Record<Columna, number>> = {};
    filas[i].forEach((celda, c) => {
      const t = normal(celda);
      for (const columna of Object.keys(TITULOS) as Columna[]) {
        if (encontrado[columna] === undefined && TITULOS[columna].includes(t)) { encontrado[columna] = c; break; }
      }
    });
    if (encontrado.codigo !== undefined) {
      mapa = encontrado;
      inicio = i + 1;
      conTitulos = true;
      break;
    }
  }
  if (!conTitulos) ORDEN_SIN_TITULOS.forEach((c, i) => { mapa[c] = i; });
  const leer = (f: unknown[], c: Columna) => (mapa[c] === undefined ? '' : String(f[mapa[c] as number] ?? '').trim());
  const salida: FilaCodigo[] = [];
  const vistas = new Set<string>();
  let sinCodigo = 0;
  let repetidas = 0;
  for (const f of filas.slice(inicio)) {
    const codigo = leer(f, 'codigo');
    if (codigo.replace(/[^A-Za-z0-9]/g, '').length < 3) { sinCodigo += 1; continue; }
    const marca = leer(f, 'marca');
    const sku = leer(f, 'sku');
    const clave = `${codigo.toUpperCase().replace(/[^A-Z0-9]/g, '')}|${normal(marca)}|${sku.toUpperCase()}`;
    if (vistas.has(clave)) { repetidas += 1; continue; }
    vistas.add(clave);
    salida.push({
      codigo, marca, sku, precio: enteroDe(leer(f, 'precio')), stock: enteroDe(leer(f, 'stock')),
      condicion: condicionDesdeTexto(leer(f, 'condicion')) ?? '', garantia: leer(f, 'garantia'),
    });
  }
  return { filas: salida, sinCodigo, repetidas, conTitulos };
}

/** Lo pegado desde Excel (tabulaciones) o escrito a mano (punto y coma). */
export function aoaDesdeTexto(texto: string): string[][] {
  return texto.split(/\r?\n/).filter((l) => l.trim()).map((l) => (l.includes('\t') ? l.split('\t') : l.split(';')).map((c) => c.trim()));
}

/* ---- La lista en curso, para salir y volver. En modo invitado no queda al cerrar la pestaña de soporte. ---- */

/** Lo que el vendedor decidió en pantalla, por número de fila. */
export interface AjusteCodigo { precio?: string; stock?: string; categoria?: string; grupos?: number[]; fuera?: boolean }
export interface ListaGuardada {
  loteId: string;
  filas: FilaCodigo[];
  ajustes: Record<number, AjusteCodigo>;
  condicion: string;
  garantia: string;
  /** Las filas que fueron en el último Excel armado: al publicarse quedan fuera para no repetirlas. */
  enviadas?: number[];
}

const almacen = () => (esModoInvitado() ? sessionStorage : localStorage);
const claveLista = (sellerId: string) => `repuestop_codigos_${sellerId}`;

export function leerLista(sellerId?: string): ListaGuardada | null {
  if (!sellerId) return null;
  try {
    const g = JSON.parse(almacen().getItem(claveLista(sellerId)) ?? 'null');
    return g && typeof g.loteId === 'string' && Array.isArray(g.filas) ? g : null;
  } catch {
    return null;
  }
}

export function guardarLista(sellerId: string, lista: ListaGuardada): void {
  try { almacen().setItem(claveLista(sellerId), JSON.stringify(lista)); } catch { /* sin espacio sólo se pierde poder retomar */ }
}

export function olvidarLista(sellerId?: string): void {
  if (!sellerId) return;
  try { almacen().removeItem(claveLista(sellerId)); } catch { /* nada que olvidar */ }
}

/** Al publicar: lo enviado sale de la lista; si no queda nada por hacer, la lista se olvida. */
export function marcarPublicada(sellerId?: string): void {
  const lista = leerLista(sellerId);
  if (!sellerId || !lista?.enviadas?.length) return;
  const ajustes = { ...lista.ajustes };
  for (const orden of lista.enviadas) ajustes[orden] = { ...ajustes[orden], fuera: true };
  if (lista.filas.every((_, i) => ajustes[i]?.fuera)) { olvidarLista(sellerId); return; }
  guardarLista(sellerId, { ...lista, ajustes, enviadas: undefined });
}

/** Una fila lista para el Excel: lo del vendedor, lo reconocido y lo que se decidió en pantalla. */
export interface FilaArmada {
  fila: FilaCodigo;
  item: ItemLote;
  precio: number | null;
  stock: number | null;
  categoria: string;
  subcategoria: string;
  grupos: GrupoVehiculo[];
}

const limpiarSku = (v: string) => v.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9\-_/]/g, '').slice(0, 30);

/** SKU de cada fila: el del vendedor o el código; si dos quedan iguales (mismo código, otra marca) se distinguen por la marca. */
export function skusDe(filas: FilaArmada[]): string[] {
  const usados = new Set<string>();
  return filas.map(({ fila, item }) => {
    const base = limpiarSku(fila.sku || item.ficha?.codigo || fila.codigo);
    let sku = base;
    if (usados.has(sku)) sku = limpiarSku(`${base.slice(0, 22)}-${item.ficha?.marca ?? fila.marca}`);
    for (let n = 2; usados.has(sku); n++) sku = `${base.slice(0, 26)}-${n}`;
    usados.add(sku);
    return sku;
  });
}

export function construirFilasPlantilla(
  filas: FilaArmada[], esquema: EsquemaPlantilla, generales: { condicion: string; garantia: string },
): { inventario: (string | number)[][]; compatibilidades: (string | number)[][] } {
  const columnas = esquema.columnas.includes('codigo_fabricante') ? esquema.columnas : [...esquema.columnas, 'codigo_fabricante'];
  const inventario: (string | number)[][] = [columnas];
  const compatibilidades: (string | number)[][] = [[...COLUMNAS_COMPATIBILIDADES]];
  const skus = skusDe(filas);
  const marcaDeCatalogo = new Map(esquema.catalogos.marcasRepuesto.map((m) => [normal(m).replace(/[\s\-_./]/g, ''), m]));
  filas.forEach(({ fila, item, precio, stock, categoria, subcategoria, grupos }, i) => {
    const ficha: FichaCodigo | null = item.ficha;
    const [primero, ...resto] = grupos;
    const marca = ficha?.marca ?? fila.marca;
    const valores: Record<string, string | number> = {
      nombre_publicado: ficha ? nombrePropuesto(ficha, 120) : '',
      categoria, subcategoria,
      marca_repuesto: marcaDeCatalogo.get(normal(marca).replace(/[\s\-_./]/g, '')) ?? marca,
      sku_proveedor: skus[i],
      referencia_oem: ficha?.referenciaOem ?? '',
      tipo_precio: 'MOSTRAR_PRECIO',
      precio: precio ?? '', stock: stock ?? '',
      condicion: fila.condicion || generales.condicion,
      compatibilidad_general: 'NO',
      compatibilidad_marca: primero?.marca ?? '', compatibilidad_modelo: primero?.modelo ?? '',
      anio_desde: primero?.anioDesde ?? '', anio_hasta: primero?.anioHasta ?? '', motor: primero?.motor ?? '',
      descripcion: ficha ? descripcionPropuesta(ficha, grupos) : '',
      requiere_chasis: 'NO',
      garantia: fila.garantia || generales.garantia,
      codigo_fabricante: ficha?.codigo ?? fila.codigo,
    };
    inventario.push(columnas.map((c) => valores[c] ?? ''));
    resto.forEach((g) => compatibilidades.push([
      skus[i], g.marca, g.modelo, g.anioDesde ?? '', g.anioHasta ?? '', g.motor ?? '', ficha?.referenciaOem ?? '',
    ]));
  });
  return { inventario, compatibilidades };
}

/** El libro con las mismas hojas de la plantilla: el asistente lo reconoce y salta directo a completar. */
export async function construirExcelConCodigos(
  filas: FilaArmada[], esquema: EsquemaPlantilla, generales: { condicion: string; garantia: string }, nombre: string,
): Promise<File> {
  const XLSX = await import('xlsx');
  const { inventario, compatibilidades } = construirFilasPlantilla(filas, esquema, generales);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(sanitizeAoaForExport(inventario)), 'inventario');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(sanitizeAoaForExport(compatibilidades)), 'compatibilidades');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
    [`VERSION_PLANTILLA: ${esquema.version}`], ['Archivo armado por el panel con los códigos del fabricante.'],
  ]), 'instrucciones');
  const bytes = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
  return new File([bytes], nombre, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** La plantilla corta para descargar. */
export async function plantillaDeCodigos(): Promise<Blob> {
  const XLSX = await import('xlsx');
  const hoja = XLSX.utils.aoa_to_sheet([['codigo', 'marca', 'precio', 'stock', 'sku', 'condicion', 'garantia']]);
  hoja['!cols'] = [20, 18, 12, 10, 18, 16, 24].map((wch) => ({ wch }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'codigos');
  return new Blob([XLSX.write(libro, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function excelDeNoEncontrados(filas: FilaCodigo[]): Promise<Blob> {
  const XLSX = await import('xlsx');
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(sanitizeAoaForExport([
    ['codigo', 'marca', 'precio', 'stock', 'sku', 'condicion', 'garantia'],
    ...filas.map((f) => [f.codigo, f.marca, f.precio ?? '', f.stock ?? '', f.sku, f.condicion, f.garantia]),
  ])), 'no encontrados');
  return new Blob([XLSX.write(libro, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

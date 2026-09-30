/**
 * Lo que el asistente "Mi propio Excel" descubre mirando el archivo del vendedor, en
 * funciones puras.
 *
 * Es la misma lógica que usa `PlantillaMapper` (el adaptador de la ruta "plantilla"), sacada de
 * sus `useMemo` para que el asistente nuevo la reutilice sin copiar el componente entero. Cada
 * función recibe lo que necesita y no guarda nada: así se prueba sola y se recalcula sólo cuando
 * cambian sus entradas.
 */
import {
  filasNoRepuesto,
  type CampoMeta,
  type EsquemaPlantilla,
  type Mapping,
  type UserColumn,
} from './plantillaMapping';
import { pareceColumnaDeRangos, partirRangoAnios } from './plantillaNormalizacion';
import {
  buscarEnCatalogo,
  buscarEnTexto,
  normalizarParaComparar,
  sugerirDelCatalogo,
} from './plantillaCatalogos';
import { aniosDisponibles } from './plantillaVehiculos';
import { detectarBandas, detectarSegundaTabla } from './plantillaFilas';
import { tipoColumnaFotos, type TipoColumnaFotos } from './plantillaFotos';
import {
  detectarAplicacionesMultiples,
  detectarSkusRepetidos,
  pareceColumnaDeAplicacion,
  parsearAplicacion,
  separarAplicaciones,
} from './plantillaCompatibilidad';
import { MARCAS_VEHICULO_BASE } from './marcasVehiculoBase';

const marcasDe = (esquema: EsquemaPlantilla) =>
  (esquema.catalogos.marcasVehiculo?.length ? esquema.catalogos.marcasVehiculo : MARCAS_VEHICULO_BASE);

const colPorId = (cols: UserColumn[], id: string | null | undefined) =>
  (id ? cols.find((c) => c.id === id) : undefined);

const muestraDe = (rows: unknown[][], col: UserColumn, n = 50) =>
  rows.slice(0, n).map((r) => String((r as unknown[])[col.index] ?? ''));

/** ¿La columna que quedó en "año desde" trae rangos en una sola celda? */
export function traeRangosDeAnios(mapping: Mapping, cols: UserColumn[], rows: unknown[][]): boolean {
  const col = colPorId(cols, mapping.oficial.anio_desde);
  if (!col) return false;
  return pareceColumnaDeRangos(muestraDe(rows, col));
}

export interface ColumnaAplicacion {
  col: UserColumn;
  ejemplo?: string;
  partes: ReturnType<typeof parsearAplicacion>;
  necesitaAsignar: boolean;
}

/**
 * Busca la columna que trae la aplicación escrita de corrido ("Toyota Corolla 2014-2020"). Mira
 * primero las que ya quedaron en compatibilidad y después las que el vendedor no asignó a nada.
 */
export function buscarColumnaAplicacion(
  mapping: Mapping,
  userCols: UserColumn[],
  userRows: unknown[][],
  marcas: string[],
): ColumnaAplicacion | null {
  const marcasEfectivas = marcas && marcas.length ? marcas : MARCAS_VEHICULO_BASE;
  if (marcasEfectivas.length === 0) return null;
  const asignadas = new Set(Object.values(mapping.oficial).filter(Boolean) as string[]);
  const candidatas = [
    ...['compatibilidad_modelo', 'compatibilidad_marca']
      .map((key) => colPorId(userCols, mapping.oficial[key]))
      .filter((c): c is UserColumn => !!c)
      .map((col) => ({ col, necesitaAsignar: false })),
    ...userCols.filter((c) => !asignadas.has(c.id)).map((col) => ({ col, necesitaAsignar: true })),
  ];
  for (const { col, necesitaAsignar } of candidatas) {
    const muestra = muestraDe(userRows, col).filter(Boolean);
    if (!pareceColumnaDeAplicacion(muestra, marcasEfectivas)) continue;
    const ejemplo = muestra.find((v) => parsearAplicacion(v, marcasEfectivas));
    return { col, ejemplo, partes: ejemplo ? parsearAplicacion(ejemplo, marcasEfectivas) : null, necesitaAsignar };
  }
  return null;
}

/**
 * Lo que detectamos se aplica de entrada, y el vendedor lo apaga si no corresponde. Las
 * decisiones que ya traía un mapeo guardado mandan sobre la detección.
 */
export function conArreglosPropuestos(
  base: Mapping, cols: UserColumn[], rows: unknown[][], esquema: EsquemaPlantilla,
): Mapping {
  const marcas = marcasDe(esquema);
  const propuesto: Mapping = { ...base, oficial: { ...base.oficial } };

  const aplicacion = buscarColumnaAplicacion(propuesto, cols, rows, marcas);
  if (base.parsearAplicacion === undefined) {
    propuesto.parsearAplicacion = !!aplicacion;
    if (aplicacion?.necesitaAsignar) propuesto.oficial.compatibilidad_modelo = aplicacion.col.id;
  }

  const colSku = colPorId(cols, propuesto.oficial.sku_proveedor);
  if (base.agruparPorSku === undefined) {
    propuesto.agruparPorSku = !!colSku && detectarSkusRepetidos(rows, colSku.index).skus > 0;
  }

  const colModelo = colPorId(cols, propuesto.oficial.compatibilidad_modelo ?? propuesto.oficial.compatibilidad_marca);
  if (base.separarAplicaciones === undefined && colModelo) {
    propuesto.separarAplicaciones = detectarAplicacionesMultiples(muestraDe(rows, colModelo), marcas).celdas > 0;
  }

  propuesto.dividirAnios = base.dividirAnios ?? traeRangosDeAnios(propuesto, cols, rows);

  // Una columna que trae las fotos (enlaces o nombres de archivo) se usa sola, como los otros
  // ajustes detectados. Antes el interruptor venía apagado aunque el Excel tuviera "Foto", y un
  // vendedor que no lo encendía publicaba sin fotos sin enterarse (prueba en local del 30-sep).
  // `null` es que el vendedor lo apagó: eso se respeta.
  if (base.columnaFotos === undefined) {
    const asignadas = new Set(Object.values(propuesto.oficial).filter(Boolean) as string[]);
    const colFotos = cols.find((c) => !asignadas.has(c.id) && tipoColumnaFotos(muestraDe(rows, c).filter(Boolean)) !== null);
    if (colFotos) {
      propuesto.columnaFotos = colFotos.id;
      propuesto.extras = { ...propuesto.extras, [colFotos.id]: 'ignore' };
    }
  }
  return propuesto;
}

export interface Detecciones {
  skusRepetidos: ReturnType<typeof detectarSkusRepetidos> | null;
  columnaAplicacion: ColumnaAplicacion | null;
  aplicacionesMultiples: (ReturnType<typeof detectarAplicacionesMultiples> & { col: UserColumn }) | null;
  datosEnElNombre: {
    col: UserColumn; conMarca: number; conCategoria: number; faltaMarca: boolean; faltaCategoria: boolean;
    filas: number; ejemplo: { texto: string; marca: string | null; categoria: string | null } | null;
  } | null;
  filasDeTotales: { total: number; totales: number; encabezados: number; ejemplo: string } | null;
  bandas: { total: number; titulos: string[] } | null;
  columnaFotos: { col: UserColumn; tipo: Exclude<TipoColumnaFotos, null>; ejemplo: string } | null;
  columnaAniosConRangos: boolean;
  ejemploRangoAnios: string;
  segundaTabla: ReturnType<typeof detectarSegundaTabla>;
  /** Filas que traen marca o modelo del auto: las que perderían el vehículo si todo pasa a universal. */
  filasConVehiculo: number;
}

/** Todo lo que el paso 2 le cuenta al vendedor sobre su archivo, calculado de una vez. */
export function detectar(
  mapping: Mapping, userCols: UserColumn[], userRows: unknown[][], esquema: EsquemaPlantilla,
): Detecciones {
  const { marcasRepuesto, categorias, marcasVehiculo } = esquema.catalogos;

  const colSku = colPorId(userCols, mapping.oficial.sku_proveedor);
  const skusRepetidos = colSku ? detectarSkusRepetidos(userRows, colSku.index) : null;

  const columnaAplicacion = buscarColumnaAplicacion(mapping, userCols, userRows, marcasVehiculo);

  const colMulti = colPorId(userCols, mapping.oficial.compatibilidad_modelo ?? mapping.oficial.compatibilidad_marca);
  const multi = colMulti ? detectarAplicacionesMultiples(muestraDe(userRows, colMulti), marcasVehiculo) : null;
  const aplicacionesMultiples = colMulti && multi && multi.celdas > 0 ? { col: colMulti, ...multi } : null;

  let datosEnElNombre: Detecciones['datosEnElNombre'] = null;
  const colNombre = colPorId(userCols, mapping.oficial.nombre_publicado);
  const faltaMarca = !mapping.oficial.marca_repuesto;
  const faltaCategoria = !mapping.oficial.categoria;
  if (colNombre && (faltaMarca || faltaCategoria)) {
    let conMarca = 0;
    let conCategoria = 0;
    let ejemplo: { texto: string; marca: string | null; categoria: string | null } | null = null;
    const muestra = muestraDe(userRows, colNombre);
    for (const texto of muestra) {
      if (!texto.trim()) continue;
      const marca = faltaMarca ? buscarEnTexto(texto, marcasRepuesto, marcasVehiculo) : null;
      const categoria = faltaCategoria ? buscarEnTexto(texto, categorias) : null;
      if (marca) conMarca += 1;
      if (categoria) conCategoria += 1;
      if (!ejemplo && (marca || categoria)) ejemplo = { texto, marca, categoria };
    }
    if (conMarca > 0 || conCategoria > 0) {
      datosEnElNombre = { col: colNombre, conMarca, conCategoria, faltaMarca, faltaCategoria, filas: muestra.length, ejemplo };
    }
  }

  const fuera = filasNoRepuesto(userRows, userCols, mapping);
  const filasDeTotales = fuera.length === 0 ? null : {
    total: fuera.length,
    totales: fuera.filter((f) => f.motivo === 'totales').length,
    encabezados: fuera.filter((f) => f.motivo === 'encabezado').length,
    ejemplo: fuera[0].texto,
  };

  let bandas: Detecciones['bandas'] = null;
  if (!mapping.oficial.categoria) {
    const encontradas = detectarBandas(userRows, userCols.length);
    const enCatalogo = encontradas.filter((b) => buscarEnCatalogo(b.titulo, categorias));
    if (encontradas.length > 0 && enCatalogo.length > 0 && enCatalogo.length * 2 >= encontradas.length) {
      bandas = { total: encontradas.length, titulos: encontradas.map((b) => b.titulo) };
    }
  }

  let columnaFotos: Detecciones['columnaFotos'] = null;
  const elegida = colPorId(userCols, mapping.columnaFotos);
  const asignadas = new Set(Object.values(mapping.oficial).filter(Boolean) as string[]);
  for (const col of elegida ? [elegida] : userCols.filter((c) => !asignadas.has(c.id))) {
    const muestra = muestraDe(userRows, col).filter(Boolean);
    const tipo = tipoColumnaFotos(muestra);
    if (tipo) {
      columnaFotos = { col, tipo, ejemplo: muestra.find((v) => v.trim()) ?? '' };
      break;
    }
  }

  const columnaAniosConRangos = traeRangosDeAnios(mapping, userCols, userRows);
  let ejemploRangoAnios = '';
  const colAnio = colPorId(userCols, mapping.oficial.anio_desde);
  if (colAnio) {
    for (const bruto of muestraDe(userRows, colAnio)) {
      const rango = partirRangoAnios(bruto);
      if (rango) { ejemploRangoAnios = `"${bruto.trim()}" queda como ${rango.desde} y ${rango.hasta}`; break; }
    }
  }

  const encabezado: string[] = [];
  for (const col of userCols) encabezado[col.index] = col.rawHeader;
  const segundaTabla = detectarSegundaTabla(userRows, encabezado);

  const colsVehiculo = ['compatibilidad_marca', 'compatibilidad_modelo']
    .map((k) => colPorId(userCols, mapping.oficial[k])).filter((c): c is UserColumn => !!c);
  const filasConVehiculo = colsVehiculo.length === 0 ? 0
    : userRows.filter((r) => colsVehiculo.some((c) => String((r as unknown[])[c.index] ?? '').trim())).length;

  return {
    skusRepetidos, columnaAplicacion, aplicacionesMultiples, datosEnElNombre, filasDeTotales, bandas,
    columnaFotos, columnaAniosConRangos, ejemploRangoAnios, segundaTabla, filasConVehiculo,
  };
}

export interface AutoDerivado {
  activo: boolean;
  descripcion: string;
  ejemplo?: string;
  /** Resuelve algunas filas, no todas: el resto se completa en el paso 3. */
  parcial?: boolean;
}

/** ¿Este dato se completa solo gracias a un ajuste detectado (rango de años, aplicación...)? */
export function autoDerivado(
  key: string, mapping: Mapping, userCols: UserColumn[], userRows: unknown[][], d: Detecciones,
): AutoDerivado {
  const { columnaAplicacion: app, datosEnElNombre: nombre, bandas } = d;
  if (key === 'categoria' && mapping.usarBandasComoCategoria && bandas) {
    return { activo: true, parcial: true, descripcion: `Se toma de las ${bandas.total} filas de título que agrupan tu lista`, ejemplo: bandas.titulos[0] };
  }
  if (mapping.deducirDelNombre && nombre) {
    if (key === 'marca_repuesto' && nombre.conMarca > 0) {
      return { activo: true, parcial: true, descripcion: `Se saca del nombre del repuesto, en ${nombre.conMarca} de las primeras ${nombre.filas} filas`, ejemplo: nombre.ejemplo?.marca ?? undefined };
    }
    if (key === 'categoria' && nombre.conCategoria > 0) {
      return { activo: true, parcial: true, descripcion: `Se saca del nombre del repuesto, en ${nombre.conCategoria} de las primeras ${nombre.filas} filas`, ejemplo: nombre.ejemplo?.categoria ?? undefined };
    }
  }
  if (key === 'anio_hasta') {
    if (mapping.dividirAnios && mapping.oficial.anio_desde) {
      const col = colPorId(userCols, mapping.oficial.anio_desde);
      let ejHasta = '';
      if (col) {
        for (const r of userRows.slice(0, 30)) {
          const p = partirRangoAnios(String((r as unknown[])[col.index] ?? ''));
          if (p?.hasta) { ejHasta = p.hasta; break; }
        }
      }
      return { activo: true, descripcion: `Se completa solo dividiendo el rango de tu columna "${col?.displayHeader ?? 'años'}"`, ejemplo: ejHasta ? `ej: ${ejHasta}` : undefined };
    }
    if (mapping.parsearAplicacion && app?.partes?.anioHasta) {
      return { activo: true, descripcion: `Se completa solo con el año de tu columna "${app.col.displayHeader}"`, ejemplo: `ej: ${app.partes.anioHasta}` };
    }
  }
  if (key === 'anio_desde' && !mapping.oficial.anio_desde && mapping.parsearAplicacion && app?.partes?.anioDesde) {
    return { activo: true, descripcion: `Se completa solo con el año de tu columna "${app.col.displayHeader}"`, ejemplo: `ej: ${app.partes.anioDesde}` };
  }
  if (key === 'compatibilidad_marca' && !mapping.oficial.compatibilidad_marca && mapping.parsearAplicacion && app?.partes?.marca) {
    return { activo: true, descripcion: `Se completa solo con la marca de tu columna "${app.col.displayHeader}"`, ejemplo: `ej: ${app.partes.marca}` };
  }
  if (key === 'compatibilidad_modelo' && !mapping.oficial.compatibilidad_modelo && mapping.parsearAplicacion && app?.partes?.modelo) {
    return { activo: true, descripcion: `Se completa solo con el modelo de tu columna "${app.col.displayHeader}"`, ejemplo: `ej: ${app.partes.modelo}` };
  }
  return { activo: false, descripcion: '' };
}

/** Marcas de vehículo distintas que trae el archivo (en su columna o dentro de la aplicación). */
export function marcasDelArchivo(
  mapping: Mapping, userCols: UserColumn[], userRows: unknown[][], esquema: EsquemaPlantilla,
): string[] {
  const marcas = marcasDe(esquema);
  const colMarca = colPorId(userCols, mapping.oficial.compatibilidad_marca);
  const colModelo = colPorId(userCols, mapping.oficial.compatibilidad_modelo);
  const encontradas = new Set<string>();
  for (const row of userRows) {
    const r = row as unknown[];
    if (colMarca) {
      const v = String(r[colMarca.index] ?? '').trim();
      if (v) encontradas.add(normalizarParaComparar(v));
    }
    if (colModelo && (mapping.parsearAplicacion || mapping.separarAplicaciones)) {
      for (const parte of separarAplicaciones(String(r[colModelo.index] ?? ''), marcas)) {
        const parsed = parsearAplicacion(parte, marcas);
        if (parsed?.marca) {
          encontradas.add(normalizarParaComparar(parsed.marca));
          // H52: con una marca mal escrita ("Susuki") se traen también los modelos de la sugerida,
          // para que al corregirla el modelo que ya estaba ("Alto") se conserve.
          if (!buscarEnCatalogo(parsed.marca, marcas)) {
            const [sugerida] = sugerirDelCatalogo(parsed.marca, marcas, 1);
            if (sugerida) encontradas.add(normalizarParaComparar(sugerida));
          }
        }
      }
    }
    if (encontradas.size >= 40) break;
  }
  return [...encontradas];
}

/* --------------------------- Opciones de cada celda --------------------------- */

/** Lo que una celda necesita saber de su propia fila para ofrecer las opciones correctas. */
export interface ContextoDeFila {
  categoria: string;
  marcaVehiculo: string;
  anioDesde: string;
}

/** Los años que se pueden elegir, del más nuevo al más viejo, como en la carga 1:1. */
export const ANIOS = aniosDisponibles();

/**
 * Qué se puede elegir en una celda. La subcategoría depende de la categoría de esa fila, el
 * modelo de la marca del auto y el año hasta del año desde. Lo que no tiene lista es texto libre.
 */
export function opcionesDeCelda(
  columna: string,
  fila: ContextoDeFila,
  esquema: EsquemaPlantilla,
  campos: CampoMeta[],
  modelosDisponibles: Record<string, string[]>,
): string[] {
  if (columna === 'subcategoria') return esquema.catalogos.subcategoriasPorCategoria[fila.categoria] ?? [];
  if (columna === 'compatibilidad_modelo') return modelosDisponibles[normalizarParaComparar(fila.marcaVehiculo)] ?? [];
  if (columna === 'anio_desde') return ANIOS;
  if (columna === 'anio_hasta') return fila.anioDesde ? ANIOS.filter((a) => a >= fila.anioDesde) : ANIOS;
  const campo = campos.find((c) => c.key === columna);
  if (campo?.enumHint?.length) return campo.enumHint;
  if (columna === 'categoria') return esquema.catalogos.categorias;
  if (columna === 'marca_repuesto') return esquema.catalogos.marcasRepuesto;
  if (columna === 'compatibilidad_marca') return esquema.catalogos.marcasVehiculo;
  return [];
}

/** Los pocos nombres del catálogo que se parecen a lo que trae la celda. */
export function sugerenciasDeCelda(valor: string, opciones: string[]): string[] {
  if (!valor.trim()) return [];
  if (opciones.length <= 12 || buscarEnCatalogo(valor, opciones)) return [];
  return sugerirDelCatalogo(valor, opciones);
}

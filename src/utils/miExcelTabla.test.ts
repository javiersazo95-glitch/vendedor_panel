import { describe, expect, it } from 'vitest';
import {
  ESQUEMA_FALLBACK,
  autoDetectMapping,
  camposDesdeEsquema,
  columnasDeHoja,
  type EsquemaPlantilla,
  type Mapping,
} from './plantillaMapping';
import {
  aplicarATodasVacias,
  aplicarParche,
  camposACompletar,
  cierresAlCatalogo,
  modeloQueSigue,
  construirTabla,
  inferirColumna,
  problemasDeFila,
  transformar,
} from './miExcelTabla';

/**
 * La tabla de la etapa 3 de "Mi propio Excel": lo que falta se pinta amarillo y deja de estarlo
 * apenas el vendedor lo completa (celda a celda, para todas las vacías, o dejándolo vacío a
 * propósito cuando es opcional).
 */
const esquema: EsquemaPlantilla = {
  ...ESQUEMA_FALLBACK,
  catalogos: { ...ESQUEMA_FALLBACK.catalogos, categorias: ['Frenos', 'Motor'], marcasRepuesto: ['Bosch'] },
};
const campos = camposDesdeEsquema(esquema);

/** Un Excel de mostrador: código, nombre, precio y stock, sin marca ni categoría ni vehículo. */
const aoa = [
  ['Codigo', 'Descripcion', 'Precio', 'Stock'],
  ['PF-1', 'Pastilla freno', '24990', '5'],
  ['PF-2', 'Disco freno', '39990', '2'],
  ['PF-3', 'Filtro aceite', '5990', '10'],
];

const preparar = (ajustar?: (m: Mapping) => Mapping) => {
  const { cols, rows, filasOriginales } = columnasDeHoja(aoa, 0);
  let mapping = autoDetectMapping(cols, campos);
  // Todo universal para que el vehículo no ensucie estas pruebas.
  mapping = aplicarATodasVacias(mapping, 'compatibilidad_general', 'SI');
  if (ajustar) mapping = ajustar(mapping);
  const columnasACompletar = camposACompletar(campos, mapping, () => false);
  const tabla = (opcionalesVacios: string[] = [], m = mapping) => construirTabla(
    transformar({ userRows: rows, userCols: cols, mapping: m, campos, esquema, modelosDisponibles: {}, filasOriginales }),
    { campos, esquema, mapping: m, modelosDisponibles: {}, columnasACompletar, opcionalesVacios },
  );
  return { mapping, columnasACompletar, tabla, cols, rows, filasOriginales };
};

describe('Tabla amarilla de la etapa 3', () => {
  it('las columnas sin columna en el Excel quedan por completar y sus celdas vacías salen amarillas', () => {
    const { columnasACompletar, tabla } = preparar();
    expect(columnasACompletar).toEqual(expect.arrayContaining(['categoria', 'marca_repuesto']));
    const t = tabla();
    expect(t.total).toBe(3);
    expect(t.faltantesPorColumna.categoria).toBe(3);
    expect(t.faltantesPorColumna.marca_repuesto).toBe(3);
    expect(t.filas[0].faltantes).toEqual(expect.arrayContaining(['categoria', 'marca_repuesto']));
    // Las que ya traen dato no se pintan.
    expect(t.filas[0].faltantes).not.toContain('sku_proveedor');
    expect(t.filas[0].faltantes).not.toContain('precio');
  });

  it('un repuesto universal no pide marca ni modelo del auto', () => {
    const { tabla } = preparar();
    const t = tabla();
    expect(t.faltantesPorColumna.compatibilidad_marca ?? 0).toBe(0);
    expect(t.faltantesPorColumna.compatibilidad_modelo ?? 0).toBe(0);
  });

  it('completar una celda la pone en blanco (y sólo esa)', () => {
    const { mapping, tabla } = preparar();
    const clave = tabla().filas[0].clave;
    const t = tabla([], aplicarParche(mapping, clave, 'categoria', 'Frenos'));
    expect(t.filas[0].faltantes).not.toContain('categoria');
    expect(t.filas[1].faltantes).toContain('categoria');
    expect(t.faltantesPorColumna.categoria).toBe(2);
  });

  it('"Aplicar a todas las filas vacías" completa la columna entera sin pisar lo corregido a mano', () => {
    const { mapping, tabla } = preparar();
    const clave = tabla().filas[0].clave;
    const conParche = aplicarParche(mapping, clave, 'categoria', 'Motor');
    const t = tabla([], aplicarATodasVacias(conParche, 'categoria', 'Frenos'));
    expect(t.faltantesPorColumna.categoria ?? 0).toBe(0);
    const iCat = t.columnas.indexOf('categoria');
    expect(t.filas[0].valores[iCat]).toBe('Motor');
    expect(t.filas[1].valores[iCat]).toBe('Frenos');
  });

  it('un dato opcional se puede dejar vacío a propósito: celda a celda o en toda la columna', () => {
    const { mapping, tabla, columnasACompletar } = preparar();
    expect(columnasACompletar).toContain('referencia_oem');
    expect(tabla().faltantesPorColumna.referencia_oem).toBe(3);
    const clave = tabla().filas[0].clave;
    expect(tabla([], aplicarParche(mapping, clave, 'referencia_oem', '')).faltantesPorColumna.referencia_oem).toBe(2);
    expect(tabla(['referencia_oem']).faltantesPorColumna.referencia_oem ?? 0).toBe(0);
  });

  it('las filas mantienen el orden del archivo aunque tengan problemas', () => {
    const t = preparar().tabla();
    expect(t.filas.map((f) => f.sku)).toEqual(['PF-1', 'PF-2', 'PF-3']);
    expect(t.filas.map((f) => f.numeroFila)).toEqual([2, 3, 4]);
  });

  it('muestra todas las filas, no sólo las primeras 100, y aguanta un inventario grande', () => {
    const grande = [aoa[0], ...Array.from({ length: 3000 }, (_, i) => [`C-${i}`, `Repuesto ${i}`, '1000', '1'])];
    const { cols, rows, filasOriginales } = columnasDeHoja(grande, 0);
    const mapping = aplicarATodasVacias(autoDetectMapping(cols, campos), 'compatibilidad_general', 'SI');
    const inicio = performance.now();
    const t = construirTabla(
      transformar({ userRows: rows, userCols: cols, mapping, campos, esquema, modelosDisponibles: {}, filasOriginales }),
      { campos, esquema, mapping, modelosDisponibles: {}, columnasACompletar: camposACompletar(campos, mapping, () => false), opcionalesVacios: [] },
    );
    const ms = performance.now() - inicio;
    expect(t.filas).toHaveLength(3000);
    expect(ms).toBeLessThan(4000);
  });
});

describe('Qué dato exacto impide publicar', () => {
  it('reconoce de qué dato habla un mensaje del servidor', () => {
    expect(inferirColumna('Falta la marca del repuesto.', campos)).toBe('marca_repuesto');
    expect(inferirColumna('La marca de vehículo "Toyot" no está en el catálogo.', campos)).toBe('compatibilidad_marca');
    expect(inferirColumna('La subcategoría no corresponde', campos)).toBe('subcategoria');
    expect(inferirColumna('Ya existe un producto con ese SKU para el proveedor', campos)).toBe('sku_proveedor');
    expect(inferirColumna('Error inesperado', campos)).toBeNull();
  });

  it('marca el dato que objetó el servidor y deja de marcarlo apenas el vendedor lo cambia', () => {
    const { mapping, tabla } = preparar((m) => aplicarATodasVacias(aplicarATodasVacias(m, 'categoria', 'Frenos'), 'marca_repuesto', 'Bosch'));
    const t = tabla();
    const fila = t.filas[0];
    const servidor = {
      porClave: { [fila.clave]: { fila: 2, sku: 'PF-1', estado: 'ERROR' as const, mensajes: ['La marca del repuesto "Bosch" está bloqueada.'] } },
      columnas: t.columnas,
      valores: { [fila.clave]: [...fila.valores] },
    };
    // Sin el aviso de stock bajo (H51) del CSV de prueba: aquí se mira sólo lo del servidor.
    expect(problemasDeFila(fila, t.columnas, campos, servidor).filter((x) => x.columna !== 'stock')).toEqual([
      { columna: 'marca_repuesto', severidad: 'error', mensaje: 'La marca del repuesto "Bosch" está bloqueada.' },
    ]);
    const corregida = tabla([], aplicarParche(aplicarATodasVacias(aplicarATodasVacias(mapping, 'categoria', 'Frenos'), 'marca_repuesto', 'Bosch'), fila.clave, 'marca_repuesto', 'Mann')).filas[0];
    // Ya no queda nada que impida publicar: sólo el aviso de que "Mann" no está en este catálogo de prueba.
    expect(problemasDeFila(corregida, t.columnas, campos, servidor).filter((x) => x.severidad === 'error')).toEqual([]);
  });
});

describe('cierresAlCatalogo (H53)', () => {
  const columnas = ['compatibilidad_general', 'compatibilidad_marca', 'compatibilidad_modelo', 'anio_desde', 'anio_hasta'];
  const hilux = [{ id: 1, modelo: 'Hilux', anioDesde: 2016, anioHasta: 2025, motor: '2.4' }];
  const versionesDe = (marca: string, modelo: string) => (marca === 'Toyota' && modelo === 'Hilux' ? hilux : undefined);
  const fila = (clave: string, ...valores: string[]) => ({ clave, valores });

  it('un "en adelante" (año actual) que pasa del catálogo se cierra en su último año', () => {
    const r = cierresAlCatalogo([fila('a', 'NO', 'Toyota', 'Hilux', '2016', '2026')], columnas, versionesDe, 2026);
    expect(r).toEqual([{ clave: 'a', marca: 'Toyota', modelo: 'Hilux', hasta: '2025' }]);
  });

  it('no toca años pasados, universales, modelos sin catálogo ni un "desde" posterior al catálogo', () => {
    const r = cierresAlCatalogo([
      fila('pasado', 'NO', 'Toyota', 'Hilux', '2016', '2024'),
      fila('universal', 'SI', 'Toyota', 'Hilux', '2016', '2026'),
      fila('sin-catalogo', 'NO', 'Toyota', 'Rush', '2016', '2026'),
      fila('desde-nuevo', 'NO', 'Toyota', 'Hilux', '2026', '2026'),
    ], columnas, versionesDe, 2026);
    expect(r).toEqual([]);
  });
});

describe('modeloQueSigue (H52)', () => {
  const modelos = { suzuki: ['Alto', 'Swift'], toyota: ['Yaris'] };

  it('corregir la marca conserva el modelo si existe en la marca nueva, con su nombre del catálogo', () => {
    expect(modeloQueSigue('Suzuki', 'alto', modelos)).toBe('Alto');
  });

  it('si el modelo no es de la marca nueva, o no hay modelo, no se conserva', () => {
    expect(modeloQueSigue('Toyota', 'Alto', modelos)).toBeUndefined();
    expect(modeloQueSigue('Suzuki', '', modelos)).toBeUndefined();
  });
});

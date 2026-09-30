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
  construirTabla,
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

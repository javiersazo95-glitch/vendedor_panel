import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { PLANTILLA_COLUMNAS, columnReader } from './BulkUpload';

/**
 * Regresión de la Fase 5.
 *
 * Al pasar el botón de descarga a la plantilla oficial del backend, el parser del panel
 * quedó leyendo sus nombres antiguos (`sku`, `nombre`, `marca_vehiculo`). Resultado:
 * descargar la plantilla, llenarla y subirla fallaba en TODAS las filas con "SKU faltante",
 * porque las claves reales son `sku_proveedor`, `nombre_publicado`, `compatibilidad_marca`.
 *
 * Estos tests parsean una hoja con la cabecera real y verifican el contrato.
 */

/** Construye una hoja con la cabecera oficial y una fila de datos, como haría el vendedor. */
function filaDesdePlantillaOficial(valores: Record<string, string | number>) {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...PLANTILLA_COLUMNAS],
    PLANTILLA_COLUMNAS.map((columna) => valores[columna] ?? ''),
  ]);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
  return rows[0];
}

describe('contrato de columnas de la plantilla oficial', () => {
  it('el lector resuelve todas las columnas del contrato', () => {
    const row = filaDesdePlantillaOficial({
      nombre_publicado: 'Pastilla de freno',
      categoria: 'Frenos',
      subcategoria: 'Pastillas',
      marca_repuesto: 'Brembo',
      sku_proveedor: 'SKU-1',
      referencia_oem: '04465-0D020',
      tipo_precio: 'MOSTRAR_PRECIO',
      precio: 32000,
      stock: 10,
      condicion: 'ORIGINAL',
      compatibilidad_marca: 'Toyota',
      compatibilidad_modelo: 'Yaris',
      anio_desde: 2014,
      anio_hasta: 2020,
      motor: '1.5',
      descripcion: 'Delanteras',
    });
    const col = columnReader(row);

    expect(col('sku_proveedor')).toBe('SKU-1');
    expect(col('nombre_publicado')).toBe('Pastilla de freno');
    expect(col('subcategoria')).toBe('Pastillas');
    expect(col('compatibilidad_marca')).toBe('Toyota');
    expect(col('anio_desde')).toBe(2014);
    expect(col('tipo_precio')).toBe('MOSTRAR_PRECIO');
    expect(col('condicion')).toBe('ORIGINAL');
    expect(col('referencia_oem')).toBe('04465-0D020');
  });

  it('los nombres antiguos del panel ya no resuelven', () => {
    const row = filaDesdePlantillaOficial({ sku_proveedor: 'SKU-1', nombre_publicado: 'Pastilla' });
    const col = columnReader(row);

    // Si alguno de estos volviera a devolver valor, significaría que se reintrodujo el
    // contrato viejo del panel en paralelo al oficial.
    expect(col('sku')).toBe('');
    expect(col('nombre')).toBe('');
    expect(col('marca_vehiculo')).toBe('');
    expect(col('ano_vehiculo')).toBe('');
  });

  it('tolera cabeceras con mayusculas y espacios sobrantes', () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['  SKU_Proveedor ', 'Nombre_Publicado'],
      ['SKU-9', 'Disco'],
    ]);
    const row = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet)[0];
    const col = columnReader(row);

    expect(col('sku_proveedor')).toBe('SKU-9');
    expect(col('nombre_publicado')).toBe('Disco');
  });

  it('una columna ausente devuelve cadena vacia, no undefined', () => {
    const row = filaDesdePlantillaOficial({ sku_proveedor: 'SKU-1' });
    const col = columnReader(row);

    // La columna de imagen todavia no existe en el contrato (llega en la Fase 6).
    expect(col('imagen')).toBe('');
    expect(col('columna_inexistente')).toBe('');
  });

  it('el contrato tiene las 18 columnas del backend, en orden', () => {
    expect(PLANTILLA_COLUMNAS).toHaveLength(18);
    expect(PLANTILLA_COLUMNAS[0]).toBe('nombre_publicado');
    expect(PLANTILLA_COLUMNAS[4]).toBe('sku_proveedor');
    expect(PLANTILLA_COLUMNAS[9]).toBe('condicion');
    // compatibilidad_general va justo despues de condicion (columna K).
    expect(PLANTILLA_COLUMNAS[10]).toBe('compatibilidad_general');
    expect(PLANTILLA_COLUMNAS[16]).toBe('descripcion');
    expect(PLANTILLA_COLUMNAS[17]).toBe('requiere_chasis');
  });
});

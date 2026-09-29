import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { construirExcelSoloValidos } from './excelSoloValidos';

/**
 * Fase 8 del plan de auditoría de carga: "Publicar los N que están bien" rearma el Excel sin las
 * filas con error. Antes se perdía la hoja "instrucciones", que lleva la versión de la plantilla.
 */
function libro(): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['sku_proveedor', 'nombre_publicado'],
    ['PF-1', 'Pastilla buena'],
    ['PF-2', 'Pastilla con error'],
    ['pf-3 ', 'Otra buena'],
  ]), 'inventario');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['sku_proveedor', 'compatibilidad_marca'],
    ['PF-1', 'Toyota'],
    ['PF-2', 'Nissan'],
    ['PF-3', 'Kia'],
  ]), 'compatibilidades');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['VERSION_PLANTILLA: 7']]), 'instrucciones');
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new File([bytes], 'inventario.xlsx');
}

async function leer(file: File) {
  const buffer = await new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
  return XLSX.read(buffer, { type: 'array' });
}

describe('construirExcelSoloValidos', () => {
  it('deja sólo las filas buenas y conserva la hoja de instrucciones', async () => {
    const wb = await leer(await construirExcelSoloValidos(libro(), [2, 4]));

    expect(wb.SheetNames).toEqual(['inventario', 'compatibilidades', 'instrucciones']);
    const inventario = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.inventario, { header: 1 });
    expect(inventario.map((fila) => fila[0])).toEqual(['sku_proveedor', 'PF-1', 'pf-3 ']);
    const instrucciones = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.instrucciones, { header: 1 });
    expect(instrucciones[0][0]).toBe('VERSION_PLANTILLA: 7');
  });

  it('filtra la hoja de compatibilidades por código sin mayúsculas ni espacios', async () => {
    const wb = await leer(await construirExcelSoloValidos(libro(), [2, 4]));

    const compat = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.compatibilidades, { header: 1 });
    expect(compat.map((fila) => fila[0])).toEqual(['sku_proveedor', 'PF-1', 'PF-3']);
  });
});

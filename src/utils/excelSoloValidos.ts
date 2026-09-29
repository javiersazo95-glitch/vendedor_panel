/**
 * Reconstruye el Excel original dejando solo las filas indicadas (las que pasaron el
 * analisis), preservando el orden y el contenido tal cual, mas la hoja opcional
 * "compatibilidades" filtrada a los SKUs que sobreviven. Es el mismo mecanismo que ya usa
 * exportarErrores() para reconstruir un Excel con datos reales, aplicado al revés: en vez
 * de quedarse con los errores, se queda con lo valido para no reenviar filas que ya
 * sabemos que van a fallar.
 */
export async function construirExcelSoloValidos(dataFile: File, filasASubir: number[]): Promise<File> {
  const XLSX = await import('xlsx');
  // FileReader y no File.arrayBuffer(): es lo que existe en todos los navegadores y en jsdom.
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(dataFile);
  });
  const workbook = XLSX.read(buffer, { type: 'array' });

  const mainSheetName = workbook.SheetNames[0];
  const mainSheet = workbook.Sheets[mainSheetName];
  const mainRows = XLSX.utils.sheet_to_json<unknown[]>(mainSheet, { header: 1, defval: '' });
  const headerRow = (mainRows[0] as unknown[]) ?? [];
  const normalizarClave = (valor: unknown) => String(valor ?? '').trim().toUpperCase();
  const filasASubirSet = new Set(filasASubir);
  const filasValidas = mainRows.filter((_, index) => filasASubirSet.has(index + 1));

  const nuevoWorkbook = XLSX.utils.book_new();
  const nuevaHojaPrincipal = XLSX.utils.aoa_to_sheet([headerRow, ...filasValidas]);
  XLSX.utils.book_append_sheet(nuevoWorkbook, nuevaHojaPrincipal, mainSheetName || 'inventario');

  const compatSheet = workbook.Sheets['compatibilidades'];
  if (compatSheet) {
    const skuColIndex = (headerRow as unknown[]).findIndex((titulo) => String(titulo ?? '').trim().toLowerCase() === 'sku_proveedor');
    const skusValidos = new Set(
      filasValidas.map((row) => normalizarClave((row as unknown[])[skuColIndex]))
    );
    const compatRows = XLSX.utils.sheet_to_json<unknown[]>(compatSheet, { header: 1, defval: '' });
    const compatHeader = (compatRows[0] as unknown[]) ?? [];
    const compatSkuIndex = 0; // sku_proveedor es siempre la primera columna de esta hoja
    const compatFiltradas = compatRows
      .slice(1)
      .filter((row) => skusValidos.has(normalizarClave((row as unknown[])[compatSkuIndex])));
    const nuevaHojaCompat = XLSX.utils.aoa_to_sheet([compatHeader, ...compatFiltradas]);
    XLSX.utils.book_append_sheet(nuevoWorkbook, nuevaHojaCompat, 'compatibilidades');
  }

  // Fase 8: las demás hojas van tal cual. "instrucciones" lleva VERSION_PLANTILLA y el backend
  // avisa por ella si el archivo es de una plantilla vieja; antes se perdía al publicar "los que
  // están bien".
  for (const nombre of workbook.SheetNames) {
    if (nombre === mainSheetName || nombre === 'compatibilidades') continue;
    XLSX.utils.book_append_sheet(nuevoWorkbook, workbook.Sheets[nombre], nombre);
  }

  const wbout = XLSX.write(nuevoWorkbook, { bookType: 'xlsx', type: 'array' });
  return new File([wbout], dataFile.name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Excel (y algunos lectores de CSV) interpretan una celda como fórmula cuando su valor
 * empieza con uno de estos caracteres. Si esos valores vienen de un archivo subido por un
 * usuario o de datos ya guardados en el catálogo, un texto como `=HYPERLINK("http://evil","x")`
 * llega intacto a un .xlsx generado por la app y se ejecuta como fórmula al abrirlo
 * (formula/CSV injection). Anteponer una comilla simple fuerza a Excel a tratarlo como texto
 * literal, sin cambiar lo que el usuario ve en la celda.
 */
const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];

export function sanitizeCellValue<T>(value: T): T | string {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }
  return FORMULA_TRIGGER_CHARS.includes(value[0]) ? `'${value}` : value;
}

/** Aplica sanitizeCellValue a cada valor de cada fila antes de pasarla a XLSX.utils.json_to_sheet. */
export function sanitizeRowsForExport<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      sanitized[key] = sanitizeCellValue(value);
    }
    return sanitized as T;
  });
}

/** Igual que sanitizeRowsForExport, pero para arreglos de arreglos (XLSX.utils.aoa_to_sheet). */
export function sanitizeAoaForExport<T>(rows: T[][]): (T | string)[][] {
  return rows.map((row) => row.map((cell) => sanitizeCellValue(cell)));
}

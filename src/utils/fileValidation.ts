/**
 * Límite de tamaño para el archivo de datos (XLSX/CSV) de carga masiva.
 *
 * El parseo corre entero en el navegador del vendedor (XLSX.read / Papa.parse), sin backend
 * de por medio. Sin este límite, un archivo muy grande puede colgar o crashear la pestaña de
 * quien lo sube -- mejor avisar antes de intentarlo que dejar que el navegador se cuelgue.
 */
export const MAX_DATA_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function excedeTamanoMaximoDatos(file: File): boolean {
  return file.size > MAX_DATA_FILE_SIZE_BYTES;
}

export function mensajeArchivoDemasiadoGrande(file: File): string {
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  const limiteMb = MAX_DATA_FILE_SIZE_BYTES / (1024 * 1024);
  return `El archivo pesa ${mb} MB, más del máximo permitido (${limiteMb} MB). Dividilo en partes más chicas y volvé a intentar.`;
}

/**
 * Confirma que un .xlsx/.xls declarado por extension sea realmente un Excel, mirando la
 * firma de sus primeros bytes en vez de confiar solo en el nombre del archivo: un .xlsx
 * real es un ZIP (firma "PK"), uno .xls antiguo es un archivo OLE2 (firma D0 CF 11 E0).
 * No aplica a .csv: ahi cualquier texto es un CSV valido o invalido segun su contenido,
 * no segun bytes de cabecera.
 */
export async function pareceExcelValido(file: File): Promise<boolean> {
  if (!/\.(xlsx|xls)$/i.test(file.name)) return true;

  // FileReader en vez de Blob.slice().arrayBuffer(): esto ultimo no esta implementado en
  // el jsdom que usan las pruebas (y en general es el metodo mas compatible entre navegadores).
  const header = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file.slice(0, 4));
  });

  const esZip = header[0] === 0x50 && header[1] === 0x4b;
  const esOle = header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0;
  return esZip || esOle;
}

export const MENSAJE_EXCEL_INVALIDO =
  'Este archivo tiene extensión .xlsx/.xls pero su contenido no es un Excel válido (puede estar corrupto o haber sido renombrado por error). Revísalo y volvé a intentar.';

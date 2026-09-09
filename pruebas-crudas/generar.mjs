/**
 * Escribe los casos crudos como .xlsx para probarlos a mano en el panel.
 *
 *   node pruebas-crudas/generar.mjs
 *
 * Los archivos quedan en esta misma carpeta. El test `plantillaCrudos.test.ts` usa los
 * mismos datos sin pasar por disco, asi que regenerarlos no es requisito para correrlo:
 * sirven para subirlos por la interfaz y ver el flujo completo como lo ve el vendedor.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

import { CASOS_CRUDOS } from './casos.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));

for (const caso of CASOS_CRUDOS) {
  const libro = XLSX.utils.book_new();
  // Sin encabezados propios: el AoA ya trae la hoja tal cual la escribio el vendedor,
  // incluido el membrete y las filas que no son repuestos.
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(caso.aoa), 'Hoja1');
  // XLSX.writeFile no escribe desde el build ESM: se serializa a buffer y se guarda con fs.
  const destino = path.join(aqui, `${caso.id}.xlsx`);
  fs.writeFileSync(destino, XLSX.write(libro, { bookType: 'xlsx', type: 'buffer' }));
  console.log(`${caso.id}.xlsx  ${caso.titulo}`);
}

console.log(`\n${CASOS_CRUDOS.length} archivos en ${aqui}`);

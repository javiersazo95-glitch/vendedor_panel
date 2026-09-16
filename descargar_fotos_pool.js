/**
 * Completa el pool de fotos de prueba (datos_prueba_dev/fotos_pool) con imágenes de
 * licencia libre, para que el catálogo de 2.000 registros no se vea con la misma foto
 * repetida veinte veces.
 *
 * Las fuentes no se buscan en cada corrida: están congeladas en
 * `datos_prueba_dev/fuentes_fotos.json` (título, autor, licencia y URL original, como las
 * devolvió Openverse). Una búsqueda en vivo traería una imagen distinta cada vez y el ZIP
 * dejaría de ser reproducible; además la atribución quedaría desactualizada.
 *
 * Todas son CC BY o dominio público (PDM). La atribución se escribe en
 * `datos_prueba_dev/CREDITOS_FOTOS.md` cada vez que se corre esto.
 *
 * Uso: node descargar_fotos_pool.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, 'datos_prueba_dev');
const poolDir = path.join(outputDir, 'fotos_pool');
const fuentesPath = path.join(outputDir, 'fuentes_fotos.json');

const USER_AGENT = 'RepuesTopDevData/1.0 (datos de prueba, uso interno)';
/** Debajo de esto no es una foto: es un error o un placeholder del proveedor. */
const MINIMO_BYTES = 8000;

async function descargar(fuente) {
  const destino = path.join(poolDir, fuente.archivo);
  if (fs.existsSync(destino) && fs.statSync(destino).size >= MINIMO_BYTES) {
    console.log(`  [YA ESTABA] ${fuente.archivo}`);
    return true;
  }
  const respuesta = await fetch(fuente.url, { headers: { 'User-Agent': USER_AGENT } });
  if (!respuesta.ok) {
    console.warn(`  [FALLO ${respuesta.status}] ${fuente.archivo} <- ${fuente.url}`);
    return false;
  }
  const buffer = Buffer.from(await respuesta.arrayBuffer());
  if (buffer.length < MINIMO_BYTES) {
    console.warn(`  [MUY CHICA] ${fuente.archivo} (${buffer.length} bytes)`);
    return false;
  }
  fs.writeFileSync(destino, buffer);
  console.log(`  [OK] ${fuente.archivo} (${(buffer.length / 1024).toFixed(0)} KB)`);
  return true;
}

function escribirCreditos(fuentes) {
  const lineas = [
    '# Créditos de las fotos de prueba',
    '',
    'Las fotos de `fotos_pool/` (y del ZIP que se genera con ellas) son imágenes de',
    'licencia libre descargadas vía Openverse. Se usan sólo como datos de prueba del',
    'ambiente dev; no son fotos de productos de ningún vendedor de RepuesTop.',
    '',
    'Las que no aparecen en esta lista vienen de `fotos/`, el set original de 10 fotos.',
    '',
    '| Archivo | Título | Autor | Licencia | Origen |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const f of fuentes) {
    const licencia = f.licencia_url ? `[${f.licencia}](${f.licencia_url})` : f.licencia;
    lineas.push(`| ${f.archivo} | ${f.titulo ?? ''} | ${f.autor ?? 'sin autor declarado'} | ${licencia} | ${f.pagina ?? f.url} |`);
  }
  lineas.push('');
  fs.writeFileSync(path.join(outputDir, 'CREDITOS_FOTOS.md'), lineas.join('\n'), 'utf8');
  console.log('[OK] Créditos escritos en datos_prueba_dev/CREDITOS_FOTOS.md');
}

async function main() {
  fs.mkdirSync(poolDir, { recursive: true });
  const fuentes = JSON.parse(fs.readFileSync(fuentesPath, 'utf8'));
  console.log(`[PROCESO] Completando el pool con ${fuentes.length} fotos de licencia libre...`);

  let listas = 0;
  for (const fuente of fuentes) {
    try {
      if (await descargar(fuente)) listas += 1;
    } catch (error) {
      console.warn(`  [ERROR] ${fuente.archivo}: ${error.message}`);
    }
  }

  escribirCreditos(fuentes);
  console.log(`[OK] ${listas} de ${fuentes.length} fotos disponibles en fotos_pool/`);
  if (listas < fuentes.length) {
    console.warn('[ALERTA] Faltan fotos: el generador va a usar la foto genérica en su lugar.');
  }
}

main();

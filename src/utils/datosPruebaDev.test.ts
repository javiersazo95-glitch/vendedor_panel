import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ESQUEMA_FALLBACK,
  camposDesdeEsquema,
  leerLibro,
  columnasDeHoja,
  detectarFilaEncabezados,
  autoDetectMapping,
  buildOfficialAoADetallado
} from './plantillaMapping';
import { revisarAoA } from './plantillaRevision';
import { detectarSkusRepetidos, separarPorSku } from './plantillaCompatibilidad';

/**
 * Los datos de prueba del ambiente dev (los Excel, las fotos y los ZIP) pesan unos 84 MB y
 * no se versionan: se regeneran con `node descargar_fotos_pool.js` y
 * `node generar_2000_datos_dev.js` (ver .gitignore). Cuando están, estos tests verifican que
 * lo generado sigue pasando por el mismo camino que el archivo de un vendedor; cuando no,
 * se saltan en vez de fallar, que es lo que pasa en CI y en un clon recién hecho.
 */
const DATOS_DEV = path.resolve(process.cwd(), 'datos_prueba_dev');
const hayDatosDePrueba = fs.existsSync(path.join(DATOS_DEV, 'Plantilla_Vendedor_2000_Registros_Dev.xlsx'))
  && fs.existsSync(path.join(DATOS_DEV, 'Plantilla_Vendedor_Autopartes_Dev.xlsx'));

describe.skipIf(!hayDatosDePrueba)('Verificación de Plantilla_Vendedor_Autopartes_Dev.xlsx', () => {
  it('debe autodetectar todas las columnas, normalizar y no tener ningún error', async () => {
    const excelPath = path.resolve(process.cwd(), 'datos_prueba_dev', 'Plantilla_Vendedor_Autopartes_Dev.xlsx');
    expect(fs.existsSync(excelPath)).toBe(true);

    const buf = fs.readFileSync(excelPath);
    const file = new File([buf], 'Plantilla_Vendedor_Autopartes_Dev.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const hojas = await leerLibro(file);
    expect(hojas.length).toBeGreaterThan(0);

    const hoja = hojas[0];
    const filaEncabezados = detectarFilaEncabezados(hoja.aoa);
    expect(filaEncabezados).toBe(0);

    const { cols, rows } = columnasDeHoja(hoja.aoa, filaEncabezados);
    expect(cols.length).toBe(17);
    expect(rows.length).toBe(10);

    const campos = camposDesdeEsquema(ESQUEMA_FALLBACK);
    const mapping = autoDetectMapping(cols, campos);

    // Validar que todos los campos obligatorios fueron autodetectados
    const obligatorios = campos.filter(c => c.required);
    for (const campo of obligatorios) {
      expect(mapping.oficial[campo.key], `El campo obligatorio ${campo.key} no fue mapeado`).toBeTruthy();
    }

    // Validar detección de precio, condicion, compatibilidad, etc.
    expect(mapping.oficial.precio).toBeTruthy();
    expect(mapping.oficial.condicion).toBeTruthy();
    expect(mapping.oficial.compatibilidad_marca).toBeTruthy();
    expect(mapping.oficial.compatibilidad_modelo).toBeTruthy();
    expect(mapping.oficial.anio_desde).toBeTruthy();

    mapping.dividirAnios = true;
    const resultadoAoA = buildOfficialAoADetallado(rows, cols, mapping, campos);

    expect(resultadoAoA.aoa.length).toBe(11); // 1 header + 10 filas

    // Revisar contra las reglas del backend
    const revision = revisarAoA(resultadoAoA.aoa, campos, { catalogos: ESQUEMA_FALLBACK.catalogos });

    expect(revision.conError).toBe(0);
    expect(revision.publicables).toBe(10);
  });

  it('debe tener las 10 fotos en datos_prueba_dev/fotos y en el zip', () => {
    const fotosDir = path.resolve(process.cwd(), 'datos_prueba_dev', 'fotos');
    const zipPath = path.resolve(process.cwd(), 'datos_prueba_dev', 'fotos_repuestos.zip');

    expect(fs.existsSync(fotosDir)).toBe(true);
    expect(fs.existsSync(zipPath)).toBe(true);

    const zipStat = fs.statSync(zipPath);
    expect(zipStat.size).toBeGreaterThan(10000);

    for (let i = 1; i <= 10; i++) {
      const sku = `REP-${String(i).padStart(3, '0')}`;
      const fotoPath = path.join(fotosDir, `${sku}.jpg`);
      expect(fs.existsSync(fotoPath), `Falta la foto para ${sku}`).toBe(true);
      const stat = fs.statSync(fotoPath);
      expect(stat.size).toBeGreaterThan(1000);
    }
  });

  it('debe validar el archivo masivo con 0 errores, códigos repetidos y el pool de fotos', async () => {
    const excelPath = path.resolve(process.cwd(), 'datos_prueba_dev', 'Plantilla_Vendedor_2000_Registros_Dev.xlsx');
    const zipPath = path.resolve(process.cwd(), 'datos_prueba_dev', 'fotos_2000_repuestos.zip');
    const poolDir = path.resolve(process.cwd(), 'datos_prueba_dev', 'fotos_pool');

    expect(fs.existsSync(excelPath)).toBe(true);
    expect(fs.existsSync(zipPath)).toBe(true);

    const buf = fs.readFileSync(excelPath);
    const file = new File([buf], 'Plantilla_Vendedor_2000_Registros_Dev.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const hojas = await leerLibro(file);
    expect(hojas.length).toBe(1);

    const hoja = hojas[0];
    const filaEncabezados = detectarFilaEncabezados(hoja.aoa);
    expect(filaEncabezados).toBe(0);

    const { cols, rows } = columnasDeHoja(hoja.aoa, filaEncabezados);
    // 18 columnas: las 17 de siempre más VERSION_AUTO, que no tiene columna oficial y por
    // eso ejercita el camino de "esta columna la mando a la descripción o la dejo fuera".
    expect(cols.length).toBe(18);
    expect(rows.length).toBeGreaterThan(2000);

    const campos = camposDesdeEsquema(ESQUEMA_FALLBACK);
    const mapping = autoDetectMapping(cols, campos);

    for (const campo of campos.filter(c => c.required)) {
      expect(mapping.oficial[campo.key], `Campo obligatorio ${campo.key} debe mapearse`).toBeTruthy();
    }

    mapping.dividirAnios = true;
    const resultadoAoA = buildOfficialAoADetallado(rows, cols, mapping, campos);
    expect(resultadoAoA.aoa.length).toBe(rows.length + 1);

    const revision = revisarAoA(resultadoAoA.aoa, campos, { catalogos: ESQUEMA_FALLBACK.catalogos });
    expect(revision.conError).toBe(0);
    expect(revision.publicables).toBe(rows.length);

    // El archivo trae el mismo código repetido con distintos vehículos: es la forma en que
    // los vendedores escriben la compatibilidad múltiple y es lo que el paso de adaptar la
    // plantilla tiene que saber juntar.
    const colSku = cols.findIndex(c => c.id === mapping.oficial.sku_proveedor);
    expect(colSku).toBeGreaterThanOrEqual(0);
    const repetidos = detectarSkusRepetidos(rows, colSku);
    expect(repetidos.skus).toBeGreaterThan(100);
    expect(repetidos.filasExtra).toBe(rows.length - 2000);

    const separado = separarPorSku(resultadoAoA.aoa);
    expect(separado.inventario.length).toBe(2001); // 1 header + 2000 repuestos
    expect(separado.compatibilidades.length).toBe(repetidos.filasExtra + 1);
    // Las filas repetidas sólo cambian el vehículo, nunca el repuesto: si cambiaran, el
    // mapper avisaría que se está quedando con la primera y perdiendo datos.
    expect(separado.advertencias).toEqual([]);

    const zipStat = fs.statSync(zipPath);
    expect(zipStat.size).toBeGreaterThan(1000000);

    // La carpeta y el ZIP tienen que traer las mismas fotos, y el Excel no puede nombrar
    // ninguna que no esté: un nombre suelto deja repuestos sin imagen sin decir por qué.
    const enPool = new Set(fs.readdirSync(poolDir));
    expect(enPool.size).toBeGreaterThanOrEqual(30);
    const colFoto = cols.findIndex(c => c.rawHeader.toUpperCase() === 'FOTO');
    const fotasNombradas = new Set(rows.map(r => String(r[colFoto] ?? '').trim()).filter(Boolean));
    expect(fotasNombradas.size).toBeGreaterThanOrEqual(30);
    for (const foto of fotasNombradas) {
      expect(enPool.has(foto), `El Excel nombra ${foto} y no está en fotos_pool/`).toBe(true);
    }
  });

  it('debe traer compatibilidades para las dos patentes mockeadas de dev', async () => {
    const excelPath = path.resolve(process.cwd(), 'datos_prueba_dev', 'Plantilla_Vendedor_2000_Registros_Dev.xlsx');
    const buf = fs.readFileSync(excelPath);
    const file = new File([buf], 'Plantilla_Vendedor_2000_Registros_Dev.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const hojas = await leerLibro(file);
    const { cols, rows } = columnasDeHoja(hojas[0].aoa, 0);
    const idx = (nombre: string) => cols.findIndex(c => c.rawHeader.toUpperCase() === nombre);
    const [cSku, cMarca, cModelo, cAnios] = [idx('CODIGO_INTERNO'), idx('MARCA_AUTO'), idx('MODELO_AUTO'), idx('RANGO_ANOS')];

    // Los dos autos que DevDataInitializer deja mockeados por patente.
    const mocks = [
      { patente: 'ABCD11', marca: 'Toyota', modelo: 'Yaris', anio: 2018 },
      { patente: 'ABCD22', marca: 'Hyundai', modelo: 'Accent', anio: 2020 },
    ];

    for (const mock of mocks) {
      const skus = new Set<string>();
      for (const fila of rows) {
        if (String(fila[cMarca] ?? '') !== mock.marca || String(fila[cModelo] ?? '') !== mock.modelo) continue;
        const [desde, hasta] = String(fila[cAnios] ?? '').split('-').map(Number);
        if (desde <= mock.anio && mock.anio <= hasta) skus.add(String(fila[cSku]));
      }
      expect(skus.size, `Ningún repuesto calza con ${mock.patente}`).toBeGreaterThan(200);
    }

    // El catálogo de dev tiene el Chevrolet Spark hasta 2015: un rango que se pase de ahí
    // hace que el backend descarte la compatibilidad y el repuesto quede invisible en la
    // búsqueda por vehículo. Es el error que tenía este archivo.
    const sparkFueraDeRango = rows.filter(fila => {
      if (String(fila[cModelo] ?? '') !== 'Spark') return false;
      const [desde, hasta] = String(fila[cAnios] ?? '').split('-').map(Number);
      return desde < 2005 || hasta > 2015;
    });
    expect(sparkFueraDeRango).toHaveLength(0);
  });
});

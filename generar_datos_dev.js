import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.join(__dirname, 'datos_prueba_dev');
const fotosDir = path.join(outputDir, 'fotos');

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(fotosDir, { recursive: true });

// Artifacts directory where AI-generated images are stored
const artifactsDir = 'C:\\Users\\SMK GAMING\\.gemini\\antigravity-ide\\brain\\93e56ea9-f93e-42bf-8525-81e55be736f7';

// 1. Columnas personalizadas del vendedor (diferentes a las oficiales de RepuesTop)
// Demuestra el poder de autodetección de sinónimos del wizard de adaptación.
const HEADERS_VENDEDOR = [
  'CODIGO_INTERNO',
  'PRODUCTO',
  'RUBRO',
  'SUBRUBRO',
  'FABRICANTE',
  'CODIGO_OEM',
  'PRECIO_VENTA',
  'STOCK_DISPONIBLE',
  'ESTADO',
  'UNIVERSAL',
  'MARCA_AUTO',
  'MODELO_AUTO',
  'RANGO_ANOS',
  'MOTOR',
  'OBSERVACIONES',
  'PIDE_CHASIS',
  'FOTO'
];

// 2. Datos 100% alineados con el ambiente DEV (categorías, subcategorías, marcas y autos reales)
const PRODUCTOS_DEV = [
  {
    CODIGO_INTERNO: 'REP-001',
    PRODUCTO: 'Pastillas de Freno Delanteras Cerámicas',
    RUBRO: 'Frenos',
    SUBRUBRO: 'Pastillas de Freno',
    FABRICANTE: 'Brembo',
    CODIGO_OEM: '04465-YZZA6',
    PRECIO_VENTA: '$ 28.990',
    STOCK_DISPONIBLE: 15,
    ESTADO: 'ORIGINAL',
    UNIVERSAL: 'NO',
    MARCA_AUTO: 'Toyota',
    MODELO_AUTO: 'Yaris',
    RANGO_ANOS: '2014-2019',
    MOTOR: '1.5 16V',
    OBSERVACIONES: 'Juego de 4 pastillas delanteras de compuesto cerámico de bajo desprendimiento de polvo y frenado suave.',
    PIDE_CHASIS: 'NO',
    FOTO: 'REP-001.jpg'
  },
  {
    CODIGO_INTERNO: 'REP-002',
    PRODUCTO: 'Disco de Freno Delantero Ventilado',
    RUBRO: 'Frenos',
    SUBRUBRO: 'Discos',
    FABRICANTE: 'TRW',
    CODIGO_OEM: '43512-02250',
    PRECIO_VENTA: '$ 38.500',
    STOCK_DISPONIBLE: 8,
    ESTADO: 'ORIGINAL',
    UNIVERSAL: 'NO',
    MARCA_AUTO: 'Toyota',
    MODELO_AUTO: 'Corolla',
    RANGO_ANOS: '2015-2020',
    MOTOR: '1.8 16V',
    OBSERVACIONES: 'Disco de freno ventilado de acero mecanizado con tratamiento anticorrosión negro en la campana.',
    PIDE_CHASIS: 'NO',
    FOTO: 'REP-002.jpg'
  },
  {
    CODIGO_INTERNO: 'REP-003',
    PRODUCTO: 'Filtro de Aceite Blindado',
    RUBRO: 'Filtros',
    SUBRUBRO: 'Filtro de Aceite',
    FABRICANTE: 'Mann-Filter',
    CODIGO_OEM: '26300-35505',
    PRECIO_VENTA: '$ 8.990',
    STOCK_DISPONIBLE: 25,
    ESTADO: 'ORIGINAL',
    UNIVERSAL: 'NO',
    MARCA_AUTO: 'Hyundai',
    MODELO_AUTO: 'Accent',
    RANGO_ANOS: '2015-2020',
    MOTOR: '1.4 / 1.6',
    OBSERVACIONES: 'Filtro de aceite roscado spin-on con válvula de retención de silicona y empaquetadura prelubricada.',
    PIDE_CHASIS: 'NO',
    FOTO: 'REP-003.jpg'
  },
  {
    CODIGO_INTERNO: 'REP-004',
    PRODUCTO: 'Filtro de Aire Motor',
    RUBRO: 'Filtros',
    SUBRUBRO: 'Filtro de Aire',
    FABRICANTE: 'Bosch',
    CODIGO_OEM: '9023764',
    PRECIO_VENTA: '$ 11.900',
    STOCK_DISPONIBLE: 18,
    ESTADO: 'ALTERNATIVO',
    UNIVERSAL: 'NO',
    MARCA_AUTO: 'Chevrolet',
    MODELO_AUTO: 'Sail',
    RANGO_ANOS: '2016-2021',
    MOTOR: '1.5L',
    OBSERVACIONES: 'Filtro de aire de panel plisado con marco sellador de poliuretano flexible de alta retención.',
    PIDE_CHASIS: 'NO',
    FOTO: 'REP-004.jpg'
  },
  {
    CODIGO_INTERNO: 'REP-005',
    PRODUCTO: 'Amortiguador Delantero a Gas',
    RUBRO: 'Suspensión',
    SUBRUBRO: 'Amortiguadores',
    FABRICANTE: 'KYB',
    CODIGO_OEM: '48510-42170',
    PRECIO_VENTA: '$ 48.900',
    STOCK_DISPONIBLE: 6,
    ESTADO: 'ORIGINAL',
    UNIVERSAL: 'NO',
    MARCA_AUTO: 'Toyota',
    MODELO_AUTO: 'RAV4',
    RANGO_ANOS: '2013-2018',
    MOTOR: '2.0 / 2.5',
    OBSERVACIONES: 'Amortiguador presurizado con nitrógeno de doble tubo con vástago cromado templado de alta resistencia.',
    PIDE_CHASIS: 'SI',
    FOTO: 'REP-005.jpg'
  },
  {
    CODIGO_INTERNO: 'REP-006',
    PRODUCTO: 'Kit de Embrague Prensa y Disco',
    RUBRO: 'Embrague',
    SUBRUBRO: 'Kit de Embragues',
    FABRICANTE: 'Sachs',
    CODIGO_OEM: '22100-69L00',
    PRECIO_VENTA: '$ 84.900',
    STOCK_DISPONIBLE: 5,
    ESTADO: 'ORIGINAL',
    UNIVERSAL: 'NO',
    MARCA_AUTO: 'Suzuki',
    MODELO_AUTO: 'Swift',
    RANGO_ANOS: '2012-2017',
    MOTOR: '1.2L',
    OBSERVACIONES: 'Kit incluye prensa de diafragma y disco con resortes amortiguadores de torsión reforzados.',
    PIDE_CHASIS: 'NO',
    FOTO: 'REP-006.jpg'
  },
  {
    CODIGO_INTERNO: 'REP-007',
    PRODUCTO: 'Radiador de Aluminio de Motor',
    RUBRO: 'Refrigeración',
    SUBRUBRO: 'Radiadores',
    FABRICANTE: 'Denso',
    CODIGO_OEM: '21410-1HJ0A',
    PRECIO_VENTA: '$ 54.900',
    STOCK_DISPONIBLE: 4,
    ESTADO: 'ORIGINAL',
    UNIVERSAL: 'NO',
    MARCA_AUTO: 'Nissan',
    MODELO_AUTO: 'Versa',
    RANGO_ANOS: '2013-2019',
    MOTOR: '1.6 16V',
    OBSERVACIONES: 'Radiador con panel de aluminio soldado y tanques plásticos de poliamida de alta presión.',
    PIDE_CHASIS: 'NO',
    FOTO: 'REP-007.jpg'
  },
  {
    CODIGO_INTERNO: 'REP-008',
    PRODUCTO: 'Bujía de Encendido Iridio',
    RUBRO: 'Encendido',
    SUBRUBRO: 'Bujías',
    FABRICANTE: 'NGK',
    CODIGO_OEM: '22401-ED71B',
    PRECIO_VENTA: '$ 7.990',
    STOCK_DISPONIBLE: 32,
    ESTADO: 'ORIGINAL',
    UNIVERSAL: 'NO',
    MARCA_AUTO: 'Nissan',
    MODELO_AUTO: 'Sentra',
    RANGO_ANOS: '2014-2019',
    MOTOR: '1.8L',
    OBSERVACIONES: 'Bujía con electrodo central de iridio láser de 0.6mm para una ignición inmediata y vida útil extendida.',
    PIDE_CHASIS: 'NO',
    FOTO: 'REP-008.jpg'
  },
  {
    CODIGO_INTERNO: 'REP-009',
    PRODUCTO: 'Terminal de Dirección Exterior',
    RUBRO: 'Dirección',
    SUBRUBRO: 'Terminal de Dirección',
    FABRICANTE: 'Lemforder',
    CODIGO_OEM: '45046-09260',
    PRECIO_VENTA: '$ 16.500',
    STOCK_DISPONIBLE: 12,
    ESTADO: 'ORIGINAL',
    UNIVERSAL: 'NO',
    MARCA_AUTO: 'Toyota',
    MODELO_AUTO: 'Corolla',
    RANGO_ANOS: '2014-2019',
    MOTOR: '1.8L',
    OBSERVACIONES: 'Terminal exterior de dirección con rótula esférica de precisión y fuelle protector de goma nitrílica.',
    PIDE_CHASIS: 'NO',
    FOTO: 'REP-009.jpg'
  },
  {
    CODIGO_INTERNO: 'REP-010',
    PRODUCTO: 'Aceite de Motor Sintético 5W-30 4L',
    RUBRO: 'Aceite',
    SUBRUBRO: 'Aceite de Motor',
    FABRICANTE: 'Castrol',
    CODIGO_OEM: 'CAS-5W30-4L',
    PRECIO_VENTA: '$ 34.990',
    STOCK_DISPONIBLE: 20,
    ESTADO: 'ORIGINAL',
    UNIVERSAL: 'SI',
    MARCA_AUTO: '',
    MODELO_AUTO: '',
    RANGO_ANOS: '',
    MOTOR: '',
    OBSERVACIONES: 'Aceite sintético de alto rendimiento formulado para motores gasolina y diésel livianos. Especificación API SN / ACEA C3.',
    PIDE_CHASIS: 'NO',
    FOTO: 'REP-010.jpg'
  }
];

// 3. Generar el archivo Excel
function crearExcel() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(PRODUCTOS_DEV, { header: HEADERS_VENDEDOR });

  // Ajustar anchos de columnas
  ws['!cols'] = [
    { wch: 14 }, // COD_REPUESTO
    { wch: 38 }, // PRODUCTO
    { wch: 16 }, // RUBRO
    { wch: 22 }, // SUBRUBRO
    { wch: 14 }, // FABRICANTE
    { wch: 15 }, // CODIGO_OEM
    { wch: 14 }, // PRECIO_VENTA
    { wch: 18 }, // STOCK_DISPONIBLE
    { wch: 14 }, // ESTADO
    { wch: 12 }, // UNIVERSAL
    { wch: 14 }, // MARCA_AUTO
    { wch: 15 }, // MODELO_AUTO
    { wch: 14 }, // RANGO_ANOS
    { wch: 12 }, // MOTOR
    { wch: 50 }, // OBSERVACIONES
    { wch: 14 }, // PIDE_CHASIS
    { wch: 14 }  // FOTO
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Lista_Repuestos');

  const excelPath = path.join(outputDir, 'Plantilla_Vendedor_Autopartes_Dev.xlsx');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  fs.writeFileSync(excelPath, buf);
  console.log(`[OK] Excel generado en: ${excelPath}`);
}

// 4. Copiar y descargar imágenes
const IMAGENES_INFO = [
  // 3 imágenes generadas con IA (guardadas en artifacts)
  {
    sku: 'REP-001',
    tipo: 'local',
    archivoLocal: path.join(artifactsDir, 'rep_pastillas_freno_1789522555892.jpg'),
    destino: 'REP-001.jpg'
  },
  {
    sku: 'REP-002',
    tipo: 'local',
    archivoLocal: path.join(artifactsDir, 'rep_disco_freno_1789522643258.jpg'),
    destino: 'REP-002.jpg'
  },
  {
    sku: 'REP-003',
    tipo: 'local',
    archivoLocal: path.join(artifactsDir, 'rep_filtro_aceite_1789522662397.jpg'),
    destino: 'REP-003.jpg'
  },
  // 7 imágenes de alta calidad con licencia libre (Wikimedia Commons)
  {
    sku: 'REP-004',
    tipo: 'remota',
    wikiFile: 'File:Soucastka 01.JPG',
    destino: 'REP-004.jpg'
  },
  {
    sku: 'REP-005',
    tipo: 'remota',
    wikiFile: 'File:Tlumič 01.jpg',
    destino: 'REP-005.jpg'
  },
  {
    sku: 'REP-006',
    tipo: 'remota',
    wikiFile: 'File:Clutchdisc.jpg',
    destino: 'REP-006.jpg'
  },
  {
    sku: 'REP-007',
    tipo: 'remota',
    wikiFile: 'File:Automobile radiator.jpg',
    destino: 'REP-007.jpg'
  },
  {
    sku: 'REP-008',
    tipo: 'remota',
    wikiFile: 'File:Bujía Bosch Yttrium Super Plus.JPG',
    destino: 'REP-008.jpg'
  },
  {
    sku: 'REP-009',
    tipo: 'remota',
    wikiFile: 'File:Tie rod end.jpeg',
    destino: 'REP-009.jpg'
  },
  {
    sku: 'REP-010',
    tipo: 'remota',
    wikiFile: 'File:Woltec Motor Oil ULTRAtec 5w30 API SN Fully Synthetic.jpg',
    destino: 'REP-010.jpg'
  }
];

async function prepararImagenes() {
  console.log('[PROCESO] Preparando las 10 imágenes de repuestos...');

  for (const item of IMAGENES_INFO) {
    const destinoPath = path.join(fotosDir, item.destino);

    if (item.tipo === 'local') {
      if (fs.existsSync(item.archivoLocal)) {
        fs.copyFileSync(item.archivoLocal, destinoPath);
        console.log(`[OK] ${item.sku} copiada desde IA local -> ${item.destino}`);
      } else {
        console.error(`[ERROR] Archivo local no encontrado para ${item.sku}: ${item.archivoLocal}`);
      }
    } else if (item.tipo === 'remota') {
      try {
        const apiRes = await fetch(
          `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(item.wikiFile)}&prop=imageinfo&iiprop=url&format=json`,
          { headers: { 'User-Agent': 'RepuesTopDevData/1.0 (dev@repuestop.cl)' } }
        );
        const data = await apiRes.json();
        const page = Object.values(data.query?.pages || {})[0];
        const imgUrl = page?.imageinfo?.[0]?.url;

        if (!imgUrl) {
          throw new Error(`No se encontró URL para ${item.wikiFile}`);
        }

        const imgRes = await fetch(imgUrl, { headers: { 'User-Agent': 'RepuesTopDevData/1.0 (dev@repuestop.cl)' } });
        if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status} al descargar imagen`);

        const arrayBuffer = await imgRes.arrayBuffer();
        fs.writeFileSync(destinoPath, Buffer.from(arrayBuffer));
        console.log(`[OK] ${item.sku} descargada desde Commons (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB) -> ${item.destino}`);
      } catch (err) {
        console.error(`[ERROR] Error al obtener ${item.sku}:`, err.message);
      }
    }
  }
}

// 5. Crear archivo ZIP con todas las imágenes
async function crearZipFotos() {
  console.log('[PROCESO] Comprimiendo fotos en fotos_repuestos.zip...');
  const zip = new JSZip();

  const files = fs.readdirSync(fotosDir);
  for (const file of files) {
    if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg')) {
      const content = fs.readFileSync(path.join(fotosDir, file));
      zip.file(file, content);
    }
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const zipPath = path.join(outputDir, 'fotos_repuestos.zip');
  fs.writeFileSync(zipPath, zipBuffer);
  console.log(`[OK] Archivo ZIP creado con ${files.length} fotos: ${zipPath}`);
}

async function main() {
  try {
    crearExcel();
    await prepararImagenes();
    await crearZipFotos();
    console.log('\n========================================');
    console.log('TODO GENERADO EXITOSAMENTE PARA AMBIENTE DEV');
    console.log('Directorio: datos_prueba_dev/');
    console.log('1. Plantilla_Vendedor_Autopartes_Dev.xlsx');
    console.log('2. fotos/ (10 imágenes JPG nombradas por SKU)');
    console.log('3. fotos_repuestos.zip (archivo ZIP listo para subir)');
    console.log('========================================\n');
  } catch (err) {
    console.error('Error durante la generación:', err);
  }
}

main();

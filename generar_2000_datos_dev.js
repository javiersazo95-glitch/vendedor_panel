/**
 * Genera el archivo de prueba grande del ambiente dev: el Excel "como lo manda un
 * vendedor" (columnas propias, precios con signo peso, SKU repetidos) y el ZIP con las
 * fotos que ese Excel nombra.
 *
 * Tres cosas que este archivo tiene que respetar, y por qué:
 *
 * 1. Los vehículos salen del catálogo real del backend
 *    (`catalogo_repuestop_modelos_versiones_2000_2026.csv`), con sus años de inicio y fin
 *    de modelo. Antes había un "Chevrolet Spark 2011-2017" y el Spark del catálogo llega
 *    hasta 2015: el backend descarta esa compatibilidad y el repuesto se publica sin
 *    aparecer en la búsqueda por vehículo. Un archivo de prueba que trae compatibilidades
 *    imposibles prueba el camino del error, no el camino normal.
 *
 * 2. Buena parte del catálogo calza con las dos patentes mockeadas de dev, ABCD11
 *    (Toyota Yaris 2018 1.5 GLI) y ABCD22 (Hyundai Accent 2020 1.6 GLS). Sin eso, buscar
 *    por patente en dev no devuelve nada aunque la carga haya funcionado.
 *
 * 3. Hay SKU repetidos a propósito: es como los vendedores escriben las compatibilidades
 *    múltiples (una fila por vehículo) y es lo que ejercita el paso de "Adaptar mi
 *    plantilla" que junta los códigos repetidos en la hoja `compatibilidades`. Por eso el
 *    archivo ya no tiene 2.000 filas exactas: tiene 2.000 repuestos y bastantes más filas.
 *
 * Las fotos salen de `datos_prueba_dev/fotos_pool/`, que es la misma carpeta que se
 * comprime en el ZIP: lo que se ve en la carpeta es lo que llega en el ZIP. El pool se
 * completa con `node descargar_fotos_pool.js` (fotos de licencia libre, ver
 * CREDITOS_FOTOS.md).
 *
 * Uso: node generar_2000_datos_dev.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.join(__dirname, 'datos_prueba_dev');
const poolDir = path.join(outputDir, 'fotos_pool');
const sourceFotosDir = path.join(outputDir, 'fotos');

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(poolDir, { recursive: true });

/** Cuántos repuestos distintos trae el archivo (filas totales son más, por las compatibilidades). */
const TOTAL_REPUESTOS = 2000;

// Columnas del vendedor para ejercitar el flujo "Adaptar mi plantilla". VERSION_AUTO no
// tiene equivalente en la plantilla oficial a propósito: es una columna que el vendedor
// trae y el mapper tiene que ofrecer mandar a la descripción o dejar fuera.
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
  'VERSION_AUTO',
  'RANGO_ANOS',
  'MOTOR',
  'OBSERVACIONES',
  'PIDE_CHASIS',
  'FOTO'
];

// Fotos que se copian desde fotos/ (el set original de 10) con nombre de catálogo. Las
// demás las deja `descargar_fotos_pool.js` directamente en fotos_pool/.
const FOTOS_BASE = [
  { origen: 'REP-001.jpg', destino: 'pastillas_freno.jpg' },
  { origen: 'REP-002.jpg', destino: 'disco_freno.jpg' },
  { origen: 'REP-003.jpg', destino: 'filtro_aceite.jpg' },
  { origen: 'REP-004.jpg', destino: 'filtro_aire.jpg' },
  { origen: 'REP-005.jpg', destino: 'amortiguador.jpg' },
  { origen: 'REP-006.jpg', destino: 'kit_embrague.jpg' },
  { origen: 'REP-007.jpg', destino: 'radiador_motor.jpg' },
  { origen: 'REP-008.jpg', destino: 'bujia_iridio.jpg' },
  { origen: 'REP-009.jpg', destino: 'terminal_direccion.jpg' },
  { origen: 'REP-010.jpg', destino: 'aceite_motor.jpg' },
  { origen: 'REP-009.jpg', destino: 'repuesto_mecanico.jpg' }
];

function copiarFotosBase() {
  console.log('[PROCESO] Copiando las fotos base a fotos_pool/...');
  for (const { origen, destino } of FOTOS_BASE) {
    const src = path.join(sourceFotosDir, origen);
    if (!fs.existsSync(src)) {
      console.warn(`  [ALERTA] No se encontró origen: ${src}`);
      continue;
    }
    fs.copyFileSync(src, path.join(poolDir, destino));
  }
  console.log(`  [OK] ${FOTOS_BASE.length} fotos base en el pool.`);
}

/**
 * Tipos de repuesto, uno por subcategoría real del backend (V2026080503) para que el
 * archivo no dependa de que alguien recuerde cómo se llama cada subcategoría.
 *
 * `fotos` es una lista porque hay subcategorías con más de una foto en el pool: se reparten
 * entre los repuestos de ese tipo para que el catálogo no se vea con la misma imagen
 * doscientas veces.
 */
const TIPOS_REPUESTO = [
  // Frenos
  { categoria: 'Frenos', subcategoria: 'Pastillas de Freno', nombre: 'Pastillas de Freno Delanteras', fotos: ['pastillas_freno.jpg', 'pastillas_freno_ceramicas.jpg'], marcas: ['Brembo', 'TRW', 'Bosch', 'Ferodo', 'Textar', 'Akebono'], precioBase: 25000, rangoPrecio: 35000 },
  { categoria: 'Frenos', subcategoria: 'Pastillas de Freno', nombre: 'Pastillas de Freno Traseras Cerámicas', fotos: ['pastillas_freno_ceramicas.jpg', 'pastillas_freno.jpg'], marcas: ['Brembo', 'ATE', 'Jurid', 'Ferodo'], precioBase: 22000, rangoPrecio: 30000 },
  { categoria: 'Frenos', subcategoria: 'Discos', nombre: 'Disco de Freno Ventilado', fotos: ['disco_freno_ventilado.jpg', 'disco_freno.jpg'], marcas: ['Brembo', 'TRW', 'ATE', 'Textar'], precioBase: 32000, rangoPrecio: 48000 },
  { categoria: 'Frenos', subcategoria: 'Discos', nombre: 'Disco de Freno Sólido', fotos: ['disco_freno.jpg', 'disco_freno_ventilado.jpg'], marcas: ['Bosch', 'TRW', 'Ferodo'], precioBase: 27000, rangoPrecio: 38000 },
  { categoria: 'Frenos', subcategoria: 'Tambores', nombre: 'Tambor de Freno Trasero', fotos: ['tambor_freno.jpg'], marcas: ['TRW', 'Bosch', 'Ferodo'], precioBase: 34000, rangoPrecio: 42000 },
  { categoria: 'Frenos', subcategoria: 'Caliper', nombre: 'Caliper de Freno Delantero', fotos: ['caliper_freno.jpg'], marcas: ['Brembo', 'ATE', 'TRW'], precioBase: 68000, rangoPrecio: 95000 },

  // Filtros
  { categoria: 'Filtros', subcategoria: 'Filtro de Aceite', nombre: 'Filtro de Aceite Blindado', fotos: ['filtro_aceite_blindado.jpg', 'filtro_aceite.jpg'], marcas: ['Mann-Filter', 'Bosch', 'Mahle', 'Fram'], precioBase: 7000, rangoPrecio: 9000 },
  { categoria: 'Filtros', subcategoria: 'Filtro de Aire', nombre: 'Filtro de Aire de Motor', fotos: ['filtro_aire.jpg'], marcas: ['Mann-Filter', 'Mahle', 'Fram', 'Bosch'], precioBase: 9000, rangoPrecio: 12000 },
  { categoria: 'Filtros', subcategoria: 'Filtro de Combustible', nombre: 'Filtro de Combustible en Línea', fotos: ['filtro_combustible.jpg'], marcas: ['Bosch', 'Mann-Filter', 'Delphi'], precioBase: 11000, rangoPrecio: 16000 },
  { categoria: 'Filtros', subcategoria: 'Filtro de Polen', nombre: 'Filtro de Polen con Carbón Activo', fotos: ['filtro_polen.jpg'], marcas: ['Mann-Filter', 'Mahle', 'Bosch'], precioBase: 10000, rangoPrecio: 14000 },

  // Suspensión
  { categoria: 'Suspensión', subcategoria: 'Amortiguadores', nombre: 'Amortiguador Delantero a Gas', fotos: ['amortiguador.jpg'], marcas: ['KYB', 'Monroe', 'Sachs', 'Cofap'], precioBase: 48000, rangoPrecio: 65000 },
  { categoria: 'Suspensión', subcategoria: 'Amortiguadores', nombre: 'Amortiguador Trasero Reforzado', fotos: ['amortiguador.jpg'], marcas: ['KYB', 'Monroe', 'Sachs'], precioBase: 42000, rangoPrecio: 58000 },
  { categoria: 'Suspensión', subcategoria: 'Bandejas', nombre: 'Bandeja de Suspensión Delantera', fotos: ['suspension_delantera.jpg'], marcas: ['Febi', 'Lemforder', 'TRW', 'Moog'], precioBase: 38000, rangoPrecio: 52000 },
  { categoria: 'Suspensión', subcategoria: 'Bieletas', nombre: 'Bieleta de Barra Estabilizadora', fotos: ['rotula_suspension.jpg'], marcas: ['Febi', 'TRW', 'Moog', 'SKF'], precioBase: 12000, rangoPrecio: 18000 },
  { categoria: 'Suspensión', subcategoria: 'Rótulas', nombre: 'Rótula de Suspensión Inferior', fotos: ['rotula_suspension.jpg'], marcas: ['Lemforder', 'Moog', 'TRW', 'Febi'], precioBase: 18000, rangoPrecio: 26000 },
  { categoria: 'Suspensión', subcategoria: 'Espirales', nombre: 'Espiral de Suspensión Progresivo', fotos: ['suspension_delantera.jpg'], marcas: ['KYB', 'Monroe', 'Sachs'], precioBase: 29000, rangoPrecio: 40000 },

  // Motor
  { categoria: 'Motor', subcategoria: 'Empaquetaduras', nombre: 'Juego de Empaquetaduras de Culata', fotos: ['empaquetadura_culata.jpg'], marcas: ['Ajusa', 'Elring', 'Mahle'], precioBase: 42000, rangoPrecio: 70000 },
  { categoria: 'Motor', subcategoria: 'Pistones', nombre: 'Kit de Anillos de Pistón', fotos: ['piston_motor.jpg'], marcas: ['Mahle', 'Elring', 'Ajusa'], precioBase: 55000, rangoPrecio: 85000 },
  { categoria: 'Motor', subcategoria: 'Culata', nombre: 'Culata Rectificada de Motor', fotos: ['culata_motor.jpg'], marcas: ['Mahle', 'Ajusa', 'Elring'], precioBase: 180000, rangoPrecio: 140000 },
  { categoria: 'Motor', subcategoria: 'Válvula de Admisión y Escape', nombre: 'Juego de Válvulas de Admisión y Escape', fotos: ['culata_motor.jpg'], marcas: ['Mahle', 'Elring', 'Febi'], precioBase: 46000, rangoPrecio: 62000 },
  { categoria: 'Motor', subcategoria: 'Bombas de Agua', nombre: 'Bomba de Agua de Motor', fotos: ['repuesto_mecanico.jpg'], marcas: ['Gates', 'SKF', 'Dayco', 'Aisin'], precioBase: 34000, rangoPrecio: 48000 },

  // Embrague
  { categoria: 'Embrague', subcategoria: 'Kit de Embragues', nombre: 'Kit de Embrague Prensa y Disco', fotos: ['kit_embrague.jpg', 'embrague_disco.jpg'], marcas: ['Sachs', 'Valeo', 'LuK', 'Exedy', 'Aisin'], precioBase: 145000, rangoPrecio: 120000 },
  { categoria: 'Embrague', subcategoria: 'Bombas de Embrague', nombre: 'Bomba Principal de Embrague', fotos: ['repuesto_mecanico.jpg'], marcas: ['Sachs', 'Valeo', 'LuK'], precioBase: 38000, rangoPrecio: 45000 },
  { categoria: 'Embrague', subcategoria: 'Cilindro de Embragues', nombre: 'Cilindro Auxiliar de Embrague', fotos: ['repuesto_mecanico.jpg'], marcas: ['Sachs', 'Valeo', 'Aisin'], precioBase: 34000, rangoPrecio: 42000 },
  { categoria: 'Embrague', subcategoria: 'Volantes de Motor', nombre: 'Volante de Motor Bimasa', fotos: ['embrague_disco.jpg'], marcas: ['LuK', 'Sachs', 'Valeo'], precioBase: 320000, rangoPrecio: 180000 },

  // Refrigeración
  { categoria: 'Refrigeración', subcategoria: 'Radiador de Agua', nombre: 'Radiador de Agua de Aluminio', fotos: ['radiador_agua.jpg', 'radiador_motor.jpg'], marcas: ['Denso', 'Valeo', 'Hella', 'Mahle'], precioBase: 95000, rangoPrecio: 90000 },
  { categoria: 'Refrigeración', subcategoria: 'Termostato', nombre: 'Termostato con Carcasa Integrada', fotos: ['deposito_refrigerante.jpg'], marcas: ['Gates', 'Febi', 'Mahle', 'Valeo'], precioBase: 18000, rangoPrecio: 26000 },
  { categoria: 'Refrigeración', subcategoria: 'Depósito Radiador', nombre: 'Depósito de Expansión de Refrigerante', fotos: ['deposito_refrigerante.jpg'], marcas: ['Febi', 'Hella', 'Valeo'], precioBase: 21000, rangoPrecio: 28000 },
  { categoria: 'Refrigeración', subcategoria: 'Electroventilador', nombre: 'Electroventilador de Radiador', fotos: ['radiador_agua.jpg'], marcas: ['Denso', 'Valeo', 'Hella'], precioBase: 88000, rangoPrecio: 95000 },

  // Dirección
  { categoria: 'Dirección', subcategoria: 'Terminal de Dirección', nombre: 'Terminal de Dirección Exterior', fotos: ['terminal_direccion.jpg'], marcas: ['Lemforder', 'TRW', 'Moog', 'Febi'], precioBase: 14000, rangoPrecio: 20000 },
  { categoria: 'Dirección', subcategoria: 'Terminal Axial', nombre: 'Terminal Axial de Dirección', fotos: ['terminal_direccion.jpg'], marcas: ['Lemforder', 'TRW', 'SKF'], precioBase: 16000, rangoPrecio: 22000 },
  { categoria: 'Dirección', subcategoria: 'Cremallera de Dirección', nombre: 'Cremallera de Dirección Asistida', fotos: ['cremallera_direccion.jpg'], marcas: ['TRW', 'Bosch', 'Febi'], precioBase: 240000, rangoPrecio: 160000 },
  { categoria: 'Dirección', subcategoria: 'Bomba de Dirección', nombre: 'Bomba Hidráulica de Dirección', fotos: ['bomba_direccion.jpg'], marcas: ['Bosch', 'TRW', 'Febi'], precioBase: 130000, rangoPrecio: 110000 },

  // Encendido
  { categoria: 'Encendido', subcategoria: 'Bujías', nombre: 'Bujía de Iridio Láser', fotos: ['bujia_iridio.jpg', 'bujia_encendido.jpg'], marcas: ['NGK', 'Denso', 'Bosch', 'NTK'], precioBase: 9500, rangoPrecio: 14000 },
  { categoria: 'Encendido', subcategoria: 'Bujías', nombre: 'Bujía de Platino Doble', fotos: ['bujia_encendido.jpg', 'bujia_iridio.jpg'], marcas: ['NGK', 'Bosch', 'Denso'], precioBase: 7500, rangoPrecio: 10000 },
  { categoria: 'Encendido', subcategoria: 'Bobinas', nombre: 'Bobina de Encendido Individual', fotos: ['bobina_encendido.jpg'], marcas: ['Bosch', 'Denso', 'Delphi', 'Valeo'], precioBase: 38000, rangoPrecio: 45000 },
  { categoria: 'Encendido', subcategoria: 'Cables de Bujía', nombre: 'Juego de Cables de Bujía de Silicona', fotos: ['bobina_encendido.jpg'], marcas: ['NGK', 'Bosch', 'Delphi'], precioBase: 24000, rangoPrecio: 30000 },
  { categoria: 'Encendido', subcategoria: 'Motor de Partida', nombre: 'Motor de Partida Reacondicionado', fotos: ['alternador.jpg'], marcas: ['Bosch', 'Denso', 'Valeo'], precioBase: 145000, rangoPrecio: 120000 },

  // Distribución
  { categoria: 'Distribución', subcategoria: 'Tensores Hidráulicos Distribución', nombre: 'Kit de Correa de Distribución y Tensor', fotos: ['correa_distribucion.jpg'], marcas: ['Gates', 'Dayco', 'INA', 'SKF'], precioBase: 78000, rangoPrecio: 85000 },
  { categoria: 'Distribución', subcategoria: 'Cadenas Distribución', nombre: 'Cadena de Distribución Sincronizada', fotos: ['cadena_distribucion.jpg'], marcas: ['INA', 'Febi', 'Aisin', 'Dayco'], precioBase: 92000, rangoPrecio: 95000 },
  { categoria: 'Distribución', subcategoria: 'Piñones', nombre: 'Piñón de Eje de Levas', fotos: ['cadena_distribucion.jpg'], marcas: ['INA', 'Febi', 'Gates'], precioBase: 46000, rangoPrecio: 55000 },
  { categoria: 'Distribución', subcategoria: 'Bombas de Agua', nombre: 'Kit de Distribución con Bomba de Agua', fotos: ['correa_distribucion.jpg'], marcas: ['Gates', 'SKF', 'Dayco'], precioBase: 118000, rangoPrecio: 110000 },

  // Aceite (universal: no lleva vehículo)
  { categoria: 'Aceite', subcategoria: 'Aceite de Motor', nombre: 'Aceite de Motor Sintético 5W-30 4L', fotos: ['aceite_motor.jpg', 'aceite_motor_botella.jpg'], marcas: ['Castrol', 'Mobil'], precioBase: 38000, rangoPrecio: 22000, universal: true },
  { categoria: 'Aceite', subcategoria: 'Aceite de Motor', nombre: 'Aceite de Motor Sintético 5W-40 4L', fotos: ['aceite_motor_botella.jpg', 'aceite_motor.jpg'], marcas: ['Castrol', 'Mobil'], precioBase: 40000, rangoPrecio: 24000, universal: true },
  { categoria: 'Aceite', subcategoria: 'Aceite de Caja', nombre: 'Aceite de Transmisión Manual 75W-90 1L', fotos: ['aceite_caja.jpg'], marcas: ['Castrol', 'Mobil'], precioBase: 16000, rangoPrecio: 12000, universal: true },
];

/**
 * Vehículos del catálogo real del backend, con los años de inicio y fin del modelo tal como
 * los trae `catalogo_repuestop_modelos_versiones_2000_2026.csv`. Toda compatibilidad que
 * genere este archivo cae dentro de esos años: fuera de ahí el backend no encuentra la
 * versión y descarta la compatibilidad (es lo que pasaba con el Spark hasta 2017, cuando el
 * catálogo lo tiene hasta 2015).
 */
const VEHICULOS = [
  { marca: 'Toyota', modelo: 'Yaris', versiones: ['GLI', 'XLI', 'S', 'Sport'], desde: 2000, hasta: 2026, motores: ['1.5L', '1.3L'] },
  { marca: 'Toyota', modelo: 'Corolla', versiones: ['GLI', 'XLI', 'LE', 'XLE'], desde: 2000, hasta: 2026, motores: ['1.8L', '1.6L', '2.0L'] },
  { marca: 'Toyota', modelo: 'RAV4', versiones: ['LE', 'XLE', 'Limited', 'Adventure'], desde: 2000, hasta: 2026, motores: ['2.0L', '2.5L'] },
  { marca: 'Toyota', modelo: 'Hilux', versiones: ['DX', 'SR', 'SR5', 'SRV'], desde: 2000, hasta: 2026, motores: ['2.4L D-4D', '2.8L D-4D'] },
  { marca: 'Hyundai', modelo: 'Accent', versiones: ['GL', 'GLS', 'Limited', 'Value'], desde: 2000, hasta: 2026, motores: ['1.6L', '1.4L'] },
  { marca: 'Hyundai', modelo: 'Elantra', versiones: ['GL', 'GLS', 'Limited'], desde: 2000, hasta: 2026, motores: ['1.6L', '2.0L'] },
  { marca: 'Hyundai', modelo: 'Tucson', versiones: ['GL', 'GLS', 'Limited'], desde: 2005, hasta: 2026, motores: ['2.0L', '2.0L CRDi'] },
  { marca: 'Hyundai', modelo: 'Creta', versiones: ['GL', 'GLS', 'Limited'], desde: 2015, hasta: 2026, motores: ['1.6L', '2.0L'] },
  { marca: 'Nissan', modelo: 'Versa', versiones: ['Sense', 'Advance', 'Exclusive'], desde: 2012, hasta: 2026, motores: ['1.6L'] },
  { marca: 'Nissan', modelo: 'Sentra', versiones: ['XE', 'SE', 'Advance', 'Exclusive'], desde: 2000, hasta: 2026, motores: ['1.8L', '2.0L'] },
  { marca: 'Nissan', modelo: 'March', versiones: ['Sense', 'Advance', 'XE'], desde: 2011, hasta: 2022, motores: ['1.6L'] },
  { marca: 'Nissan', modelo: 'Qashqai', versiones: ['Sense', 'Advance', 'Exclusive'], desde: 2007, hasta: 2026, motores: ['2.0L'] },
  { marca: 'Chevrolet', modelo: 'Sail', versiones: ['LS', 'LT'], desde: 2011, hasta: 2026, motores: ['1.5L'] },
  { marca: 'Chevrolet', modelo: 'Spark', versiones: ['LS', 'LT', 'LTZ'], desde: 2005, hasta: 2015, motores: ['1.0L', '1.2L'] },
  { marca: 'Chevrolet', modelo: 'Spark GT', versiones: ['LT', 'LTZ'], desde: 2010, hasta: 2022, motores: ['1.2L'] },
  { marca: 'Chevrolet', modelo: 'Onix', versiones: ['LT', 'LTZ', 'Premier'], desde: 2013, hasta: 2026, motores: ['1.0L Turbo', '1.4L'] },
  { marca: 'Chevrolet', modelo: 'Tracker', versiones: ['LT', 'LTZ', 'Premier'], desde: 2013, hasta: 2026, motores: ['1.2L Turbo', '1.8L'] },
  { marca: 'Kia', modelo: 'Rio', versiones: ['LX', 'EX', 'SX'], desde: 2000, hasta: 2023, motores: ['1.4L', '1.6L'] },
  { marca: 'Kia', modelo: 'Morning', versiones: ['LX', 'EX'], desde: 2004, hasta: 2026, motores: ['1.0L', '1.2L'] },
  { marca: 'Kia', modelo: 'Sportage', versiones: ['LX', 'EX', 'SX'], desde: 2000, hasta: 2026, motores: ['2.0L', '2.0L CRDi'] },
  { marca: 'Kia', modelo: 'Cerato', versiones: ['LX', 'EX', 'SX'], desde: 2004, hasta: 2026, motores: ['1.6L', '2.0L'] },
  { marca: 'Suzuki', modelo: 'Swift', versiones: ['GA', 'GL', 'GLX'], desde: 2000, hasta: 2026, motores: ['1.2L', '1.4L'] },
  { marca: 'Suzuki', modelo: 'Vitara', versiones: ['GL', 'GLX'], desde: 2000, hasta: 2026, motores: ['1.6L'] },
  { marca: 'Suzuki', modelo: 'S-Cross', versiones: ['GL', 'GLX'], desde: 2014, hasta: 2026, motores: ['1.4L'] },
  { marca: 'Mazda', modelo: 'CX-5', versiones: ['Touring', 'Grand Touring'], desde: 2013, hasta: 2026, motores: ['2.0L', '2.5L'] },
];

/**
 * Los dos vehículos que dev tiene mockeados por patente (DevDataInitializer). Se les da
 * rangos que contienen el año del auto: si no, el vendedor publica y la búsqueda por
 * patente sigue sin devolver nada, que es justo lo que se quiere poder probar.
 */
const PATENTES_MOCK = [
  {
    patente: 'ABCD11',
    marca: 'Toyota',
    modelo: 'Yaris',
    version: 'GLI',
    motor: '1.5L',
    anio: 2018,
    rangos: [[2014, 2019], [2016, 2020], [2017, 2021], [2015, 2018]],
  },
  {
    patente: 'ABCD22',
    marca: 'Hyundai',
    modelo: 'Accent',
    version: 'GLS',
    motor: '1.6L',
    anio: 2020,
    rangos: [[2018, 2022], [2017, 2021], [2019, 2023], [2016, 2020]],
  },
];

/** Secuencia determinista: el archivo tiene que salir igual en cada corrida. */
function pseudoAzar(semilla) {
  const x = Math.sin(semilla * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const elegir = (lista, semilla) => lista[Math.floor(pseudoAzar(semilla) * lista.length) % lista.length];

/**
 * Un rango de años dentro de los años del modelo. Nunca se sale de [desde, hasta]: ese es
 * todo el punto de haber traído los años reales del catálogo.
 */
function rangoDeAnios(vehiculo, semilla) {
  const ancho = Math.min(3 + Math.floor(pseudoAzar(semilla) * 5), vehiculo.hasta - vehiculo.desde);
  const margen = vehiculo.hasta - vehiculo.desde - ancho;
  const inicio = vehiculo.desde + Math.floor(pseudoAzar(semilla + 0.5) * (margen + 1));
  return { anioDesde: inicio, anioHasta: inicio + ancho };
}

/** La compatibilidad de un repuesto cualquiera: vehículo del catálogo, versión y años válidos. */
function compatibilidadDeCatalogo(semilla) {
  const vehiculo = VEHICULOS[Math.floor(pseudoAzar(semilla) * VEHICULOS.length) % VEHICULOS.length];
  const { anioDesde, anioHasta } = rangoDeAnios(vehiculo, semilla + 1);
  return {
    marca: vehiculo.marca,
    modelo: vehiculo.modelo,
    version: elegir(vehiculo.versiones, semilla + 2),
    motor: elegir(vehiculo.motores, semilla + 3),
    anioDesde,
    anioHasta,
  };
}

/** La compatibilidad que hace que el repuesto aparezca al buscar una de las patentes mock. */
function compatibilidadDePatente(indicePatente, semilla) {
  const mock = PATENTES_MOCK[indicePatente % PATENTES_MOCK.length];
  const [anioDesde, anioHasta] = mock.rangos[Math.floor(pseudoAzar(semilla) * mock.rangos.length) % mock.rangos.length];
  return {
    marca: mock.marca,
    modelo: mock.modelo,
    version: mock.version,
    motor: mock.motor,
    anioDesde,
    anioHasta,
    patente: mock.patente,
  };
}

const textoDeVehiculo = (c) => `${c.marca} ${c.modelo} ${c.version} ${c.anioDesde}-${c.anioHasta}`;

/**
 * Arma las filas del Excel del vendedor.
 *
 * Devuelve también el resumen para poder afirmar en la consola —y en el test— cuántos
 * repuestos calzan con cada patente mock, que es el dato por el que se hizo todo esto.
 */
function generarFilas() {
  console.log(`[PROCESO] Generando ${TOTAL_REPUESTOS} repuestos con sus compatibilidades...`);
  const filas = [];
  const resumen = { repuestos: 0, universales: 0, filasExtra: 0, skusRepetidos: 0, porPatente: { ABCD11: new Set(), ABCD22: new Set() } };

  for (let i = 1; i <= TOTAL_REPUESTOS; i++) {
    const sku = `DEV-${String(i).padStart(5, '0')}`;
    const tipo = TIPOS_REPUESTO[i % TIPOS_REPUESTO.length];
    const marcaRepuesto = tipo.marcas[i % tipo.marcas.length];
    const foto = tipo.fotos[i % tipo.fotos.length];

    // Un repuesto de cada 30 se declara universal aunque su tipo no lo sea: pasa en la vida
    // real (kits genéricos) y deja filas sin compatibilidad para revisar ese camino.
    const esUniversal = !!tipo.universal || i % 30 === 0;

    // Un tercio del catálogo apunta a alguna de las dos patentes mock.
    const apuntaAPatente = !esUniversal && i % 3 !== 0;
    const compatibilidades = [];
    if (!esUniversal) {
      compatibilidades.push(apuntaAPatente
        ? compatibilidadDePatente(i, i * 1.7)
        : compatibilidadDeCatalogo(i * 2.3));

      // Uno de cada seis repuestos trae compatibilidades múltiples: el mismo código repetido
      // con otro vehículo o con otra versión del mismo. Es lo que ejercita el paso que junta
      // los códigos repetidos en la hoja `compatibilidades`.
      if (i % 6 === 0) {
        const extras = 1 + Math.floor(pseudoAzar(i * 3.1) * 3);
        for (let e = 0; e < extras; e++) {
          // Las extra alternan entre la otra patente mock y el catálogo general, así que un
          // mismo repuesto termina sirviendo a los dos autos mockeados.
          const extra = e === 0
            ? compatibilidadDePatente(i + 1, i * 5.3 + e)
            : compatibilidadDeCatalogo(i * 7.9 + e);
          compatibilidades.push(extra);
        }
      }
    }

    const condicion = i % 5 === 0 ? 'ALTERNATIVO' : 'ORIGINAL';
    const requiereChasis = !esUniversal && i % 30 === 7 ? 'SI' : 'NO';
    const precioNum = Math.round((tipo.precioBase + ((i * 137) % tipo.rangoPrecio)) / 100) * 100;
    const precioTexto = `$ ${precioNum.toLocaleString('es-CL')}`;
    const stock = 1 + (i % 40);
    const oem = `OEM-${marcaRepuesto.slice(0, 3).toUpperCase()}-${String(10000 + (i * 7) % 89999)}`;

    const primera = compatibilidades[0];
    const nombrePublicado = esUniversal
      ? `${tipo.nombre} ${marcaRepuesto} Universal`
      : `${tipo.nombre} ${marcaRepuesto} para ${primera.marca} ${primera.modelo}`;

    resumen.repuestos += 1;
    if (esUniversal) resumen.universales += 1;
    if (compatibilidades.length > 1) {
      resumen.skusRepetidos += 1;
      resumen.filasExtra += compatibilidades.length - 1;
    }

    // Un repuesto sin compatibilidad (universal) es una sola fila con las columnas del auto
    // vacías; uno con N compatibilidades son N filas con el mismo código.
    const aplicaciones = esUniversal ? [null] : compatibilidades;
    for (const compat of aplicaciones) {
      if (compat?.patente) resumen.porPatente[compat.patente].add(sku);
      filas.push({
        CODIGO_INTERNO: sku,
        PRODUCTO: nombrePublicado,
        RUBRO: tipo.categoria,
        SUBRUBRO: tipo.subcategoria,
        FABRICANTE: marcaRepuesto,
        CODIGO_OEM: oem,
        PRECIO_VENTA: precioTexto,
        STOCK_DISPONIBLE: stock,
        ESTADO: condicion,
        UNIVERSAL: esUniversal ? 'SI' : 'NO',
        MARCA_AUTO: compat ? compat.marca : '',
        MODELO_AUTO: compat ? compat.modelo : '',
        VERSION_AUTO: compat ? compat.version : '',
        RANGO_ANOS: compat ? `${compat.anioDesde}-${compat.anioHasta}` : '',
        MOTOR: compat ? compat.motor : '',
        OBSERVACIONES: compat
          ? `Pieza técnica ${marcaRepuesto} según especificación de fábrica. Aplicación: ${textoDeVehiculo(compat)}.`
          : `Pieza técnica ${marcaRepuesto} de aplicación universal. Cumple especificaciones OEM.`,
        PIDE_CHASIS: requiereChasis,
        // La foto se repite en todas las filas del mismo código, como viene en los archivos
        // reales: al juntar los repetidos manda la primera fila, así que da lo mismo, pero
        // una columna con un cuarto de celdas vacías haría dudar al detector de fotos.
        FOTO: foto,
      });
    }
  }

  return { filas, resumen };
}

function crearExcel(filas) {
  console.log(`[PROCESO] Guardando libro Excel con ${filas.length} filas...`);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas, { header: HEADERS_VENDEDOR });

  ws['!cols'] = [
    { wch: 15 }, // CODIGO_INTERNO
    { wch: 48 }, // PRODUCTO
    { wch: 16 }, // RUBRO
    { wch: 26 }, // SUBRUBRO
    { wch: 14 }, // FABRICANTE
    { wch: 16 }, // CODIGO_OEM
    { wch: 14 }, // PRECIO_VENTA
    { wch: 18 }, // STOCK_DISPONIBLE
    { wch: 14 }, // ESTADO
    { wch: 12 }, // UNIVERSAL
    { wch: 14 }, // MARCA_AUTO
    { wch: 15 }, // MODELO_AUTO
    { wch: 14 }, // VERSION_AUTO
    { wch: 14 }, // RANGO_ANOS
    { wch: 14 }, // MOTOR
    { wch: 70 }, // OBSERVACIONES
    { wch: 14 }, // PIDE_CHASIS
    { wch: 28 }  // FOTO
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Catalogo_2000_Repuestos');
  const excelPath = path.join(outputDir, 'Plantilla_Vendedor_2000_Registros_Dev.xlsx');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  fs.writeFileSync(excelPath, buf);
  console.log(`[OK] Excel generado en: ${excelPath} (${(buf.length / 1024).toFixed(1)} KB)`);
}

/**
 * Comprime el pool tal cual está: la carpeta y el ZIP tienen que traer exactamente las
 * mismas fotos, porque la carga se puede probar por las dos vías.
 */
async function crearZipPool(fotosUsadas) {
  console.log('[PROCESO] Comprimiendo el pool de fotos en fotos_2000_repuestos.zip...');
  const zip = new JSZip();

  const archivos = fs.readdirSync(poolDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  for (const archivo of archivos) {
    zip.file(archivo, fs.readFileSync(path.join(poolDir, archivo)));
  }

  // Una foto nombrada en el Excel que no esté en la carpeta deja repuestos sin imagen y el
  // motivo no se ve hasta el final de la carga. Mejor decirlo acá.
  const faltantes = [...fotosUsadas].filter((f) => !archivos.includes(f));
  if (faltantes.length > 0) {
    console.warn(`[ALERTA] El Excel nombra fotos que no están en el pool: ${faltantes.join(', ')}`);
    console.warn('         Corré "node descargar_fotos_pool.js" antes de generar.');
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const zipPath = path.join(outputDir, 'fotos_2000_repuestos.zip');
  fs.writeFileSync(zipPath, zipBuffer);
  console.log(`[OK] ZIP con ${archivos.length} fotos: ${zipPath} (${(zipBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);
  return { archivos, faltantes };
}

async function main() {
  try {
    copiarFotosBase();
    const { filas, resumen } = generarFilas();
    crearExcel(filas);
    const fotosUsadas = new Set(filas.map((f) => f.FOTO).filter(Boolean));
    const { archivos } = await crearZipPool(fotosUsadas);

    console.log('\n======================================================');
    console.log('DATOS DE PRUEBA DEV GENERADOS');
    console.log(`  Repuestos (códigos únicos): ${resumen.repuestos}`);
    console.log(`  Filas del Excel:            ${filas.length}`);
    console.log(`  Códigos repetidos:          ${resumen.skusRepetidos} (${resumen.filasExtra} filas de compatibilidad extra)`);
    console.log(`  Universales (sin vehículo): ${resumen.universales}`);
    console.log(`  Calzan con ABCD11 (Toyota Yaris 2018): ${resumen.porPatente.ABCD11.size} repuestos`);
    console.log(`  Calzan con ABCD22 (Hyundai Accent 2020): ${resumen.porPatente.ABCD22.size} repuestos`);
    console.log(`  Fotos distintas en la carpeta y en el ZIP: ${archivos.length} (${fotosUsadas.size} nombradas por el Excel)`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('Error durante la generación:', err);
    process.exitCode = 1;
  }
}

main();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Columnas reales del contrato unico (backend InventarioExcelService.COLUMNAS_EXCEL, plantilla v2.1.0).
// El orden importa: el backend lee la fila por posicion y rechaza cualquier cabecera que no
// calce exactamente con esta lista (InventarioExcelService.validarEncabezados).
const VERSION_PLANTILLA = '2.1.0';

const HEADERS = [
  'nombre_publicado', 'categoria', 'subcategoria', 'marca_repuesto', 'sku_proveedor',
  'referencia_oem', 'tipo_precio', 'precio', 'stock', 'condicion',
  'compatibilidad_general',
  'compatibilidad_marca', 'compatibilidad_modelo', 'anio_desde', 'anio_hasta', 'motor',
  'descripcion', 'requiere_chasis'
];

const COMPAT_HEADERS = ['sku_proveedor', 'compatibilidad_marca', 'compatibilidad_modelo', 'anio_desde', 'anio_hasta', 'motor', 'referencia_oem'];

const INSTRUCCIONES = [
  ['PLANTILLA OFICIAL DE CARGA MASIVA DE INVENTARIO - REPUESTOP'],
  [`VERSION_PLANTILLA: ${VERSION_PLANTILLA}`],
  [''],
  ['INSTRUCCIONES DE USO:'],
  ['1. La hoja "inventario" contiene las columnas obligatorias y opcionales para la carga de productos.'],
  ['2. Columnas obligatorias: nombre_publicado, categoria, marca_repuesto, sku_proveedor, stock.'],
  ['3. tipo_precio: "MOSTRAR_PRECIO" (requiere precio numérico) o "SOLO_COTIZAR".'],
  ['4. condicion: "ORIGINAL" o "ALTERNATIVO".'],
  ['5. compatibilidad_general: "SI" o "NO" (por defecto NO). Con SI el repuesto se publica como universal y se ignoran las columnas de compatibilidad.'],
  ['6. requiere_chasis: "SI" o "NO" (por defecto NO).'],
  ['7. La hoja "compatibilidades" es opcional y permite asignar múltiples compatibilidades vehiculares por SKU.']
];

function row(overrides) {
  const base = {
    nombre_publicado: '', categoria: '', subcategoria: '', marca_repuesto: '', sku_proveedor: '',
    referencia_oem: '', tipo_precio: 'MOSTRAR_PRECIO', precio: '', stock: '', condicion: 'ORIGINAL',
    compatibilidad_general: '',
    compatibilidad_marca: '', compatibilidad_modelo: '', anio_desde: '', anio_hasta: '', motor: '',
    descripcion: '', requiere_chasis: ''
  };
  return { ...base, ...overrides };
}

// --- Archivo chico (17 filas) con casos deliberados de OK / ADVERTENCIA / ERROR ---
const filasPrueba = [
  row({
    nombre_publicado: 'Pastillas de Freno Ceramicas Delanteras', categoria: 'Frenos', subcategoria: '',
    marca_repuesto: 'Brembo', sku_proveedor: 'PRUEBA-00001', referencia_oem: '04465-YZZA6',
    tipo_precio: 'MOSTRAR_PRECIO', precio: 28990, stock: 15, condicion: 'ORIGINAL',
    compatibilidad_marca: 'Toyota', compatibilidad_modelo: 'Corolla', anio_desde: 2015, anio_hasta: 2018,
    motor: '1.8 16V', descripcion: 'Caso OK: fila valida con compatibilidad simple valida.'
  }),
  row({
    nombre_publicado: 'Filtro de Aceite', categoria: 'Filtros', marca_repuesto: 'Mann-Filter',
    sku_proveedor: 'PRUEBA-00002', tipo_precio: 'SOLO_COTIZAR', precio: 5900, stock: 40,
    descripcion: 'Caso OK: tipo_precio SOLO_COTIZAR, sin compatibilidad declarada.'
  }),
  row({
    nombre_publicado: 'Amortiguador Delantero a Gas', categoria: 'Suspensión', marca_repuesto: 'KYB',
    sku_proveedor: 'PRUEBA-00003', precio: 45000, stock: 8, condicion: 'ALTERNATIVO',
    compatibilidad_marca: 'Toyota', compatibilidad_modelo: 'Yaris', anio_desde: 2016, anio_hasta: 2019,
    requiere_chasis: 'SI', descripcion: 'Caso OK: requiere_chasis=SI (Fase 6).'
  }),
  row({
    nombre_publicado: 'Bomba de Agua', categoria: 'Refrigeración', marca_repuesto: 'Gates',
    sku_proveedor: 'PRUEBA-00004', precio: 32000, stock: 12,
    compatibilidad_marca: 'Kia', compatibilidad_modelo: 'Yaris', anio_desde: 2018, anio_hasta: 2020,
    descripcion: 'Caso ADVERTENCIA esperado: "Kia Yaris" no existe en el catalogo de vehiculos (Fase 1/2).'
  }),
  row({
    nombre_publicado: 'Disco de Freno Ventilado', categoria: 'Frenos', subcategoria: 'Pistones',
    marca_repuesto: 'TRW', sku_proveedor: 'PRUEBA-00005', precio: 39900, stock: 6,
    descripcion: 'Caso ADVERTENCIA esperado: subcategoria "Pistones" no pertenece a la categoria "Frenos" (Fase 2).'
  }),
  row({
    nombre_publicado: 'Correa de Distribucion', categoria: 'Categoria Inventada', marca_repuesto: 'Dayco',
    sku_proveedor: 'PRUEBA-00006', precio: 25000, stock: 10,
    descripcion: 'Caso ERROR esperado: la categoria no existe en el catalogo.'
  }),
  row({
    nombre_publicado: 'Bujia de Iridio', categoria: 'Encendido', marca_repuesto: 'NGK',
    sku_proveedor: 'PRUEBA-00007', precio: 6500, stock: 'diez',
    descripcion: 'Caso ERROR esperado: stock no numerico ("diez").'
  }),
  row({
    nombre_publicado: 'Radiador de Aluminio', categoria: 'Refrigeración', marca_repuesto: 'Denso',
    sku_proveedor: 'PRUEBA-00008', precio: '1.234,50', stock: 5,
    descripcion: 'Caso OK sin advertencia: formato chileno completo "1.234,50" (punto miles + coma decimal).'
  }),
  row({
    nombre_publicado: 'Kit de Embrague', categoria: 'Embrague', marca_repuesto: 'Sachs',
    sku_proveedor: 'PRUEBA-00009', precio: '5.000', stock: 3,
    descripcion: 'Caso ADVERTENCIA esperado (Fase 12): "5.000" con 3 decimales se interpreta como separador de miles (5000), y avisa como se interpreto.'
  }),
  row({
    nombre_publicado: 'Ampolleta LED H7', categoria: 'Eléctrico', marca_repuesto: 'Philips',
    sku_proveedor: 'PRUEBA-00010', precio: 15900, stock: 25,
    descripcion: 'Caso OK: sin compatibilidad, catalogo electrico.'
  }),
  row({
    nombre_publicado: 'Terminal de Direccion', categoria: 'Dirección', marca_repuesto: 'TRW',
    sku_proveedor: 'PRUEBA-00011', precio: 13900, stock: 18,
    compatibilidad_marca: 'Toyota', compatibilidad_modelo: 'Corolla', anio_desde: 2015, anio_hasta: 2016,
    descripcion: 'Caso OK: compatibilidad en la fila principal + 2 filas mas en la hoja "compatibilidades" (multi-compat, Fase 6).'
  }),
  row({
    nombre_publicado: 'Sensor de Oxigeno', categoria: 'Sensores', marca_repuesto: 'Bosch',
    sku_proveedor: 'PRUEBA-00012', precio: 22000, stock: 14,
    descripcion: 'Caso OK: sin compatibilidad declarada, referenciado en hoja "compatibilidades" con un SKU que no existe (typo) para ver el limite conocido del reporte (Fase 6, limitacion documentada).'
  }),
  row({
    nombre_publicado: 'Soporte de Motor Delantero', categoria: 'Soportes de Motor', marca_repuesto: 'Corteco',
    sku_proveedor: 'PRUEBA-00013', precio: 18900, stock: 9, condicion: 'ALTERNATIVO',
    descripcion: 'Caso OK: condicion ALTERNATIVO.'
  }),
  row({
    nombre_publicado: 'Rodamiento de Rueda Delantero', categoria: 'Rodamientos', marca_repuesto: 'SKF',
    sku_proveedor: 'PRUEBA-00014', precio: 17500, stock: 20,
    descripcion: 'Caso OK: SKU sin espacios ni caracteres especiales.'
  }),
  row({
    nombre_publicado: 'Empaquetadura de Culata', categoria: 'Empaquetaduras y Retenes', marca_repuesto: 'Ajusa',
    sku_proveedor: 'PRUEBA-00015', precio: 24500, stock: 7,
    descripcion: 'Caso OK: categoria de nombre largo con tilde.'
  }),
  row({
    nombre_publicado: 'Cerradura de Puerta Delantera', categoria: 'Cerraduras', marca_repuesto: 'Valeo',
    sku_proveedor: 'PRUEBA-00001', precio: 19900, stock: 11,
    descripcion: 'Caso ERROR esperado: SKU duplicado (PRUEBA-00001 ya existe en la fila 1 de este mismo archivo).'
  }),
  row({
    nombre_publicado: '', categoria: 'Motor', marca_repuesto: 'Mahle',
    sku_proveedor: 'PRUEBA-00017', precio: 9800, stock: 5,
    descripcion: 'Caso ERROR esperado: nombre_publicado vacio (campo obligatorio).'
  }),
  row({
    nombre_publicado: 'Limpiaparabrisas Universal 20"', categoria: 'Accesorios', marca_repuesto: 'Bosch',
    sku_proveedor: 'PRUEBA-00018', precio: 7990, stock: 60,
    compatibilidad_general: 'SI',
    descripcion: 'Caso OK: compatibilidad_general=SI, el repuesto se publica como universal.'
  }),
  row({
    nombre_publicado: 'Ampolleta H4 12V', categoria: 'Iluminación', marca_repuesto: 'Philips',
    sku_proveedor: 'PRUEBA-00019', precio: 4500, stock: 80,
    compatibilidad_general: 'SI',
    compatibilidad_marca: 'Toyota', compatibilidad_modelo: 'Corolla', anio_desde: 2015, anio_hasta: 2018,
    descripcion: 'Caso ADVERTENCIA esperado: compatibilidad_general=SI con compatibilidad declarada; el backend la ignora y avisa.'
  })
];

const filasCompatibilidades = [
  { sku_proveedor: 'PRUEBA-00011', compatibilidad_marca: 'Toyota', compatibilidad_modelo: 'Corolla', anio_desde: 2017, anio_hasta: 2018, motor: '1.8 16V', referencia_oem: '04465-02220' },
  { sku_proveedor: 'PRUEBA-00011', compatibilidad_marca: 'Toyota', compatibilidad_modelo: 'Yaris', anio_desde: 2016, anio_hasta: 2019, motor: '1.5 16V', referencia_oem: '04465-52220' },
  { sku_proveedor: 'PRUEBA-00012', compatibilidad_marca: 'Toyota', compatibilidad_modelo: 'Hilux', anio_desde: 2018, anio_hasta: 2020, motor: '2.4 TDI' }
];
// Nota: la ultima fila de arriba usa a proposito "PRUEBA-00012" en vez de un SKU inexistente
// real para no romper el parseo; para probar el typo silencioso cambia el sku_proveedor de
// esa fila a algo que no exista en la hoja principal (ej. "PRUEBA-00099") y observa que no
// aparece ningun aviso visible en el reporte (limitacion documentada en la Fase 6).

function buildWorkbook(headers, rows, compatHeaders, compatRows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  XLSX.utils.book_append_sheet(workbook, sheet, 'inventario');
  if (compatRows && compatRows.length) {
    const compatSheet = XLSX.utils.json_to_sheet(compatRows, { header: compatHeaders });
    XLSX.utils.book_append_sheet(workbook, compatSheet, 'compatibilidades');
  }
  // La hoja "instrucciones" no es decorativa: es donde viaja VERSION_PLANTILLA y lo que le
  // permite al backend dar un error preciso si algun dia se sube este archivo contra una
  // plantilla mayor distinta, en vez de descubrirlo columna por columna.
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(INSTRUCCIONES), 'instrucciones');
  return workbook;
}

function writeFile(workbook, name) {
  const buf = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  const p = path.join(__dirname, name);
  fs.writeFileSync(p, buf);
  console.log('Generado', p);
}

// Archivo chico con casos mixtos (OK / ADVERTENCIA / ERROR)
writeFile(buildWorkbook(HEADERS, filasPrueba, COMPAT_HEADERS, filasCompatibilidades), 'Prueba_Carga_Masiva_Casos_Mixtos.xlsx');

// Archivo grande (250 filas, todas validas) para probar el umbral asincrono (Fase 8/9: >200 filas -> 202 + polling)
const categoriasValidas = ['Motor', 'Frenos', 'Filtros', 'Suspensión', 'Dirección', 'Eléctrico', 'Refrigeración', 'Embrague', 'Encendido', 'Sensores'];
const marcasRepuesto = ['Bosch', 'Brembo', 'TRW', 'Gates', 'SKF', 'NGK', 'Denso', 'Mahle', 'Sachs', 'KYB'];
const vehiculos = [
  { marca: 'Toyota', modelo: 'Corolla', desde: 2015, hasta: 2018 },
  { marca: 'Toyota', modelo: 'Yaris', desde: 2016, hasta: 2019 },
];

const filasGrandes = [];
for (let i = 1; i <= 250; i++) {
  const cat = categoriasValidas[i % categoriasValidas.length];
  const marca = marcasRepuesto[i % marcasRepuesto.length];
  const veh = vehiculos[i % vehiculos.length];
  filasGrandes.push(row({
    nombre_publicado: `Repuesto de Prueba ${cat} #${i}`,
    categoria: cat,
    marca_repuesto: marca,
    sku_proveedor: `MASIVO-${String(i).padStart(5, '0')}`,
    tipo_precio: i % 5 === 0 ? 'SOLO_COTIZAR' : 'MOSTRAR_PRECIO',
    precio: 5000 + (i * 137 % 90000),
    stock: 1 + (i % 50),
    condicion: i % 4 === 0 ? 'ALTERNATIVO' : 'ORIGINAL',
    compatibilidad_marca: i % 3 === 0 ? veh.marca : '',
    compatibilidad_modelo: i % 3 === 0 ? veh.modelo : '',
    anio_desde: i % 3 === 0 ? veh.desde : '',
    anio_hasta: i % 3 === 0 ? veh.hasta : '',
    descripcion: `Fila ${i} generada para probar el umbral asincrono (200 filas) de la Fase 8.`
  }));
}
writeFile(buildWorkbook(HEADERS, filasGrandes, COMPAT_HEADERS, []), 'Prueba_Carga_Masiva_250_registros_Asincrono.xlsx');

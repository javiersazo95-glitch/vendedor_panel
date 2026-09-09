/**
 * Archivos "crudos" de vendedor: lo que llega de verdad, no lo que ya sabemos leer.
 *
 * Los .xlsx que estaban en el repo salen casi todos de la plantilla oficial o de un Excel
 * ya ordenado, asi que probaban el camino feliz. Estos casos imitan las listas reales de
 * un mostrador de repuestos: titulos a mitad de hoja, precios escritos a mano, subtotales,
 * dos tablas en la misma hoja y archivos a los que simplemente les falta un dato que nadie
 * puede inventar.
 *
 * Cada caso es un AoA (tal cual saldria de la hoja) para que sirva a los dos consumidores:
 * `generar.mjs`, que los escribe como .xlsx para probarlos a mano en el panel, y
 * `plantillaCrudos.test.ts`, que los pasa por el pipeline sin tocar archivos.
 */

/** @typedef {{ id: string, titulo: string, prueba: string, aoa: unknown[][] }} CasoCrudo */

/** @type {CasoCrudo[]} */
export const CASOS_CRUDOS = [
  {
    id: '01-lista-dos-columnas',
    titulo: 'Lista de dos columnas (codigo + descripcion de corrido)',
    prueba: 'El archivo mas comun del mostrador: no hay marca, categoria, precio ni stock en ninguna columna.',
    aoa: [
      ['CODIGO', 'DESCRIPCION'],
      ['PF-201', 'PASTILLA FRENO DEL. TOYOTA COROLLA 2014-2018 BOSCH'],
      ['FA-110', 'FILTRO ACEITE HYUNDAI ACCENT 2011-2015 MANN'],
      ['AM-045', 'AMORTIGUADOR TRAS. NISSAN V16 1995-2008 MONROE'],
    ],
  },
  {
    id: '02-nombres-raros',
    titulo: 'Encabezados abreviados a mano',
    prueba: 'Los nombres no estan en la lista de sinonimos: mide cuanto alcanza a pre-llenar la deteccion.',
    aoa: [
      ['Cod. Art.', 'Detalle', 'Mca.', 'P.U.', 'Exist.', 'Rubro'],
      ['PF-201', 'Pastilla freno delantera', 'Bosch', 24990, 12, 'Frenos'],
      ['FA-110', 'Filtro de aceite', 'Mann', 6990, 30, 'Filtros'],
    ],
  },
  {
    id: '03-precios-sucios',
    titulo: 'Precios y stock escritos a mano',
    prueba: 'Simbolos, separadores de miles, sufijos y texto donde deberia haber un numero.',
    aoa: [
      ['sku', 'nombre', 'marca', 'categoria', 'precio', 'stock'],
      ['PF-201', 'Pastilla freno delantera', 'Bosch', 'Frenos', '$24.990', '12'],
      ['FA-110', 'Filtro de aceite', 'Mann', 'Filtros', '6,990', 'SIN STOCK'],
      ['AM-045', 'Amortiguador trasero', 'Monroe', 'Suspension', '45.000 c/u', '3 unid'],
      ['BJ-300', 'Bujia iridium', 'NGK', 'Motor', 'CONSULTAR', '0'],
      ['CO-500', 'Correa distribucion', 'Gates', 'Motor', '1.234,50', ''],
    ],
  },
  {
    id: '04-titulos-abajo',
    titulo: 'Membrete arriba y titulos en la fila 5',
    prueba: 'La hoja empieza con el nombre del local y la fecha; los encabezados no estan en la fila 1.',
    aoa: [
      ['REPUESTOS EL RAPIDO LTDA.'],
      ['Lista de precios vigente'],
      ['Actualizada al 01-03-2026'],
      [],
      ['sku', 'nombre', 'marca', 'categoria', 'precio', 'stock'],
      ['PF-201', 'Pastilla freno delantera', 'Bosch', 'Frenos', 24990, 12],
      ['FA-110', 'Filtro de aceite', 'Mann', 'Filtros', 6990, 30],
    ],
  },
  {
    id: '05-subtotales',
    titulo: 'Subtotales y encabezados repetidos a mitad de tabla',
    prueba: 'Filas que no son repuestos metidas entre los repuestos, como en una lista impresa.',
    aoa: [
      ['sku', 'nombre', 'marca', 'categoria', 'precio', 'stock'],
      ['PF-201', 'Pastilla freno delantera', 'Bosch', 'Frenos', 24990, 12],
      ['PF-202', 'Pastilla freno trasera', 'Bosch', 'Frenos', 21990, 8],
      ['', 'SUBTOTAL FRENOS', '', '', 46980, 20],
      [],
      ['sku', 'nombre', 'marca', 'categoria', 'precio', 'stock'],
      ['FA-110', 'Filtro de aceite', 'Mann', 'Filtros', 6990, 30],
      ['', 'TOTAL GENERAL', '', '', 53970, 50],
    ],
  },
  {
    id: '06-dos-tablas',
    titulo: 'Dos tablas apiladas en la misma hoja',
    prueba: 'Un bloque por proveedor, cada uno con sus propios titulos y distinto numero de columnas.',
    aoa: [
      ['PROVEEDOR: BOSCH'],
      ['sku', 'nombre', 'precio', 'stock'],
      ['PF-201', 'Pastilla freno delantera', 24990, 12],
      ['FA-110', 'Filtro de aceite', 6990, 30],
      [],
      ['PROVEEDOR: MONROE'],
      ['codigo', 'producto', 'valor', 'cantidad', 'observacion'],
      ['AM-045', 'Amortiguador trasero', 45000, 3, 'ultimas unidades'],
    ],
  },
  {
    id: '07-categoria-como-banda',
    titulo: 'La categoria es una fila de titulo, no una columna',
    prueba: 'Celda combinada que agrupa: el dato existe en la hoja pero no en ninguna columna.',
    aoa: [
      ['sku', 'nombre', 'marca', 'precio', 'stock'],
      ['FRENOS'],
      ['PF-201', 'Pastilla freno delantera', 'Bosch', 24990, 12],
      ['PF-202', 'Pastilla freno trasera', 'Bosch', 21990, 8],
      ['FILTROS'],
      ['FA-110', 'Filtro de aceite', 'Mann', 6990, 30],
    ],
  },
  {
    id: '08-sin-precio-ni-stock',
    titulo: 'Catalogo sin precio ni stock',
    prueba: 'Le falta un dato que ninguna conversion puede inventar. Deberia decirse antes del paso 2.',
    aoa: [
      ['sku', 'nombre', 'marca', 'categoria'],
      ['PF-201', 'Pastilla freno delantera', 'Bosch', 'Frenos'],
      ['FA-110', 'Filtro de aceite', 'Mann', 'Filtros'],
    ],
  },
  {
    id: '09-varios-autos-por-celda',
    titulo: 'Varios vehiculos en una sola celda',
    prueba: 'La compatibilidad va separada por barras o saltos de linea, no una por fila.',
    aoa: [
      ['sku', 'nombre', 'marca', 'categoria', 'precio', 'stock', 'aplicacion'],
      [
        'PF-201', 'Pastilla freno delantera', 'Bosch', 'Frenos', 24990, 12,
        'TOYOTA COROLLA 2014-2018 / TOYOTA YARIS 2015-2019 / CHEVROLET SAIL 2013-2017',
      ],
      [
        'FA-110', 'Filtro de aceite', 'Mann', 'Filtros', 6990, 30,
        'HYUNDAI ACCENT 2011-2015\nKIA RIO 2012-2016',
      ],
    ],
  },
  {
    id: '10-todo-junto',
    titulo: 'Todo junto',
    prueba: 'El archivo pesimista: membrete, titulos abreviados, precios sucios, subtotal y filas vacias.',
    aoa: [
      ['AUTOPARTES DEL SUR'],
      [],
      ['Cod. Art.', 'Detalle', 'Mca.', 'P.U.', 'Exist.'],
      ['PF-201', 'PASTILLA FRENO DEL. COROLLA 14-18', 'BOSCH', '$24.990', '12'],
      [],
      ['FA-110', 'FILTRO ACEITE ACCENT 11-15', 'MANN', '6.990', 'sin stock'],
      ['', 'SUBTOTAL', '', 31980, ''],
    ],
  },
];

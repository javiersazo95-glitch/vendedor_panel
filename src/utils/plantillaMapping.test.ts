import { describe, expect, it, beforeEach } from 'vitest';

import {
  ESQUEMA_FALLBACK,
  PLANTILLA_COLUMNAS,
  autoDetectMapping,
  buildOfficialAoA,
  buildOfficialAoADetallado,
  buildOfficialXlsxFile,
  camposDesdeEsquema,
  columnasDeHoja,
  detectarFilaEncabezados,
  elegirHojaInicial,
  leerLibro,
  headerSignature,
  loadSavedMapping,
  saveMapping,
  parseUserFile,
  type EsquemaPlantilla,
  type Mapping,
  type UserColumn,
} from './plantillaMapping';

const cols = (headers: string[]): UserColumn[] =>
  headers.map((h, index) => ({ id: String(index), rawHeader: h, displayHeader: h, index }));

const withOficial = (base: Mapping, over: Record<string, string | null>): Mapping => ({
  ...base,
  oficial: { ...base.oficial, ...over },
});

describe('autoDetectMapping', () => {
  it('empareja encabezados exactos', () => {
    const m = autoDetectMapping(cols(['sku_proveedor', 'nombre_publicado', 'precio', 'stock']));
    expect(m.oficial.sku_proveedor).toBe('0');
    expect(m.oficial.nombre_publicado).toBe('1');
    expect(m.oficial.precio).toBe('2');
    expect(m.oficial.stock).toBe('3');
  });

  it('tolera acentos, espacios y mayúsculas', () => {
    const m = autoDetectMapping(cols(['  SKU ', 'Año Desde', 'Categoría']));
    expect(m.oficial.sku_proveedor).toBe('0');
    expect(m.oficial.anio_desde).toBe('1');
    expect(m.oficial.categoria).toBe('2');
  });

  it('usa sinónimos', () => {
    const m = autoDetectMapping(cols(['titulo', 'cantidad', 'valor']));
    expect(m.oficial.nombre_publicado).toBe('0');
    expect(m.oficial.stock).toBe('1');
    expect(m.oficial.precio).toBe('2');
  });

  it('las columnas sin correspondencia quedan como extra "descripcion"', () => {
    const m = autoDetectMapping(cols(['sku', 'color favorito', 'proveedor secundario']));
    expect(m.oficial.sku_proveedor).toBe('0');
    expect(m.extras['1']).toBe('descripcion');
    expect(m.extras['2']).toBe('descripcion');
  });

  it('ignora palabras vacías ("Marca del repuesto" == marca_repuesto)', () => {
    const m = autoDetectMapping(cols(['Marca del repuesto', 'Año Desde']));
    expect(m.oficial.marca_repuesto).toBe('0');
    expect(m.oficial.anio_desde).toBe('1');
  });

  it('"Marca auto" va a compatibilidad_marca, no a marca_repuesto', () => {
    const m = autoDetectMapping(cols(['Marca auto', 'Modelo']));
    expect(m.oficial.compatibilidad_marca).toBe('0');
    expect(m.oficial.marca_repuesto).toBeNull();
  });

  it('un encabezado genérico de una sola palabra ("Proveedor") no se fuerza a sku_proveedor', () => {
    const m = autoDetectMapping(cols(['sku', 'Proveedor']));
    expect(m.oficial.sku_proveedor).toBe('0');
    expect(m.extras['1']).toBe('descripcion');
  });

  it('nunca asigna la misma columna del vendedor a dos columnas oficiales', () => {
    const m = autoDetectMapping(cols(['marca', 'stock', 'sku']));
    const asignados = Object.values(m.oficial).filter(Boolean);
    expect(new Set(asignados).size).toBe(asignados.length);
  });
});

describe('buildOfficialAoA', () => {
  const userCols = cols(['sku', 'nombre', 'condicion origen', 'garantia', 'proveedor']);
  const baseMapping = (): Mapping =>
    withOficial(
      { oficial: Object.fromEntries(PLANTILLA_COLUMNAS.map((k) => [k, null])) as Mapping['oficial'], extras: {}, valueMap: {} },
      { sku_proveedor: '0', nombre_publicado: '1', condicion: '2' },
    );

  it('la fila 0 son exactamente las 18 columnas oficiales', () => {
    const aoa = buildOfficialAoA([['A', 'B', 'C', 'D', 'E']], userCols, baseMapping());
    expect(aoa[0]).toEqual([...PLANTILLA_COLUMNAS]);
  });

  it('columna oficial sin mapear => cadena vacía, no undefined', () => {
    const aoa = buildOfficialAoA([['SKU-1', 'Filtro', 'Nuevo', '', '']], userCols, baseMapping());
    const idxCategoria = PLANTILLA_COLUMNAS.indexOf('categoria');
    expect(aoa[1][idxCategoria]).toBe('');
  });

  it('las columnas extra "descripcion" se agregan como "Etiqueta: valor"; las vacías se omiten', () => {
    const m = { ...baseMapping(), extras: { '3': 'descripcion', '4': 'descripcion' } as Record<string, 'descripcion' | 'ignore'> };
    const aoa = buildOfficialAoA([['SKU-1', 'Filtro', 'Nuevo', '12 meses', '']], userCols, m);
    const idxDesc = PLANTILLA_COLUMNAS.indexOf('descripcion');
    expect(aoa[1][idxDesc]).toBe('garantia: 12 meses');
  });

  it('las columnas extra "ignore" no aparecen en ningún lado', () => {
    const m = { ...baseMapping(), extras: { '3': 'ignore', '4': 'ignore' } as Record<string, 'descripcion' | 'ignore'> };
    const aoa = buildOfficialAoA([['SKU-1', 'Filtro', 'Nuevo', '12 meses', 'ACME']], userCols, m);
    const idxDesc = PLANTILLA_COLUMNAS.indexOf('descripcion');
    expect(aoa[1][idxDesc]).toBe('');
  });

  it('combina descripción mapeada + extras, separadas por línea en blanco', () => {
    const uc = cols(['sku', 'detalle', 'garantia']);
    const m = withOficial(
      { oficial: Object.fromEntries(PLANTILLA_COLUMNAS.map((k) => [k, null])) as Mapping['oficial'], extras: { '2': 'descripcion' }, valueMap: {} },
      { sku_proveedor: '0', descripcion: '1' },
    );
    const aoa = buildOfficialAoA([['SKU-1', 'Original de fábrica', '24 meses']], uc, m);
    const idxDesc = PLANTILLA_COLUMNAS.indexOf('descripcion');
    expect(aoa[1][idxDesc]).toBe('Original de fábrica\n\ngarantia: 24 meses');
  });

  it('aplica el mapeo de valores', () => {
    const m = { ...baseMapping(), valueMap: { condicion: { Nuevo: 'ORIGINAL', Usado: 'ALTERNATIVO' } } };
    const aoa = buildOfficialAoA([['SKU-1', 'Filtro', 'Nuevo'], ['SKU-2', 'Disco', 'Usado']], userCols, m);
    const idxCond = PLANTILLA_COLUMNAS.indexOf('condicion');
    expect(aoa[1][idxCond]).toBe('ORIGINAL');
    expect(aoa[2][idxCond]).toBe('ALTERNATIVO');
  });

  it('fila universal (compatibilidad_general = SI) vacía compat/anio/motor', () => {
    const uc = cols(['sku', 'universal', 'marca auto', 'modelo', 'ano', 'motor']);
    const m = withOficial(
      { oficial: Object.fromEntries(PLANTILLA_COLUMNAS.map((k) => [k, null])) as Mapping['oficial'], extras: {}, valueMap: {} },
      {
        sku_proveedor: '0',
        compatibilidad_general: '1',
        compatibilidad_marca: '2',
        compatibilidad_modelo: '3',
        anio_desde: '4',
        motor: '5',
      },
    );
    const aoa = buildOfficialAoA([['SKU-1', 'SI', 'Toyota', 'Yaris', '2015', '1.5']], uc, m);
    const get = (k: string) => aoa[1][PLANTILLA_COLUMNAS.indexOf(k as (typeof PLANTILLA_COLUMNAS)[number])];
    expect(get('compatibilidad_general')).toBe('SI');
    expect(get('compatibilidad_marca')).toBe('');
    expect(get('compatibilidad_modelo')).toBe('');
    expect(get('anio_desde')).toBe('');
    expect(get('motor')).toBe('');
  });
});

describe('headerSignature', () => {
  it('es estable ante el reordenamiento de columnas', () => {
    const a = headerSignature(cols(['SKU', 'Precio', 'Stock']));
    const b = headerSignature(cols(['Stock', 'SKU', 'Precio']));
    expect(a).toBe(b);
  });

  it('cambia cuando cambian los títulos', () => {
    const a = headerSignature(cols(['SKU', 'Precio']));
    const b = headerSignature(cols(['SKU', 'Costo']));
    expect(a).not.toBe(b);
  });
});

describe('saveMapping / loadSavedMapping', () => {
  beforeEach(() => localStorage.clear());

  it('round-trip por firma', () => {
    const uc = cols(['sku', 'nombre']);
    const sig = headerSignature(uc);
    const m = autoDetectMapping(uc);
    saveMapping(sig, m);
    expect(loadSavedMapping(sig)).toEqual(m);
    expect(loadSavedMapping('otra-firma')).toBeNull();
  });

  it('devuelve null si el JSON guardado está corrupto', () => {
    localStorage.setItem('repuestop_column_mappings', '{no es json');
    expect(loadSavedMapping('x')).toBeNull();
  });
});

describe('parseUserFile', () => {
  it('lee encabezados y filas de un CSV, desambiguando duplicados y vacíos', async () => {
    const csv = 'SKU,Marca,Marca,\nA-1,Bosch,Generico,nota\n';
    const file = new File([csv], 'mio.csv', { type: 'text/csv' });
    const { cols: parsed, rows } = await parseUserFile(file);
    expect(parsed.map((c) => c.rawHeader)).toEqual(['SKU', 'Marca', 'Marca', '']);
    expect(parsed[2].displayHeader).toContain('columna C');
    expect(parsed[3].displayHeader).toContain('sin título');
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('A-1');
  });

  it('lanza error si no hay filas de datos', async () => {
    const file = new File(['SKU,Precio\n'], 'vacio.csv', { type: 'text/csv' });
    await expect(parseUserFile(file)).rejects.toThrow(/filas de datos/);
  });
});

/* --------------------------------------------------------------------------
 * Fase 1: el contrato lo manda el backend, no el panel.
 * ------------------------------------------------------------------------ */

const esquemaCon = (over: Partial<EsquemaPlantilla>): EsquemaPlantilla => ({
  ...ESQUEMA_FALLBACK,
  ...over,
  catalogos: { ...ESQUEMA_FALLBACK.catalogos, ...(over.catalogos ?? {}) },
});

describe('camposDesdeEsquema', () => {
  it('los obligatorios salen del esquema, no del panel', () => {
    const campos = camposDesdeEsquema(esquemaCon({ columnasObligatorias: ['precio'] }));
    expect(campos.find((c) => c.key === 'precio')?.required).toBe(true);
    expect(campos.find((c) => c.key === 'nombre_publicado')?.required).toBe(false);
  });

  it('los valores de lista de tipo_precio y condicion salen de los catálogos del backend', () => {
    const campos = camposDesdeEsquema(esquemaCon({
      catalogos: { ...ESQUEMA_FALLBACK.catalogos, condiciones: ['ORIGINAL', 'ALTERNATIVO', 'REMANUFACTURADO'] },
    }));
    expect(campos.find((c) => c.key === 'condicion')?.enumHint).toEqual(['ORIGINAL', 'ALTERNATIVO', 'REMANUFACTURADO']);
  });

  it('una columna nueva del backend aparece igual, con etiqueta derivada del nombre', () => {
    const campos = camposDesdeEsquema(esquemaCon({
      columnas: [...PLANTILLA_COLUMNAS, 'url_imagen'],
      columnasObligatorias: [],
    }));
    expect(campos).toHaveLength(PLANTILLA_COLUMNAS.length + 1);
    expect(campos[campos.length - 1]).toMatchObject({ key: 'url_imagen', label: 'Url imagen', synonyms: [] });
  });

  it('conserva las etiquetas y sinónimos del panel para las columnas conocidas', () => {
    const campos = camposDesdeEsquema(ESQUEMA_FALLBACK);
    const sku = campos.find((c) => c.key === 'sku_proveedor');
    expect(sku?.label).toBe('SKU / Código');
    expect(sku?.synonyms).toContain('codigo');
  });
});

describe('buildOfficialAoA con un esquema del backend', () => {
  it('genera las columnas del esquema, incluida una que el panel no conoce', () => {
    const campos = camposDesdeEsquema(esquemaCon({ columnas: [...PLANTILLA_COLUMNAS, 'url_imagen'] }));
    const userCols = cols(['sku', 'foto']);
    const mapping: Mapping = {
      oficial: { ...Object.fromEntries(campos.map((c) => [c.key, null])), sku_proveedor: '0', url_imagen: '1' },
      extras: {},
      valueMap: {},
    };
    const aoa = buildOfficialAoA([['SKU-1', 'http://foto/1.jpg']], userCols, mapping, campos);
    expect(aoa[0][aoa[0].length - 1]).toBe('url_imagen');
    expect(aoa[1][aoa[1].length - 1]).toBe('http://foto/1.jpg');
  });
});

describe('buildOfficialXlsxFile', () => {
  it('declara la versión de la plantilla en la hoja "instrucciones"', async () => {
    const XLSX = await import('xlsx');
    const file = await buildOfficialXlsxFile([[...PLANTILLA_COLUMNAS], ['x']], 'adaptada.xlsx', '2.0.0');
    // jsdom no implementa File.arrayBuffer(), igual que en PlantillaMapper.test.tsx.
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });
    const wb = XLSX.read(buffer, { type: 'array' });
    expect(wb.SheetNames[0]).toBe('inventario');
    expect(wb.SheetNames).toContain('instrucciones');
    const filas = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.instrucciones, { header: 1 });
    expect(filas[0][0]).toBe('VERSION_PLANTILLA: 2.0.0');
  });
});

/* --------------------------------------------------------------------------
 * Fase 2: leer el archivo del vendedor como viene, no como nos gustaría.
 * ------------------------------------------------------------------------ */

describe('detectarFilaEncabezados', () => {
  it('salta el nombre de la tienda y las filas en blanco de arriba', () => {
    const aoa = [
      ['REPUESTOS DON JOSE'],
      [],
      ['Lista actualizada al 01/05'],
      ['Codigo', 'Nombre', 'Marca', 'Precio'],
      ['A-1', 'Filtro', 'Bosch', 4990],
    ];
    expect(detectarFilaEncabezados(aoa)).toBe(3);
  });

  it('la primera fila también puede ser la de títulos', () => {
    expect(detectarFilaEncabezados([['Codigo', 'Nombre', 'Marca'], ['A-1', 'Filtro', 'Bosch']])).toBe(0);
  });

  it('no confunde una fila de datos con los títulos', () => {
    const aoa = [
      ['A-1', 'Filtro', 'Bosch'],
      ['Codigo', 'Nombre', 'Marca'],
    ];
    // La primera fila también son tres textos: se toma la primera, que es lo esperable,
    // y para eso existe el control manual del wizard.
    expect(detectarFilaEncabezados(aoa)).toBe(0);
  });

  it('sin ninguna fila que convenza, cae en la primera con algo', () => {
    expect(detectarFilaEncabezados([[], ['', ''], ['Total', 1000]])).toBe(2);
  });
});

describe('columnasDeHoja', () => {
  const aoa = [
    ['Lista mayo'],
    ['Codigo', 'Nombre', 'Marca'],
    ['A-1', 'Filtro', 'Bosch'],
    ['', '', ''],
    ['A-2', 'Correa', 'Gates'],
  ];

  it('toma los títulos de la fila indicada y descarta lo de arriba', () => {
    const { cols, rows } = columnasDeHoja(aoa, 1);
    expect(cols.map((c) => c.rawHeader)).toEqual(['Codigo', 'Nombre', 'Marca']);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('A-2');
  });

  it('no lanza cuando la fila elegida no sirve: el wizard necesita poder mostrarlo', () => {
    const { cols, rows } = columnasDeHoja(aoa, 4);
    expect(cols.map((c) => c.rawHeader)).toEqual(['A-2', 'Correa', 'Gates']);
    expect(rows).toHaveLength(0);
  });
});

describe('leerLibro y elegirHojaInicial', () => {
  it('un CSV es un libro de una hoja', async () => {
    const file = new File([['SKU,Precio', 'A-1,100', ''].join('\n')], 'mio.csv', { type: 'text/csv' });
    const hojas = await leerLibro(file);
    expect(hojas).toHaveLength(1);
    expect(hojas[0].filasConDatos).toBe(2);
  });

  it('abre en la primera hoja con datos, no en la portada', () => {
    const hojas = [
      { nombre: 'Portada', aoa: [['Lista de precios']], filasConDatos: 1 },
      { nombre: 'Toyota', aoa: [['Codigo'], ['A-1']], filasConDatos: 2 },
    ];
    expect(elegirHojaInicial(hojas)).toBe(1);
  });
});

describe('valores fijos por columna (defaults)', () => {
  const userCols = cols(['sku', 'nombre']);
  const mappingConDefault = (): Mapping => ({
    oficial: { ...Object.fromEntries(PLANTILLA_COLUMNAS.map((k) => [k, null])), sku_proveedor: '0', nombre_publicado: '1' },
    extras: {},
    valueMap: {},
    defaults: { categoria: 'Filtros', condicion: 'ALTERNATIVO' },
  });

  it('rellena la columna que el archivo del vendedor no trae', () => {
    const aoa = buildOfficialAoA([['A-1', 'Filtro'], ['A-2', 'Correa']], userCols, mappingConDefault());
    const idx = (k: string) => PLANTILLA_COLUMNAS.indexOf(k as (typeof PLANTILLA_COLUMNAS)[number]);
    expect(aoa[1][idx('categoria')]).toBe('Filtros');
    expect(aoa[2][idx('condicion')]).toBe('ALTERNATIVO');
  });

  it('no pisa lo que sí trae el archivo', () => {
    const m = mappingConDefault();
    m.oficial.categoria = '1';
    const aoa = buildOfficialAoA([['A-1', 'Frenos']], userCols, m);
    const idx = PLANTILLA_COLUMNAS.indexOf('categoria');
    expect(aoa[1][idx]).toBe('Frenos');
  });
});

/* --------------------------------------------------------------------------
 * Fase 4: los datos se limpian al escribir el archivo oficial.
 * ------------------------------------------------------------------------ */

describe('buildOfficialAoA: limpieza de los datos del vendedor', () => {
  const idx = (k: string) => PLANTILLA_COLUMNAS.indexOf(k as (typeof PLANTILLA_COLUMNAS)[number]);
  const mapa = (over: Record<string, string | null>, extra: Partial<Mapping> = {}): Mapping => ({
    oficial: { ...Object.fromEntries(PLANTILLA_COLUMNAS.map((k) => [k, null])), ...over },
    extras: {},
    valueMap: {},
    ...extra,
  });

  it('escribe el precio y el stock en el formato que espera el backend', () => {
    const userCols = cols(['precio', 'cantidad']);
    const aoa = buildOfficialAoA([['$ 12.900', ' 7 ']], userCols, mapa({ precio: '0', stock: '1' }));
    expect(aoa[1][idx('precio')]).toBe('12900');
    expect(aoa[1][idx('stock')]).toBe('7');
  });

  it('lleva la X de la planilla a SI', () => {
    const userCols = cols(['chasis']);
    const aoa = buildOfficialAoA([['x']], userCols, mapa({ requiere_chasis: '0' }));
    expect(aoa[1][idx('requiere_chasis')]).toBe('SI');
  });

  it('sube la categoría cuando lo que el vendedor puso es una subcategoría', () => {
    // "Iluminación" no es categoría de RepuesTop, pero sí es subcategoría de Accesorios: su
    // palabra pasa a subcategoría y arriba queda la categoría que corresponde.
    const catalogos = {
      ...ESQUEMA_FALLBACK.catalogos,
      categorias: ['Accesorios', 'Frenos'],
      subcategoriasPorCategoria: { Accesorios: ['Iluminación', 'Neumáticos y Llantas'] },
    };
    const userCols = cols(['rubro']);
    const aoa = buildOfficialAoA([['Iluminacion']], userCols, mapa({ categoria: '0' }), undefined, catalogos);

    expect(aoa[1][idx('categoria')]).toBe('Accesorios');
    expect(aoa[1][idx('subcategoria')]).toBe('Iluminación');
  });

  it('entiende "Ruedas" como la "Llantas" del catálogo', () => {
    // En las listas chilenas llanta y rueda se usan igual: "Neumáticos y Ruedas" es la
    // subcategoría "Neumáticos y Llantas" escrita con la otra palabra.
    const catalogos = {
      ...ESQUEMA_FALLBACK.catalogos,
      categorias: ['Accesorios'],
      subcategoriasPorCategoria: { Accesorios: ['Neumáticos y Llantas'] },
    };
    const userCols = cols(['rubro']);
    const aoa = buildOfficialAoA([['Neumáticos y Ruedas']], userCols, mapa({ categoria: '0' }), undefined, catalogos);

    expect(aoa[1][idx('categoria')]).toBe('Accesorios');
    expect(aoa[1][idx('subcategoria')]).toBe('Neumáticos y Llantas');
  });

  it('no elige categoría cuando la subcategoría cuelga de varias', () => {
    // "Bombas de Agua" existe bajo tres categorías: elegir una seria adivinar, asi que se deja
    // como esta y el paso 3 lo sigue preguntando.
    const catalogos = {
      ...ESQUEMA_FALLBACK.catalogos,
      categorias: ['Motor', 'Refrigeración'],
      subcategoriasPorCategoria: {
        Motor: ['Bombas de Agua'],
        'Refrigeración': ['Bombas de Agua'],
      },
    };
    const userCols = cols(['rubro']);
    const aoa = buildOfficialAoA([['Bombas de Agua']], userCols, mapa({ categoria: '0' }), undefined, catalogos);

    expect(aoa[1][idx('categoria')]).toBe('Bombas de Agua');
    expect(aoa[1][idx('subcategoria')]).toBe('');
  });

  it('no pisa la subcategoría que el archivo ya traía', () => {
    const catalogos = {
      ...ESQUEMA_FALLBACK.catalogos,
      categorias: ['Accesorios'],
      subcategoriasPorCategoria: { Accesorios: ['Iluminación', 'Interior'] },
    };
    const userCols = cols(['rubro', 'subrubro']);
    const aoa = buildOfficialAoA(
      [['Iluminación', 'Interior']], userCols, mapa({ categoria: '0', subcategoria: '1' }), undefined, catalogos,
    );

    expect(aoa[1][idx('subcategoria')]).toBe('Interior');
    expect(aoa[1][idx('categoria')]).toBe('Iluminación');
  });

  it('con un solo año, el año hasta queda igual al desde', () => {
    // "Sirve para el RAV4 2015" es desde 2015 hasta 2015, que es lo que ya hace la carga 1:1.
    const userCols = cols(['ano']);
    const aoa = buildOfficialAoA([['2015']], userCols, mapa({ anio_desde: '0' }));
    expect(aoa[1][idx('anio_desde')]).toBe('2015');
    expect(aoa[1][idx('anio_hasta')]).toBe('2015');
  });

  it('no completa el año hasta con un rango que nadie pidió partir', () => {
    // Copiar "2014-2020" entero al hasta sería inventar un dato absurdo: se deja como está y el
    // paso 3 lo marca como número que no se puede leer.
    const userCols = cols(['ano']);
    const aoa = buildOfficialAoA([['2014-2020']], userCols, mapa({ anio_desde: '0' }));
    expect(aoa[1][idx('anio_hasta')]).toBe('');
  });

  it('respeta el año hasta que sí trae el archivo', () => {
    const userCols = cols(['desde', 'hasta']);
    const aoa = buildOfficialAoA([['2014', '2020']], userCols, mapa({ anio_desde: '0', anio_hasta: '1' }));
    expect(aoa[1][idx('anio_desde')]).toBe('2014');
    expect(aoa[1][idx('anio_hasta')]).toBe('2020');
  });

  it('parte el rango de años cuando el vendedor lo pide', () => {
    const userCols = cols(['anios']);
    const con = buildOfficialAoA([['2014-2020']], userCols, mapa({ anio_desde: '0' }, { dividirAnios: true }));
    expect(con[1][idx('anio_desde')]).toBe('2014');
    expect(con[1][idx('anio_hasta')]).toBe('2020');

    const sin = buildOfficialAoA([['2014-2020']], userCols, mapa({ anio_desde: '0' }));
    expect(sin[1][idx('anio_desde')]).toBe('2014-2020');
    expect(sin[1][idx('anio_hasta')]).toBe('');
  });

  it('el rango no pisa la columna de "año hasta" que el vendedor sí trajo', () => {
    const userCols = cols(['anios', 'hasta']);
    const aoa = buildOfficialAoA(
      [['2014-2020', '2018']],
      userCols,
      mapa({ anio_desde: '0', anio_hasta: '1' }, { dividirAnios: true }),
    );
    expect(aoa[1][idx('anio_hasta')]).toBe('2018');
  });

  it('el valor fijo entra después de limpiar, no antes', () => {
    const userCols = cols(['precio']);
    const aoa = buildOfficialAoA(
      [['  ']],
      userCols,
      mapa({ precio: '0' }, { defaults: { precio: '9990', condicion: 'ALTERNATIVO' } }),
    );
    expect(aoa[1][idx('precio')]).toBe('9990');
    expect(aoa[1][idx('condicion')]).toBe('ALTERNATIVO');
  });

  it('informa los arreglos hechos, para poder mostrarlos antes de generar', () => {
    const userCols = cols(['precio']);
    const { cambios } = buildOfficialAoADetallado(
      [['$ 1.000'], ['$ 1.000'], ['2500']],
      userCols,
      mapa({ precio: '0' }),
    );
    expect(cambios).toHaveLength(2);
    expect(cambios[0]).toEqual({ columna: 'precio', antes: '$ 1.000', despues: '1000' });
  });
});

/* --------------------------------------------------------------------------
 * Contrato de columnas contra el backend.
 *
 * Vivia en BulkUpload.columns.test.ts, junto al parser que la Fase 8 retiro: el
 * contrato ya no vive ahi. Las posiciones se comprueban una por una a proposito -- el
 * backend lee las filas por indice, y `compatibilidad_general` en la columna K es
 * justamente lo que se corrio al pasar de la plantilla 1.x a la 2.0.0.
 * ------------------------------------------------------------------------ */

describe('contrato de columnas de la plantilla oficial', () => {
  it('tiene las 18 columnas del backend, en orden', () => {
    expect(PLANTILLA_COLUMNAS).toHaveLength(18);
    expect(PLANTILLA_COLUMNAS[0]).toBe('nombre_publicado');
    expect(PLANTILLA_COLUMNAS[4]).toBe('sku_proveedor');
    expect(PLANTILLA_COLUMNAS[9]).toBe('condicion');
    expect(PLANTILLA_COLUMNAS[10]).toBe('compatibilidad_general');
    expect(PLANTILLA_COLUMNAS[16]).toBe('descripcion');
    expect(PLANTILLA_COLUMNAS[17]).toBe('requiere_chasis');
  });

  it('el esquema de respaldo declara la misma lista y la version de la plantilla', () => {
    expect(ESQUEMA_FALLBACK.columnas).toEqual([...PLANTILLA_COLUMNAS]);
    expect(ESQUEMA_FALLBACK.version).toBe('2.1.0');
    expect(ESQUEMA_FALLBACK.hojaCompatibilidadesColumnas).toContain('referencia_oem');
  });
});

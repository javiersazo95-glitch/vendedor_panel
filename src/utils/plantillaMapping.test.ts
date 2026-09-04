import { describe, expect, it, beforeEach } from 'vitest';

import {
  ESQUEMA_FALLBACK,
  PLANTILLA_COLUMNAS,
  autoDetectMapping,
  buildOfficialAoA,
  buildOfficialXlsxFile,
  camposDesdeEsquema,
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

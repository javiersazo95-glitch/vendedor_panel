import { describe, expect, it } from 'vitest';

import { PLANTILLA_CAMPOS, PLANTILLA_COLUMNAS } from './plantillaMapping';
import {
  camposPorCompletar,
  fichaDesdeFila,
  normalizarNumero,
  revisarAoA,
} from './plantillaRevision';

const columnas = [...PLANTILLA_COLUMNAS] as string[];

/** Fila oficial completa y sana, sobre la que cada test rompe una cosa. */
const filaBase = (over: Record<string, string> = {}): string[] => {
  const valores: Record<string, string> = {
    nombre_publicado: 'Filtro de aceite',
    categoria: 'Filtros',
    subcategoria: '',
    marca_repuesto: 'Bosch',
    sku_proveedor: 'A-1',
    referencia_oem: '',
    tipo_precio: 'MOSTRAR_PRECIO',
    precio: '4990',
    stock: '10',
    condicion: 'ORIGINAL',
    compatibilidad_general: 'NO',
    compatibilidad_marca: 'Toyota',
    compatibilidad_modelo: 'Corolla',
    anio_desde: '2014',
    anio_hasta: '2020',
    motor: '1.8',
    descripcion: '',
    requiere_chasis: 'NO',
    ...over,
  };
  return columnas.map((c) => valores[c] ?? '');
};

const revisar = (filas: string[][]) => revisarAoA([columnas, ...filas], PLANTILLA_CAMPOS);

describe('normalizarNumero', () => {
  it('entiende el formato chileno de precio', () => {
    expect(normalizarNumero('$ 4.990')).toEqual({ numero: 4990, comoMiles: true });
    expect(normalizarNumero('12.900')).toEqual({ numero: 12900, comoMiles: true });
    expect(normalizarNumero('1.234,50').numero).toBe(1234.5);
    expect(normalizarNumero('  15990 CLP ').numero).toBe(15990);
  });

  it('un punto que no es de miles se respeta como decimal', () => {
    expect(normalizarNumero('4.99')).toEqual({ numero: 4.99, comoMiles: false });
  });

  it('devuelve null cuando no es un número', () => {
    expect(normalizarNumero('consultar').numero).toBeNull();
    expect(normalizarNumero('').numero).toBeNull();
  });
});

describe('revisarAoA', () => {
  it('una fila sana no tiene nada que revisar', () => {
    const r = revisar([filaBase()]);
    expect(r.total).toBe(1);
    expect(r.publicables).toBe(1);
    expect(r.conError).toBe(0);
    expect(r.filas[0].problemas).toEqual([]);
  });

  it('marca como error los obligatorios vacíos', () => {
    const r = revisar([filaBase({ categoria: '', sku_proveedor: '' })]);
    expect(r.conError).toBe(1);
    expect(r.publicables).toBe(0);
    expect(r.filas[0].problemas.map((p) => p.columna)).toEqual(
      expect.arrayContaining(['categoria', 'sku_proveedor']),
    );
    expect(r.filas[0].problemas[0].mensaje).toMatch(/^Falta /);
  });

  it('marca como error un número que no se puede leer y uno negativo', () => {
    const r = revisar([filaBase({ precio: 'consultar' }), filaBase({ stock: '-3' })]);
    expect(r.conError).toBe(2);
    expect(r.filas[0].problemas[0]).toMatchObject({ columna: 'precio', severidad: 'error' });
    expect(r.filas[1].problemas[0].mensaje).toMatch(/no puede ser negativo/);
  });

  it('acepta el precio con separador de miles, pero avisa cómo se va a publicar', () => {
    const r = revisar([filaBase({ precio: '$ 4.990' })]);
    expect(r.conError).toBe(0);
    expect(r.publicables).toBe(1);
    expect(r.conAviso).toBe(1);
    expect(r.filas[0].problemas[0]).toMatchObject({ severidad: 'aviso' });
    expect(r.filas[0].problemas[0].mensaje).toContain('4.990');
  });

  it('sin precio y sin "solo cotizar" el backend rechaza la fila', () => {
    const r = revisar([filaBase({ precio: '' })]);
    expect(r.conError).toBe(1);
    expect(r.filas[0].problemas[0].mensaje).toMatch(/Falta el precio/);
  });

  it('sin precio pero marcado para cotizar, la fila está bien', () => {
    const r = revisar([filaBase({ precio: '', tipo_precio: 'SOLO_COTIZAR' })]);
    expect(r.conError).toBe(0);
    expect(r.filas[0].problemas).toEqual([]);
  });

  it('avisa cuando el backend va a reinterpretar la condición en silencio', () => {
    const r = revisar([filaBase({ condicion: 'Usado' })]);
    expect(r.conError).toBe(0);
    expect(r.filas[0].problemas[0]).toMatchObject({ columna: 'condicion', severidad: 'aviso' });
    expect(r.filas[0].problemas[0].mensaje).toContain('ORIGINAL');
  });

  it('avisa cuando un SI/NO no se entiende', () => {
    const r = revisar([filaBase({ requiere_chasis: 'a veces' })]);
    expect(r.filas[0].problemas[0]).toMatchObject({ columna: 'requiere_chasis', severidad: 'aviso' });
  });

  it('avisa cuando los años están al revés', () => {
    const r = revisar([filaBase({ anio_desde: '2020', anio_hasta: '2014' })]);
    expect(r.filas[0].problemas[0].mensaje).toMatch(/mayor que el año hasta/);
  });

  it('los contadores miran todo el archivo aunque sólo se muestren algunas filas', () => {
    const filas = [
      ...Array.from({ length: 30 }, () => filaBase()),
      ...Array.from({ length: 5 }, () => filaBase({ categoria: '' })),
    ];
    const r = revisarAoA([columnas, ...filas], PLANTILLA_CAMPOS, { maxFilas: 20 });
    expect(r.total).toBe(35);
    expect(r.publicables).toBe(30);
    expect(r.conError).toBe(5);
    expect(r.filas).toHaveLength(20);
  });

  it('numera las filas como están en el Excel del vendedor', () => {
    // Títulos en la fila 4 => la primera fila de datos es la 5.
    const r = revisarAoA([columnas, filaBase(), filaBase()], PLANTILLA_CAMPOS, { primeraFilaArchivo: 5 });
    expect(r.filas.map((f) => f.numeroFila)).toEqual([5, 6]);
  });
});

describe('fichaDesdeFila', () => {
  it('arma el repuesto como lo verá el comprador', () => {
    const ficha = fichaDesdeFila(columnas, filaBase({ descripcion: 'Filtro de alto flujo' }));
    expect(ficha.nombre).toBe('Filtro de aceite');
    expect(ficha.marca).toBe('Bosch');
    expect(ficha.condicion).toBe('Original');
    expect(ficha.precio.replace(/\u00a0/g, ' ')).toContain('4.990');
    expect(ficha.compatibilidad).toBe('Toyota Corolla 2014-2020 1.8');
    expect(ficha.descripcion).toBe('Filtro de alto flujo');
  });

  it('un repuesto universal lo dice en vez de mostrar una compatibilidad vacía', () => {
    const ficha = fichaDesdeFila(columnas, filaBase({
      compatibilidad_general: 'SI',
      compatibilidad_marca: '',
      compatibilidad_modelo: '',
      anio_desde: '',
      anio_hasta: '',
      motor: '',
    }));
    expect(ficha.compatibilidad).toMatch(/todos los vehículos/);
  });

  it('sin precio a la vista muestra que se cotiza', () => {
    const ficha = fichaDesdeFila(columnas, filaBase({ tipo_precio: 'SOLO_COTIZAR', precio: '' }));
    expect(ficha.precio).toBe('Precio a consultar');
    expect(fichaDesdeFila(columnas, filaBase({ condicion: 'ALTERNATIVO' })).condicion).toBe('Alternativo');
  });
});

/* --------------------------------------------------------------------------
 * Fase 5: revisión contra los catálogos reales, con la consecuencia de cada columna.
 * ------------------------------------------------------------------------ */

const CATALOGOS = {
  categorias: ['Frenos', 'Filtros'],
  subcategoriasPorCategoria: { Frenos: ['Pastillas', 'Discos'], Filtros: ['Filtro de aceite'] },
  marcasRepuesto: ['Bosch', 'Brembo'],
  marcasVehiculo: [],
  tiposPrecio: ['MOSTRAR_PRECIO', 'SOLO_COTIZAR'],
  condiciones: ['ORIGINAL', 'ALTERNATIVO'],
};

const revisarConCatalogos = (over: Record<string, string>) =>
  revisarAoA([columnas, filaBase(over)], PLANTILLA_CAMPOS, { catalogos: CATALOGOS });

describe('revisarAoA contra los catálogos', () => {
  it('una categoría que no existe es error: el backend no la crea y la fila no se publica', () => {
    const r = revisarConCatalogos({ categoria: 'Frenos delanteros' });
    expect(r.conError).toBe(1);
    const problema = r.filas[0].problemas.find((p) => p.columna === 'categoria');
    expect(problema?.severidad).toBe('error');
    expect(problema?.mensaje).toContain('¿Querías decir "Frenos"?');
  });

  it('una subcategoría ajena a la categoría es aviso: el repuesto se publica sin ella', () => {
    const r = revisarConCatalogos({ categoria: 'Frenos', subcategoria: 'Filtro de aceite' });
    expect(r.conError).toBe(0);
    const problema = r.filas[0].problemas.find((p) => p.columna === 'subcategoria');
    expect(problema?.severidad).toBe('aviso');
    expect(problema?.mensaje).toContain('sin subcategoría');
  });

  it('una marca fuera del catálogo es aviso: el backend la crea, pero conviene revisarla', () => {
    const r = revisarConCatalogos({ categoria: 'Frenos', marca_repuesto: 'Bosh' });
    expect(r.conError).toBe(0);
    const problema = r.filas[0].problemas.find((p) => p.columna === 'marca_repuesto');
    expect(problema?.severidad).toBe('aviso');
    expect(problema?.mensaje).toContain('marca nueva');
    expect(problema?.mensaje).toContain('"Bosch"');
  });

  it('lo que sí está en el catálogo no molesta, aunque cambien acentos o mayúsculas', () => {
    const r = revisarConCatalogos({ categoria: 'FRENOS', subcategoria: 'pastillas', marca_repuesto: 'bosch' });
    expect(r.filas[0].problemas).toEqual([]);
  });

  it('sin catálogos no se revisa nada contra ellos: el esquema pudo no responder', () => {
    const r = revisar([filaBase({ categoria: 'Cualquier cosa', marca_repuesto: 'Marca X' })]);
    expect(r.conError).toBe(0);
    expect(r.filas[0].problemas).toEqual([]);
  });
});

describe('camposPorCompletar', () => {
  const AGRUPADO = { subcategoria: 'categoria' };

  it('agrupa por categoría las filas sin subcategoría, de la que más pesa a la que menos', () => {
    const huecos = camposPorCompletar([
      columnas,
      filaBase({ categoria: 'Frenos', subcategoria: '' }),
      filaBase({ categoria: 'Suspensión', subcategoria: '' }),
      filaBase({ categoria: 'Frenos', subcategoria: '' }),
      filaBase({ categoria: 'Frenos', subcategoria: 'Pastillas' }),
    ], AGRUPADO);

    expect(huecos).toHaveLength(1);
    expect(huecos[0].columna).toBe('subcategoria');
    // La fila que ya trae subcategoría no cuenta.
    expect(huecos[0].filas).toBe(3);
    expect(huecos[0].grupos).toEqual([
      { clave: 'Frenos', filas: 2 },
      { clave: 'Suspensión', filas: 1 },
    ]);
  });

  it('salta las filas sin categoría: no hay lista que ofrecer', () => {
    const huecos = camposPorCompletar([
      columnas,
      filaBase({ categoria: '', subcategoria: '' }),
      filaBase({ categoria: 'Frenos', subcategoria: '' }),
    ], AGRUPADO);
    expect(huecos[0].filas).toBe(1);
    expect(huecos[0].grupos).toEqual([{ clave: 'Frenos', filas: 1 }]);
  });

  it('no propone nada cuando no falta ninguno', () => {
    expect(camposPorCompletar([
      columnas,
      filaBase({ categoria: 'Frenos', subcategoria: 'Pastillas' }),
    ], AGRUPADO)).toEqual([]);
  });

  it('ignora un campo que la hoja no trae', () => {
    expect(camposPorCompletar([['nombre_publicado'], ['Filtro']], AGRUPADO)).toEqual([]);
  });
});

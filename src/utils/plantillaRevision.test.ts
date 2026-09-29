import { describe, expect, it } from 'vitest';

import { PLANTILLA_CAMPOS, PLANTILLA_COLUMNAS } from './plantillaMapping';
import { fichaDesdeFila, normalizarNumero, revisarAoA } from './plantillaRevision';

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

  it('retiene una condición que no es ORIGINAL ni ALTERNATIVO', () => {
    // Fase 3: antes era aviso ("se va a publicar como ORIGINAL"); quien usa el panel no lee
    // avisos, y un "Usado" publicado como original es un dato falso en la vitrina.
    const r = revisar([filaBase({ condicion: 'Usado' })]);
    expect(r.conError).toBe(1);
    expect(r.filas[0].problemas[0]).toMatchObject({ columna: 'condicion', severidad: 'error' });
    expect(r.filas[0].problemas[0].mensaje).toContain('ORIGINAL');
  });

  it('retiene un SI/NO que no se entiende', () => {
    const r = revisar([filaBase({ requiere_chasis: 'a veces' })]);
    expect(r.filas[0].problemas[0]).toMatchObject({ columna: 'requiere_chasis', severidad: 'error' });
  });

  it('retiene los años al revés', () => {
    const r = revisar([filaBase({ anio_desde: '2020', anio_hasta: '2014' })]);
    expect(r.conError).toBe(1);
    expect(r.filas[0].problemas[0].mensaje).toMatch(/mayor que el año hasta/);
  });

  it('muestra las filas con problemas aunque estén al final del archivo, no las primeras 20', () => {
    // El caso que dejaba al vendedor sin salida: los contadores decían "5 con error" y la tabla
    // mostraba 20 filas sanas, porque los errores caían en la fila 31 en adelante.
    const filas = [
      ...Array.from({ length: 30 }, () => filaBase()),
      ...Array.from({ length: 5 }, (_, i) => filaBase({ categoria: '', sku_proveedor: `MALA-${i}` })),
    ];
    const r = revisarAoA([columnas, ...filas], PLANTILLA_CAMPOS, { maxFilas: 20 });

    const sku = (f: { valores: string[] }) => f.valores[columnas.indexOf('sku_proveedor')];
    const mostradas = r.filas.map(sku);

    expect(r.filas).toHaveLength(20);
    // Las cinco con error entran, y van primero.
    expect(mostradas.slice(0, 5)).toEqual(['MALA-0', 'MALA-1', 'MALA-2', 'MALA-3', 'MALA-4']);
    expect(r.filas.slice(0, 5).every((f) => f.tieneError)).toBe(true);
    // El resto se completa con filas sanas, hasta el tope.
    expect(r.filas.slice(5).every((f) => !f.tieneError)).toBe(true);
  });

  it('entre filas con problemas, las que no se publican van antes que las que sólo avisan', () => {
    const filas = [
      filaBase({ sku_proveedor: 'AVISO-1', precio: '4.990' }),
      filaBase({ sku_proveedor: 'SANA-1' }),
      filaBase({ sku_proveedor: 'ERROR-1', categoria: '' }),
    ];
    const r = revisarAoA([columnas, ...filas], PLANTILLA_CAMPOS, { maxFilas: 20 });

    const sku = (f: { valores: string[] }) => f.valores[columnas.indexOf('sku_proveedor')];
    expect(r.filas.map(sku)).toEqual(['ERROR-1', 'AVISO-1', 'SANA-1']);
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
  marcasVehiculo: ['Toyota', 'Nissan', 'Mazda'],
  modelosPorMarcaVehiculo: { toyota: ['Corolla', 'Yaris'], mazda: ['Mazda 2', 'Mazda 3'] },
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

describe('Fase 3: vehículo o universal, años posibles y lo que ya no pasa en verde', () => {
  it('una fila sin vehículo y sin universal se retiene, con la salida', () => {
    const r = revisar([filaBase({ compatibilidad_marca: '', compatibilidad_modelo: '', anio_desde: '', anio_hasta: '', motor: '' })]);
    expect(r.conError).toBe(1);
    expect(r.filas[0].problemas[0].mensaje).toMatch(/Falta el vehículo/);
    expect(r.filas[0].problemas[0].mensaje).toMatch(/compatibilidad universal/);
  });

  it('una fila universal no necesita vehículo', () => {
    const r = revisar([filaBase({ compatibilidad_general: 'SI', compatibilidad_marca: '', compatibilidad_modelo: '', anio_desde: '', anio_hasta: '', motor: '' })]);
    expect(r.filas[0].problemas).toEqual([]);
  });

  it('marca y modelo sin año desde se retienen: el backend no resuelve sin el año', () => {
    const r = revisar([filaBase({ anio_desde: '', anio_hasta: '' })]);
    expect(r.conError).toBe(1);
    expect(r.filas[0].problemas[0]).toMatchObject({ columna: 'anio_desde', severidad: 'error' });
  });

  it('un año imposible se retiene: "2006 2010" leído como 20062010, o 1925', () => {
    expect(revisar([filaBase({ anio_desde: '20062010' })]).conError).toBe(1);
    expect(revisar([filaBase({ anio_desde: '1925', anio_hasta: '1930' })]).conError).toBe(1);
    expect(revisar([filaBase({ anio_desde: '2014', anio_hasta: String(new Date().getFullYear() + 5) })]).conError).toBe(1);
  });

  it('la marca dentro del modelo se retiene: la aplicación no se separó', () => {
    const r = revisarConCatalogos({ compatibilidad_modelo: 'Toyota Corolla' });
    expect(r.conError).toBe(1);
    expect(r.filas[0].problemas[0].mensaje).toMatch(/trae la marca dentro del modelo/);
  });

  it('varios autos en la celda del modelo ya no es aviso: se retiene', () => {
    const r = revisar([filaBase({ compatibilidad_modelo: 'Corolla 2014-2018 / Yaris 2015-2019' })]);
    expect(r.conError).toBe(1);
    expect(r.filas[0].problemas[0].severidad).toBe('error');
  });

  it('el precio 0 con precio a la vista se retiene', () => {
    const r = revisar([filaBase({ precio: '0' })]);
    expect(r.conError).toBe(1);
    expect(r.filas[0].problemas[0].mensaje).toMatch(/no puede ser 0/);
    expect(revisar([filaBase({ precio: '0', tipo_precio: 'SOLO_COTIZAR' })]).conError).toBe(0);
  });
});

describe('Fase 4: marca y modelo del vehículo contra el catálogo', () => {
  const revisarConModelos = (over: Record<string, string>) =>
    revisarAoA([columnas, filaBase(over)], PLANTILLA_CAMPOS, {
      catalogos: CATALOGOS, modelosPorMarca: CATALOGOS.modelosPorMarcaVehiculo,
    });

  it('una marca de vehículo que no está en el catálogo se retiene, con la sugerencia', () => {
    const r = revisarConModelos({ compatibilidad_marca: 'Toyoya' });
    expect(r.conError).toBe(1);
    const problema = r.filas[0].problemas.find((p) => p.columna === 'compatibilidad_marca');
    expect(problema?.mensaje).toContain('"Toyoya" no está en el catálogo');
    expect(problema?.mensaje).toContain('¿Querías decir "Toyota"?');
  });

  it('un modelo que no existe para la marca se retiene, con la sugerencia', () => {
    const r = revisarConModelos({ compatibilidad_modelo: 'Corola' });
    expect(r.conError).toBe(1);
    const problema = r.filas[0].problemas.find((p) => p.columna === 'compatibilidad_modelo');
    expect(problema?.mensaje).toContain('"Corola" no existe para Toyota');
    expect(problema?.mensaje).toContain('¿Querías decir "Corolla"?');
  });

  it('el modelo se acepta sin espacios ni mayúsculas: "MAZDA2" es "Mazda 2"', () => {
    const r = revisarConModelos({ compatibilidad_marca: 'MAZDA', compatibilidad_modelo: 'MAZDA2' });
    expect(r.filas[0].problemas).toEqual([]);
  });

  it('sin la lista de modelos de esa marca no se dice nada del modelo', () => {
    const r = revisarConModelos({ compatibilidad_marca: 'Nissan', compatibilidad_modelo: 'V16' });
    expect(r.filas[0].problemas).toEqual([]);
  });
});

describe('decimales donde no corresponden', () => {
  it('el precio con decimales no pasa, y propone el entero más cercano', () => {
    // Se retiene en vez de avisar: quien usa el panel no va a revisar una lista de avisos,
    // y un precio mal publicado se pierde en cada venta hasta que alguien lo note.
    const { filas, publicables, conError } = revisar([filaBase({ precio: '1234.5' })]);
    expect(conError).toBe(1);
    expect(publicables).toBe(0);
    expect(filas[0].problemas[0].severidad).toBe('error');
    expect(filas[0].problemas[0].mensaje).toBe(
      'En pesos los precios son enteros y "1234.5" tiene decimales.'
      + ' Corrígelo: ¿querías decir 1.235?',
    );
  });

  it('el stock con decimales es un error: no se vende media unidad', () => {
    const { filas, conError } = revisar([filaBase({ stock: '2.5' })]);
    expect(conError).toBe(1);
    expect(filas[0].problemas[0]).toEqual({
      columna: 'stock',
      severidad: 'error',
      mensaje: 'Stock no puede tener decimales: "2.5".',
    });
  });

  it('un precio entero no dice nada', () => {
    expect(revisar([filaBase({ precio: '24990' })]).filas[0].problemas).toEqual([]);
  });
});


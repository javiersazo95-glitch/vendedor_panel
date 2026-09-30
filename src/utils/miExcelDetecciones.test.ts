import { describe, expect, it } from 'vitest';
import { COLUMNAS_DE_CATALOGO, conArreglosPropuestos, motivoSinOpciones, opcionesDeCelda } from './miExcelDetecciones';
import { camposDesdeEsquema } from './plantillaMapping';
import { ESQUEMA_FALLBACK, autoDetectMapping, reconcileMapping, type UserColumn } from './plantillaMapping';

const cols = (headers: string[]): UserColumn[] =>
  headers.map((h, index) => ({ id: String(index), rawHeader: h, displayHeader: h, index }));

/**
 * Prueba en local del 30-sep: el Excel traía una columna "Foto" con enlaces y el interruptor para
 * usarla venía apagado; un vendedor que no lo encendía publicaba sin fotos sin enterarse.
 */
describe('la columna de fotos del Excel', () => {
  const columnas = cols(['Código', 'Descripción', 'Precio', 'Cant.', 'Foto']);
  const filas = [
    ['T-1', 'Pastilla de freno', '18990', '6', 'https://picsum.photos/id/1071/800/600'],
    ['T-2', 'Filtro de aceite', '5990', '20', 'https://picsum.photos/id/1072/800/600'],
    ['T-3', 'Radiador', '74990', '3', ''],
  ];

  it('si el archivo trae una columna de fotos, se usa sola y no va a la descripción', () => {
    const m = conArreglosPropuestos(autoDetectMapping(columnas), columnas, filas, ESQUEMA_FALLBACK);
    expect(m.columnaFotos).toBe('4');
    expect(m.extras['4']).toBe('ignore');
  });

  it('si el vendedor la apagó, no se vuelve a encender, ni al reutilizar el mapeo', () => {
    const apagada = { ...autoDetectMapping(columnas), columnaFotos: null };
    expect(conArreglosPropuestos(apagada, columnas, filas, ESQUEMA_FALLBACK).columnaFotos).toBeNull();
    const reutilizado = reconcileMapping(apagada, columnas);
    expect(conArreglosPropuestos(reutilizado, columnas, filas, ESQUEMA_FALLBACK).columnaFotos).toBeNull();
  });

  it('sin columna de fotos no se inventa ninguna', () => {
    const sinFotos = cols(['Código', 'Descripción', 'Precio']);
    const m = conArreglosPropuestos(autoDetectMapping(sinFotos), sinFotos, [['T-1', 'Pastilla', '100']], ESQUEMA_FALLBACK);
    expect(m.columnaFotos ?? null).toBeNull();
  });
});

/**
 * Etapa 3: los datos que RepuesTop tiene registrados se eligen siempre de una lista (o se dejan en
 * blanco). Si la lista viene vacía, se dice por qué, en vez de dejar escribir cualquier cosa.
 */
describe('las listas de las columnas de catálogo', () => {
  const esquema = {
    ...ESQUEMA_FALLBACK,
    catalogos: { ...ESQUEMA_FALLBACK.catalogos, categorias: ['Frenos'], subcategoriasPorCategoria: { Frenos: ['Pastillas', 'Discos'] } },
  };
  const campos = camposDesdeEsquema(esquema);
  const modelos = { toyota: ['Yaris', 'Corolla'] };
  const fila = { categoria: '', marcaVehiculo: '', anioDesde: '' };

  it('categoría, subcategoría, marcas, modelo, años, motor y listas fijas son de catálogo; nombre y precio no', () => {
    for (const c of ['categoria', 'subcategoria', 'marca_repuesto', 'compatibilidad_marca', 'compatibilidad_modelo', 'anio_desde', 'motor', 'requiere_chasis']) {
      expect(COLUMNAS_DE_CATALOGO.has(c)).toBe(true);
    }
    for (const c of ['nombre_publicado', 'precio', 'stock', 'sku_proveedor', 'descripcion']) expect(COLUMNAS_DE_CATALOGO.has(c)).toBe(false);
  });

  it('la subcategoría sale de la categoría de la fila, aunque esté escrita en minúsculas', () => {
    expect(opcionesDeCelda('subcategoria', { ...fila, categoria: 'frenos' }, esquema, campos, modelos)).toEqual(['Pastillas', 'Discos']);
    expect(motivoSinOpciones('subcategoria', fila, esquema, campos, modelos)).toBe('Primero elige la categoría');
  });

  it('el modelo pide primero la marca del vehículo, y una fila universal no lleva vehículo', () => {
    expect(motivoSinOpciones('compatibilidad_modelo', fila, esquema, campos, modelos)).toBe('Primero elige la marca del vehículo');
    expect(motivoSinOpciones('compatibilidad_modelo', { ...fila, marcaVehiculo: 'Toyota' }, esquema, campos, modelos)).toBeNull();
    const universal = { ...fila, marcaVehiculo: 'Toyota', universal: true };
    expect(opcionesDeCelda('compatibilidad_modelo', universal, esquema, campos, modelos)).toEqual([]);
    expect(motivoSinOpciones('motor', universal, esquema, campos, modelos)).toMatch(/Es universal/);
  });

  it('sin las listas de RepuesTop lo dice (no deja escribir la marca a mano)', () => {
    expect(motivoSinOpciones('marca_repuesto', fila, ESQUEMA_FALLBACK, camposDesdeEsquema(ESQUEMA_FALLBACK), {})).toMatch(/No pudimos cargar la lista/);
  });
});

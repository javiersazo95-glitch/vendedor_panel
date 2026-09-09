/**
 * Qué hace hoy el panel con los archivos crudos de `pruebas-crudas/`.
 *
 * No es una lista de deseos: cada expectativa describe el comportamiento **actual**, para
 * que cuando lo cambiemos el test diga exactamente qué se movió. Los casos que hoy salen
 * mal están marcados con GAP y son la lista de trabajo pendiente; los que salen bien
 * quedan protegidos contra regresiones.
 */
import { describe, expect, it } from 'vitest';

import { CASOS_CRUDOS } from '../../pruebas-crudas/casos.mjs';
import type { EsquemaPlantilla, Mapping } from './plantillaMapping';
import {
  autoDetectMapping,
  buildOfficialAoADetallado,
  columnasDeHoja,
  detectarFilaEncabezados,
  ESQUEMA_FALLBACK,
  PLANTILLA_CAMPOS,
  requiereValorEnPanel,
} from './plantillaMapping';
import { separarPorSku } from './plantillaCompatibilidad';
import { detectarSegundaTabla } from './plantillaFilas';
import { revisarAoA } from './plantillaRevision';

/** El camino que recorre el wizard solo, antes de que el vendedor corrija nada. */
const CATALOGOS: EsquemaPlantilla['catalogos'] = {
  ...ESQUEMA_FALLBACK.catalogos,
  categorias: ['Frenos', 'Filtros', 'Suspensión', 'Motor'],
  // "Toyota" está a propósito: es marca de repuesto (genuino) y de vehículo a la vez.
  marcasRepuesto: ['Bosch', 'Mann', 'Monroe', 'NGK', 'Gates', 'Toyota', 'Brembo'],
  subcategoriasPorCategoria: {
    Frenos: ['Pastillas', 'Discos'],
    Filtros: ['Filtro de aceite', 'Filtro de aire'],
    // "Suspensión" a propósito sin subcategorías: pasa en el catálogo real.
  },
};

const leerComoElPanel = (id: string, banderas: Partial<Mapping> = {}) => {
  const encontrado = CASOS_CRUDOS.find((c) => c.id === id);
  if (!encontrado) throw new Error(`No existe el caso crudo ${id}`);
  const filaEncabezados = detectarFilaEncabezados(encontrado.aoa);
  const { cols, rows, filasOriginales } = columnasDeHoja(encontrado.aoa, filaEncabezados);
  const mapping = { ...autoDetectMapping(cols, PLANTILLA_CAMPOS), ...banderas };
  const { aoa: oficial, filasOrigen, porCompletar } = buildOfficialAoADetallado(
    rows, cols, mapping, PLANTILLA_CAMPOS, CATALOGOS,
  );
  return {
    filaEncabezados,
    cols,
    rows,
    mapping,
    oficial,
    /** Obligatorios del contrato del backend que el archivo no trae. */
    faltanObligatorios: ESQUEMA_FALLBACK.columnasObligatorias.filter((k) => !mapping.oficial[k]),
    /** Lo que el paso 2 exige llenar antes de dejar avanzar. */
    faltanEnElPaso2: PLANTILLA_CAMPOS
      .filter((c) => requiereValorEnPanel(c, mapping) && !mapping.oficial[c.key]
        && !(mapping.defaults?.[c.key] ?? '').trim())
      .map((c) => c.key),
    filasOrigen,
    porCompletar,
    revision: revisarAoA(oficial, PLANTILLA_CAMPOS, {
      maxFilas: 50,
      catalogos: CATALOGOS,
      // La misma cuenta que hace el panel: de qué fila de la hoja salió, y el Excel
      // empieza a contar en 1.
      numerosDeFila: filasOrigen.map((i) => filasOriginales[i] + 1),
    }),
  };
};

/** Valor de una columna oficial en una fila del archivo generado (fila 1 = primer dato). */
const valorEn = (oficial: (string | number)[][], fila: number, columna: string) =>
  String(oficial[fila][oficial[0].indexOf(columna)] ?? '');

describe('archivos crudos: lo que ya funciona', () => {
  it('encuentra los títulos aunque estén debajo del membrete del local', () => {
    const r = leerComoElPanel('04-titulos-abajo');
    expect(r.filaEncabezados).toBe(4);
    expect(r.faltanObligatorios).toEqual([]);
    expect(r.revision.publicables).toBe(2);
    expect(r.revision.conError).toBe(0);
  });

  it('separa los varios vehículos de una celda en una compatibilidad por auto', () => {
    const r = leerComoElPanel('09-varios-autos-por-celda', { separarAplicaciones: true });
    // Dos repuestos que traían 3 y 2 autos: cinco filas antes de juntarlas por código.
    expect(r.oficial.length - 1).toBe(5);
    expect(valorEn(r.oficial, 1, 'compatibilidad_marca')).toBe('Toyota');
    expect(valorEn(r.oficial, 1, 'compatibilidad_modelo')).toBe('COROLLA');
    expect(valorEn(r.oficial, 1, 'anio_desde')).toBe('2014');
    expect(valorEn(r.oficial, 3, 'compatibilidad_marca')).toBe('Chevrolet');
    // El salto de línea sirve igual que la barra.
    expect(valorEn(r.oficial, 5, 'compatibilidad_modelo')).toBe('RIO');

    const { inventario, compatibilidades } = separarPorSku(r.oficial);
    expect(inventario.length - 1).toBe(2);
    expect(compatibilidades.length - 1).toBe(3);
    expect(revisarAoA(inventario, PLANTILLA_CAMPOS).conError).toBe(0);
  });

  it('avisa cuando la celda trae varios autos y el vendedor no activó la separación', () => {
    const r = leerComoElPanel('09-varios-autos-por-celda');
    // Sin el interruptor los datos siguen saliendo mal, pero ya no salen en silencio.
    expect(r.revision.conAviso).toBe(2);
    const mensajes = r.revision.filas.flatMap((f) => f.problemas.map((p) => p.mensaje));
    expect(mensajes[0]).toContain('varios autos en una sola celda');
  });

  it('el paso 2 pide el precio aunque el contrato del backend no lo exija', () => {
    const r = leerComoElPanel('08-sin-precio-ni-stock');
    // El esquema sólo echa de menos el stock…
    expect(ESQUEMA_FALLBACK.columnasObligatorias).not.toContain('precio');
    expect(r.faltanObligatorios).toEqual(['stock']);
    // …pero el paso 2 también frena por el precio, que es lo que dejaría 0 publicables.
    expect(r.faltanEnElPaso2).toEqual(['precio', 'stock']);
  });

  it('el precio deja de hacer falta cuando todo el inventario es a cotizar', () => {
    const r = leerComoElPanel('08-sin-precio-ni-stock', {
      defaults: { tipo_precio: 'SOLO_COTIZAR' },
    });
    expect(r.faltanEnElPaso2).toEqual(['stock']);
  });

  it('la única columna descriptiva es el nombre del repuesto, no la descripción larga', () => {
    const r = leerComoElPanel('01-lista-dos-columnas');
    // `nombre_publicado` es obligatorio y `descripcion` no: con una sola columna
    // descriptiva, dársela al campo opcional dejaba el archivo sin nada que publicar.
    expect(r.mapping.oficial.nombre_publicado).not.toBeNull();
    expect(r.mapping.oficial.descripcion).toBeNull();
  });

  it('saca la marca y la categoría de adentro del nombre del repuesto', () => {
    const r = leerComoElPanel('01-lista-dos-columnas', {
      deducirDelNombre: true,
      defaults: { stock: '1', tipo_precio: 'SOLO_COTIZAR' },
    });
    // "PASTILLA FRENO DEL. TOYOTA COROLLA 2014-2018 BOSCH" nombra dos marcas del catálogo;
    // Toyota también es marca de vehículo, así que gana la que sólo puede ser del repuesto.
    expect(valorEn(r.oficial, 1, 'marca_repuesto')).toBe('Bosch');
    expect(valorEn(r.oficial, 1, 'categoria')).toBe('Frenos');
    expect(valorEn(r.oficial, 2, 'marca_repuesto')).toBe('Mann');
    expect(valorEn(r.oficial, 2, 'categoria')).toBe('Filtros');
    expect(r.revision.publicables).toBe(2);
  });

  it('lo que no reconoce en el nombre lo deja vacío, no lo inventa', () => {
    const r = leerComoElPanel('01-lista-dos-columnas', {
      deducirDelNombre: true,
      defaults: { stock: '1', tipo_precio: 'SOLO_COTIZAR' },
    });
    // "AMORTIGUADOR TRAS. NISSAN V16 1995-2008 MONROE" no nombra ninguna categoría del
    // catálogo: la marca sale, la categoría queda para que el vendedor la complete.
    expect(valorEn(r.oficial, 3, 'marca_repuesto')).toBe('Monroe');
    expect(valorEn(r.oficial, 3, 'categoria')).toBe('');
    expect(r.revision.conError).toBe(1);
  });

  it('el valor fijo llena las filas que la deducción no alcanzó', () => {
    const r = leerComoElPanel('01-lista-dos-columnas', {
      deducirDelNombre: true,
      defaults: { stock: '1', tipo_precio: 'SOLO_COTIZAR', categoria: 'Suspensión' },
    });
    // El valor fijo entra sólo donde no hubo dato: no pisa las categorías reconocidas.
    expect(valorEn(r.oficial, 1, 'categoria')).toBe('Frenos');
    expect(valorEn(r.oficial, 3, 'categoria')).toBe('Suspensión');
    expect(r.revision.publicables).toBe(3);
  });

  it('usa la fila de título como categoría de los repuestos que vienen debajo', () => {
    const r = leerComoElPanel('07-categoria-como-banda', { usarBandasComoCategoria: true });
    expect(r.oficial.length - 1).toBe(3);
    // El título va escrito como en la lista impresa ("FRENOS") y sale con el nombre del
    // catálogo: el backend ignora mayúsculas pero no tildes.
    expect(valorEn(r.oficial, 1, 'categoria')).toBe('Frenos');
    expect(valorEn(r.oficial, 3, 'categoria')).toBe('Filtros');
    expect(r.revision.publicables).toBe(3);
    expect(r.revision.conError).toBe(0);
  });

  it('el número de fila sigue apuntando al Excel del vendedor después de sacar filas', () => {
    const r = leerComoElPanel('05-subtotales', { quitarFilasDeTotales: true });
    // En la hoja, los tres repuestos están en las filas 2, 3 y 7: entre medio hay un
    // subtotal, una fila vacía y los títulos repetidos. Si el número se calculara sobre el
    // archivo ya generado dirían 2, 3 y 4, y el vendedor iría a mirar el subtotal.
    expect(r.revision.filas.map((f) => f.numeroFila)).toEqual([2, 3, 7]);
  });

  it('el número de fila aguanta que una fila se separe en varios vehículos', () => {
    const r = leerComoElPanel('09-varios-autos-por-celda', { separarAplicaciones: true });
    // Las tres compatibilidades del primer repuesto salen todas de la fila 2.
    expect(r.revision.filas.map((f) => f.numeroFila)).toEqual([2, 2, 2, 3, 3]);
  });

  it('deja fuera los subtotales y los títulos repetidos a mitad de tabla', () => {
    const crudo = leerComoElPanel('05-subtotales');
    // Seis filas de datos, de las que sólo tres son repuestos.
    expect(crudo.rows.length).toBe(6);

    const r = leerComoElPanel('05-subtotales', { quitarFilasDeTotales: true });
    expect(r.oficial.length - 1).toBe(3);
    expect(r.revision.publicables).toBe(3);
    expect(r.revision.conError).toBe(0);
  });

  it('agrupa por categoría lo que falta completar, de lo que más pesa a lo que menos', () => {
    const r = leerComoElPanel('11-sin-subcategoria');
    expect(r.porCompletar).toHaveLength(1);
    expect(r.porCompletar[0].columna).toBe('subcategoria');
    // Seis repuestos sin subcategoría: tres de frenos, dos de filtros y uno de suspensión.
    expect(r.porCompletar[0].grupos).toEqual([
      { clave: 'Frenos', filas: 3, elegido: '' },
      { clave: 'Filtros', filas: 2, elegido: '' },
      { clave: 'Suspensión', filas: 1, elegido: '' },
    ]);
  });

  it('el grupo sigue en la lista después de completarlo, con lo que se eligió', () => {
    // Si se contara sobre el archivo terminado, el grupo desaparecería apenas se completa
    // y el vendedor no podría ver ni cambiar lo que eligió.
    const r = leerComoElPanel('11-sin-subcategoria', {
      completar: { subcategoria: { Frenos: 'Pastillas' } },
    });
    const frenos = r.porCompletar[0].grupos.find((g) => g.clave === 'Frenos');
    expect(frenos).toEqual({ clave: 'Frenos', filas: 3, elegido: 'Pastillas' });
  });

  it('no propone nada cuando ni siquiera se sabe la categoría', () => {
    // Sin categoría no hay lista de subcategorías que ofrecer, y preguntar sin opciones
    // no ayuda a nadie: esas filas no se cuentan.
    expect(leerComoElPanel('01-lista-dos-columnas').porCompletar).toEqual([]);
  });

  it('completa la subcategoría por grupo, cada categoría con la suya', () => {
    const r = leerComoElPanel('11-sin-subcategoria', {
      completar: { subcategoria: { Frenos: 'Pastillas', Filtros: 'Filtro de aceite' } },
    });
    expect(valorEn(r.oficial, 1, 'subcategoria')).toBe('Pastillas');
    expect(valorEn(r.oficial, 4, 'subcategoria')).toBe('Filtro de aceite');
    // Suspensión queda sin subcategoría, que es opcional: se publica igual.
    expect(valorEn(r.oficial, 6, 'subcategoria')).toBe('');
    expect(r.revision.publicables).toBe(6);
  });

  it('no pisa la subcategoría que el archivo ya traía', () => {
    const r = leerComoElPanel('11-sin-subcategoria', {
      defaults: { subcategoria: 'Discos' },
      completar: { subcategoria: { Frenos: 'Pastillas' } },
    });
    // Lo completado por grupo es más específico que el valor fijo para todas las filas.
    expect(valorEn(r.oficial, 1, 'subcategoria')).toBe('Pastillas');
    expect(valorEn(r.oficial, 4, 'subcategoria')).toBe('Discos');
  });

  it('reconoce los encabezados abreviados a mano', () => {
    const r = leerComoElPanel('02-nombres-raros');
    // "Cod. Art.", "Detalle", "Mca.", "P.U.", "Exist." y "Rubro": las seis.
    expect(r.faltanEnElPaso2).toEqual([]);
    expect(r.revision.publicables).toBe(2);
  });

  it('"Detalle" es el nombre del repuesto, salvo que la planilla traiga además un nombre', () => {
    // Sin columna de nombre, el detalle es lo único que describe al repuesto.
    expect(leerComoElPanel('02-nombres-raros').mapping.oficial.nombre_publicado).not.toBeNull();
    // Con las dos, cada una va a su campo y no se las quita la que aparezca antes.
    const cols = [
      { id: '0', rawHeader: 'Detalle', displayHeader: 'Detalle', index: 0 },
      { id: '1', rawHeader: 'Nombre', displayHeader: 'Nombre', index: 1 },
    ];
    const m = autoDetectMapping(cols, PLANTILLA_CAMPOS);
    expect(m.oficial.nombre_publicado).toBe('1');
    expect(m.oficial.descripcion).toBe('0');
  });

  it('entiende el número con su unidad al lado y el precio escrito en palabras', () => {
    const r = leerComoElPanel('03-precios-sucios');
    expect(valorEn(r.oficial, 3, 'precio')).toBe('45000');
    expect(valorEn(r.oficial, 3, 'stock')).toBe('3');
    // "CONSULTAR" no es un precio roto: es el tipo de precio en la columna equivocada.
    expect(valorEn(r.oficial, 4, 'tipo_precio')).toBe('SOLO_COTIZAR');
    expect(valorEn(r.oficial, 4, 'precio')).toBe('');
    // De 1 publicable a 3; lo que queda ("SIN STOCK", stock vacío) no se puede inventar.
    expect(r.revision.publicables).toBe(3);
  });

  it('la coma de miles no se lee como decimal', () => {
    const r = leerComoElPanel('03-precios-sucios');
    // "6,990" son 6.990 pesos, no 6,99: publicarlo como 6.99 era el peor error del caso.
    expect(valorEn(r.oficial, 2, 'precio')).toBe('6990');
  });

  it('entiende el precio con signo peso, con miles y con decimales', () => {
    const r = leerComoElPanel('03-precios-sucios');
    // "$24.990", "6,990" y "1.234,50" pasan; el problema es el sufijo, no el formato.
    expect(r.revision.filas[0].problemas).toEqual([]);
    expect(valorEn(r.oficial, 1, 'precio')).toBe('24990');
  });
});

describe('archivos crudos: lo que todavía falla', () => {
  it('GAP: con dos tablas apiladas sólo se lee la primera, pero ahora se avisa', () => {
    const r = leerComoElPanel('06-dos-tablas');
    // Sigue leyéndose mal —la segunda tabla tiene otras columnas y no hay forma de
    // encajarlas—, pero el paso 2 lo dice en vez de dejar que el vendedor lo descubra.
    const encabezado: string[] = [];
    for (const c of r.cols) encabezado[c.index] = c.rawHeader;
    const segunda = detectarSegundaTabla(r.rows, encabezado);
    expect(segunda?.titulos).toEqual(['codigo', 'producto', 'valor', 'cantidad', 'observacion']);
    expect(r.cols.length).toBe(4);
    expect(r.revision.publicables).toBe(0);
  });

  it('GAP: al archivo pesimista sólo le queda faltando la categoría', () => {
    const r = leerComoElPanel('10-todo-junto', { quitarFilasDeTotales: true });
    expect(r.filaEncabezados).toBe(2);
    // Los encabezados abreviados ya se reconocen y el subtotal queda fuera; la categoría
    // no está en ninguna columna ni en el nombre, y "sin stock" no es un número.
    expect(r.faltanEnElPaso2).toEqual(['categoria']);
    expect(r.oficial.length - 1).toBe(2);
    expect(r.revision.publicables).toBe(0);
  });
});

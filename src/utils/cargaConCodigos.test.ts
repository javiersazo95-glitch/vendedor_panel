import { describe, expect, it } from 'vitest';
import {
  aoaDesdeTexto, construirExcelConCodigos, construirFilasPlantilla, enteroDe, guardarLista, leerFilasDeCodigos, leerLista, marcarPublicada, skusDe, type FilaArmada, type FilaCodigo,
} from './cargaConCodigos';
import { detectarPlantilla, compatibilidadesDePlantilla } from './detectarPlantilla';
import { descripcionPropuesta, gruposSeguros, nombrePropuesto, type FichaCodigo, type ItemLote } from './fichaCodigoApi';
import { ESQUEMA_FALLBACK, leerLibro } from './plantillaMapping';

const ficha: FichaCodigo = {
  fichaId: 1, codigo: 'GDB 3424', marca: 'Trw', nombre: 'Juego de pastillas de freno, freno de disco', confianza: 'ALTA', verificada: false,
  categoria: 'Frenos', subcategoria: 'Pastillas de Freno', categoriaExterna: null, referenciaOem: '04465-02220',
  compatibilidad: {
    grupos: [
      { marca: 'Toyota', modelo: 'Corolla', anioDesde: 2009, anioHasta: 2014, motor: '1.6', vehiculoCatalogoIds: [], versiones: [], segura: true },
      { marca: 'Toyota', modelo: 'Yaris', anioDesde: 2011, anioHasta: 2017, motor: '1.5', vehiculoCatalogoIds: [], versiones: [], segura: true },
      { marca: 'Toyota', modelo: 'Auris', anioDesde: 2008, anioHasta: 2012, motor: '', vehiculoCatalogoIds: [], versiones: [], segura: false },
      { marca: 'Chevrolet', modelo: 'Sail', anioDesde: null, anioHasta: null, motor: '1.4', vehiculoCatalogoIds: [], versiones: [], segura: true },
    ],
    fueraDeCatalogo: [],
  },
};
const fila = (extra: Partial<FilaCodigo> = {}): FilaCodigo => ({ codigo: 'GDB3424', marca: 'TRW', precio: 32990, stock: 6, sku: '', condicion: '', garantia: '', ...extra });
const armada = (extra: Partial<FilaArmada> = {}): FilaArmada => ({
  fila: fila(), item: { id: 1, orden: 0, codigo: 'GDB3424', marca: null, estado: 'RECONOCIDO', opciones: [], ficha } as ItemLote,
  precio: 32990, stock: 6, categoria: 'Frenos', subcategoria: 'Pastillas de Freno', grupos: gruposSeguros(ficha), ...extra,
});

describe('leer la lista de códigos', () => {
  it('encuentra los títulos aunque no estén en la primera fila y en otro orden', () => {
    const r = leerFilasDeCodigos([['Lista de precios noviembre'], [], ['Stock', 'Código Fabricante', 'PRECIO VENTA', 'Marca'], [6, 'GDB3424', '$ 32.990', 'TRW'], ['', '', '', ''], [2, '', 1000, 'X']]);
    expect(r.conTitulos).toBe(true);
    expect(r.filas).toEqual([fila()]);
    expect(r.sinCodigo).toBe(1);
  });

  it('sin títulos toma código, marca, precio y stock', () => {
    expect(leerFilasDeCodigos(aoaDesdeTexto('GDB3424\tTRW\t32990\t6')).filas).toEqual([fila()]);
    expect(leerFilasDeCodigos(aoaDesdeTexto('GDB3424; TRW; 32990; 6')).filas).toEqual([fila()]);
    expect(leerFilasDeCodigos(aoaDesdeTexto('GDB3424')).filas[0]).toMatchObject({ codigo: 'GDB3424', precio: null, stock: null });
  });

  it('el mismo código escrito distinto es uno solo; de otra marca son dos', () => {
    const r = leerFilasDeCodigos([['codigo', 'marca'], ['gdb-3424', 'TRW'], ['GDB 3424', 'trw'], ['GDB3424', 'Otra']]);
    expect(r.filas).toHaveLength(2);
    expect(r.repetidas).toBe(1);
  });

  it('un precio dudoso no se adivina', () => {
    expect([enteroDe('$32.990'), enteroDe('1.234.567'), enteroDe(15990), enteroDe('15990,0')]).toEqual([32990, 1234567, 15990, 15990]);
    expect([enteroDe('15990,5'), enteroDe('consultar'), enteroDe(''), enteroDe('-5')]).toEqual([null, null, null, null]);
  });
});

describe('del código al Excel de la plantilla', () => {
  it('una fila por repuesto y el resto de los vehículos en su hoja', () => {
    const { inventario, compatibilidades } = construirFilasPlantilla([armada()], ESQUEMA_FALLBACK, { condicion: 'ALTERNATIVO', garantia: '1 año' });
    const col = (k: string) => inventario[1][inventario[0].indexOf(k)];
    expect(col('sku_proveedor')).toBe('GDB3424');
    expect(col('codigo_fabricante')).toBe('GDB 3424');
    expect([col('categoria'), col('subcategoria'), col('condicion'), col('garantia'), col('precio'), col('stock')])
      .toEqual(['Frenos', 'Pastillas de Freno', 'ALTERNATIVO', '1 año', 32990, 6]);
    expect([col('compatibilidad_modelo'), col('anio_desde'), col('anio_hasta'), col('motor')]).toEqual(['Corolla', 2009, 2014, '1.6']);
    // Los que no se confirmaron o no traen años no entran solos.
    expect(compatibilidades.slice(1)).toEqual([['GDB3424', 'Toyota', 'Yaris', 2011, 2017, '1.5', '04465-02220']]);
  });

  it('lo que trae la lista manda sobre lo general, y lo que falta queda vacío para completarlo', () => {
    const { inventario } = construirFilasPlantilla([armada({
      fila: fila({ condicion: 'ORIGINAL', garantia: '2 años', sku: 'mi sku 1' }), precio: null, grupos: [], categoria: '', subcategoria: '',
    })], ESQUEMA_FALLBACK, { condicion: 'ALTERNATIVO', garantia: '1 año' });
    const col = (k: string) => inventario[1][inventario[0].indexOf(k)];
    expect([col('condicion'), col('garantia'), col('sku_proveedor'), col('precio'), col('categoria'), col('compatibilidad_marca')])
      .toEqual(['ORIGINAL', '2 años', 'MISKU1', '', '', '']);
  });

  it('dos marcas con el mismo código no chocan en el SKU', () => {
    const otra = armada({ item: { ...armada().item, ficha: { ...ficha, marca: 'Otra Demo' } } });
    expect(skusDe([armada(), otra, armada()])).toEqual(['GDB3424', 'GDB3424-OTRADEMO', 'GDB3424-TRW']);
  });

  it('el asistente reconoce el archivo como la plantilla, también sin vehículos extra', async () => {
    const file = await construirExcelConCodigos([armada({ grupos: [] })], ESQUEMA_FALLBACK, { condicion: 'ORIGINAL', garantia: '1 año' }, 'codigos.xlsx');
    const libro = await leerLibro(file);
    expect(detectarPlantilla(libro, ESQUEMA_FALLBACK)).toEqual({ hojaIndex: 0, version: ESQUEMA_FALLBACK.version });
    expect(compatibilidadesDePlantilla(libro)).toEqual([]);
  });

  it('una plantilla 2.4.0, sin la columna del código, sigue siendo la plantilla', () => {
    const anteriores = ESQUEMA_FALLBACK.columnas.filter((c) => c !== 'codigo_fabricante');
    const hoja = (nombre: string, aoa: unknown[][]) => ({ nombre, aoa, filasConDatos: aoa.length });
    const libro = [hoja('inventario', [anteriores]), hoja('compatibilidades', [ESQUEMA_FALLBACK.hojaCompatibilidadesColumnas]), hoja('instrucciones', [['VERSION_PLANTILLA: 2.4.0']])];
    expect(detectarPlantilla(libro, ESQUEMA_FALLBACK)).toEqual({ hojaIndex: 0, version: '2.4.0' });
    const sinGarantia = [hoja('inventario', [anteriores.slice(0, -1)]), ...libro.slice(1)];
    expect(detectarPlantilla(sinGarantia, ESQUEMA_FALLBACK)).toBeNull();
  });
});

describe('la lista en curso', () => {
  const lista = { loteId: 'l1', filas: [fila(), fila({ codigo: 'OTRO1' })], ajustes: {}, condicion: 'ORIGINAL', garantia: '1 año' };

  it('lo publicado sale de la lista y lo pendiente queda para después', () => {
    guardarLista('1', { ...lista, enviadas: [0] });
    marcarPublicada('1');
    expect(leerLista('1')).toMatchObject({ loteId: 'l1', ajustes: { 0: { fuera: true } } });
    expect(leerLista('1')?.enviadas).toBeUndefined();
    expect(leerLista('2')).toBeNull();
  });

  it('si se publicó todo, se olvida; sin haber enviado nada, no cambia', () => {
    guardarLista('1', lista);
    marcarPublicada('1');
    expect(leerLista('1')?.ajustes).toEqual({});
    guardarLista('1', { ...lista, enviadas: [0, 1] });
    marcarPublicada('1');
    expect(leerLista('1')).toBeNull();
  });
});

describe('textos propuestos', () => {
  it('título corto y descripción sólo con lo confirmado', () => {
    expect(nombrePropuesto(ficha)).toBe('Juego de pastillas de freno Trw GDB 3424');
    expect(nombrePropuesto(ficha, 30)).toBe('Juego de pastillas de freno');
    const texto = descripcionPropuesta(ficha, gruposSeguros(ficha));
    expect(texto).toContain('Toyota Corolla, Toyota Yaris');
    expect(texto).not.toContain('Auris');
    expect(texto.length).toBeGreaterThan(15);
  });
});

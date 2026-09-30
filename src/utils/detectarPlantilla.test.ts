import { describe, expect, it } from 'vitest';
import { compatibilidadesDePlantilla, detectarPlantilla, mapeoDePlantilla, sinFilaDeEjemplo } from './detectarPlantilla';
import { camposDesdeEsquema, columnasDeHoja, ESQUEMA_FALLBACK, type HojaUsuario } from './plantillaMapping';

/**
 * La carga con Excel es una sola: si el archivo es la plantilla de RepuesTop se salta "Relaciona".
 * Un Excel propio con títulos parecidos no puede pasar por plantilla.
 */
const hoja = (nombre: string, aoa: unknown[][]): HojaUsuario => ({ nombre, aoa, filasConDatos: aoa.length });
const COLUMNAS = ESQUEMA_FALLBACK.columnas;
const fila = (valores: Record<string, unknown>) => COLUMNAS.map((c) => valores[c] ?? '');

const plantilla = (extra: HojaUsuario[] = []) => [
  hoja('inventario', [
    [...COLUMNAS],
    fila({ nombre_publicado: 'Filtro de aceite Toyota Yaris', sku_proveedor: 'SKU-001', categoria: 'Filtros' }),
    fila({ nombre_publicado: 'Pastilla freno', sku_proveedor: 'PF-1', categoria: 'Frenos' }),
  ]),
  hoja('compatibilidades', [
    ['sku_proveedor', 'compatibilidad_marca', 'compatibilidad_modelo', 'anio_desde', 'anio_hasta', 'motor', 'referencia_oem'],
    ['SKU-001', 'Toyota', 'Yaris', 2011, 2013, '1.3', ''],
    ['PF-1', 'Nissan', 'Tiida', 2008, 2012, '', 'OEM-9'],
  ]),
  hoja('instrucciones', [['VERSION_PLANTILLA: 2.3.0'], ['Campos obligatorios: …']]),
  ...extra,
];

describe('detectarPlantilla', () => {
  it('reconoce la plantilla descargada, en su hoja "inventario" y con su versión', () => {
    expect(detectarPlantilla(plantilla(), ESQUEMA_FALLBACK)).toEqual({ hojaIndex: 0, version: '2.3.0' });
  });

  it('acepta sus hojas ocultas de listas', () => {
    const conListas = plantilla([hoja('Listas', [['Frenos']]), hoja('Versiones', [['Toyota|Yaris', 2, '2015']]), hoja('Motores', [])]);
    expect(detectarPlantilla(conListas, ESQUEMA_FALLBACK)).toEqual({ hojaIndex: 0, version: '2.3.0' });
  });

  it('si no es exactamente la plantilla, es un Excel propio (prueba del 30-sep)', () => {
    const [inventario, compat, instrucciones] = plantilla();
    const sinColumna = hoja('inventario', inventario.aoa.map((f) => (f as unknown[]).filter((_, i) => COLUMNAS[i] !== 'requiere_chasis')));
    const conColumnaDeMas = hoja('inventario', inventario.aoa.map((f, i) => [...(f as unknown[]), i === 0 ? 'mis notas' : '']));
    const desordenada = hoja('inventario', [[...COLUMNAS].reverse()]);
    const compatVieja = hoja('compatibilidades', [compat.aoa[0].slice(0, 6) as unknown[]]);
    const casos: Record<string, HojaUsuario[]> = {
      'le falta una columna': [sinColumna, compat, instrucciones],
      'tiene una columna de más': [conColumnaDeMas, compat, instrucciones],
      'las columnas en otro orden': [desordenada, compat, instrucciones],
      'compatibilidades sin la columna de OEM (plantilla 2.0)': [inventario, compatVieja, instrucciones],
      'otra hoja agregada': [inventario, compat, instrucciones, hoja('Mis precios', [['x']])],
      'sin la hoja de compatibilidades': [inventario, instrucciones],
      'sin versión': [inventario, compat, hoja('instrucciones', [['Campos obligatorios: …']])],
      'versión 1.x': [inventario, compat, hoja('instrucciones', [['VERSION_PLANTILLA: 1.4.0']])],
      'guardada como CSV': [hoja('Sheet1', inventario.aoa)],
    };
    for (const [caso, hojas] of Object.entries(casos)) {
      expect(detectarPlantilla(hojas, ESQUEMA_FALLBACK), caso).toBeNull();
    }
  });

  it('cada columna de la plantilla se relaciona consigo misma y las demás no se cargan', () => {
    const { cols } = columnasDeHoja([[...COLUMNAS, '_ayuda']], 0);
    const mapping = mapeoDePlantilla(cols, camposDesdeEsquema(ESQUEMA_FALLBACK));
    expect(mapping.oficial.sku_proveedor).toBe(String(COLUMNAS.indexOf('sku_proveedor')));
    expect(mapping.oficial.motor).toBe(String(COLUMNAS.indexOf('motor')));
    expect(mapping.extras).toEqual({ [String(COLUMNAS.length)]: 'ignore' });
  });

  it('los vehículos de la hoja "compatibilidades" se cargan, sin los de la fila de ejemplo', () => {
    expect(compatibilidadesDePlantilla(plantilla())).toEqual([{
      sku_proveedor: 'PF-1', compatibilidad_marca: 'Nissan', compatibilidad_modelo: 'Tiida',
      anio_desde: '2008', anio_hasta: '2012', motor: '', referencia_oem: 'OEM-9',
    }]);
  });

  it('la fila de ejemplo no se carga y las demás conservan su número de fila', () => {
    const { cols, rows, filasOriginales } = columnasDeHoja(plantilla()[0].aoa, 0);
    const limpio = sinFilaDeEjemplo(cols, rows, filasOriginales);
    expect(limpio.quitadas).toBe(1);
    expect(limpio.rows).toHaveLength(1);
    expect(limpio.filasOriginales).toEqual([2]);
  });
});

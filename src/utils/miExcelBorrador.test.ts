import { describe, expect, it } from 'vitest';
import {
  ESTADO_VACIO,
  deserializarBorrador,
  fotosAsignadas,
  serializarBorrador,
  type EstadoBorrador,
} from './miExcelBorrador';

/** El progreso guardado de "Mi propio Excel" tiene que volver tal cual se guardó. */
describe('Borrador de "Mi propio Excel"', () => {
  const estado: EstadoBorrador = {
    ...ESTADO_VACIO,
    paso: 3,
    archivo: { nombre: 'inventario.xlsx', sha256: 'abc', hojaIndex: 1, filaEncabezados: 2, recortado: false, filas: 450 },
    mapping: { oficial: { sku_proveedor: '0' }, extras: { 3: 'ignore' }, valueMap: {}, parches: { 4: { categoria: 'Frenos' } } },
    opcionalesVacios: ['motor'],
    fotos: { asignaciones: { 0: ['pf-1.jpg', 'pf-1_2.jpg'], 5: ['pf-1.jpg'] }, origen: 'carpeta', totalDisponibles: 900 },
    vistaPaso4: 'lista',
  };

  it('se guarda y se recupera sin perder nada', () => {
    expect(deserializarBorrador(serializarBorrador(estado))).toEqual(estado);
  });

  it('un JSON roto o de otra versión no rompe el asistente', () => {
    expect(deserializarBorrador('{no es json')).toBeNull();
    expect(deserializarBorrador(JSON.stringify({ v: 99 }))).toBeNull();
  });

  it('no deja más de 4 fotos por repuesto ni pasos fuera de rango', () => {
    const raro = { ...estado, paso: 9, fotos: { ...estado.fotos, asignaciones: { 0: ['a', 'b', 'c', 'd', 'e'] } } };
    const leido = deserializarBorrador(JSON.stringify(raro));
    expect(leido?.paso).toBe(1);
    expect(leido?.fotos.asignaciones[0]).toHaveLength(4);
  });

  it('las fotos que se guardan son sólo las asignadas, sin repetir', () => {
    expect(fotosAsignadas(estado.fotos.asignaciones).sort()).toEqual(['pf-1.jpg', 'pf-1_2.jpg']);
  });
});

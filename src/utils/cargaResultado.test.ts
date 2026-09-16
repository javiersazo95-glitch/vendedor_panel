import { describe, expect, it } from 'vitest';
import { ordenarFilasPorEstado } from './cargaResultado';

const fila = (n: number, estado: 'OK' | 'ADVERTENCIA' | 'ERROR') => ({ fila: n, estado, sku: `SKU-${n}` });

describe('ordenarFilasPorEstado', () => {
  it('pone adelante lo que pide atención: primero los errores, después las advertencias', () => {
    const ordenadas = ordenarFilasPorEstado([
      fila(1, 'OK'), fila(2, 'ADVERTENCIA'), fila(3, 'OK'), fila(4, 'ERROR'),
    ]);
    expect(ordenadas.map((f) => f.fila)).toEqual([4, 2, 1, 3]);
  });

  it('dentro de cada grupo mantiene el orden del archivo', () => {
    // El número de fila tiene que seguir sirviendo para buscar en el Excel del vendedor.
    const ordenadas = ordenarFilasPorEstado([
      fila(30, 'ADVERTENCIA'), fila(10, 'ADVERTENCIA'), fila(20, 'ADVERTENCIA'),
    ]);
    expect(ordenadas.map((f) => f.fila)).toEqual([10, 20, 30]);
  });

  it('no toca el arreglo que recibe', () => {
    const original = [fila(1, 'OK'), fila(2, 'ERROR')];
    const ordenadas = ordenarFilasPorEstado(original);
    expect(original.map((f) => f.fila)).toEqual([1, 2]);
    expect(ordenadas.map((f) => f.fila)).toEqual([2, 1]);
  });

  it('el caso real: 106 advertencias perdidas entre 2.000 filas quedan arriba', () => {
    const filas = Array.from({ length: 2000 }, (_, i) =>
      fila(i + 1, i % 19 === 0 ? 'ADVERTENCIA' : 'OK'));
    const conAdvertencia = filas.filter((f) => f.estado === 'ADVERTENCIA').length;

    const ordenadas = ordenarFilasPorEstado(filas);

    expect(ordenadas.slice(0, conAdvertencia).every((f) => f.estado === 'ADVERTENCIA')).toBe(true);
    expect(ordenadas[conAdvertencia].estado).toBe('OK');
  });
});

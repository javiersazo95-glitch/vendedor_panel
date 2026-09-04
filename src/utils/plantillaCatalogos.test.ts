import { describe, expect, it } from 'vitest';

import {
  buscarEnCatalogo,
  contarValoresDeColumna,
  decisionesDeCatalogo,
  parecido,
  sugerirDelCatalogo,
  todasLasSubcategorias,
} from './plantillaCatalogos';

const CATEGORIAS = ['Frenos', 'Filtros', 'Suspensión', 'Dirección', 'Motor', 'Refrigeración'];
const MARCAS = ['Bosch', 'Brembo', 'Gates', 'NGK', 'Mann Filter'];

describe('buscarEnCatalogo', () => {
  it('ignora mayúsculas y acentos, que es como se escribe en la práctica', () => {
    expect(buscarEnCatalogo('frenos', CATEGORIAS)).toBe('Frenos');
    expect(buscarEnCatalogo('SUSPENSION', CATEGORIAS)).toBe('Suspensión');
    expect(buscarEnCatalogo('direccion', CATEGORIAS)).toBe('Dirección');
  });

  it('devuelve null cuando el valor no está', () => {
    expect(buscarEnCatalogo('Frenos delanteros', CATEGORIAS)).toBeNull();
    expect(buscarEnCatalogo('', CATEGORIAS)).toBeNull();
  });
});

describe('sugerirDelCatalogo', () => {
  it('propone la familia correcta cuando el vendedor escribe de más', () => {
    expect(sugerirDelCatalogo('Frenos delanteros', CATEGORIAS)[0]).toBe('Frenos');
    expect(sugerirDelCatalogo('Sistema de frenos', CATEGORIAS)[0]).toBe('Frenos');
  });

  it('atrapa los errores de tipeo', () => {
    expect(sugerirDelCatalogo('Bosh', MARCAS)[0]).toBe('Bosch');
    expect(sugerirDelCatalogo('Brenbo', MARCAS)[0]).toBe('Brembo');
  });

  it('no sugiere nada cuando no se parece a nada: una sugerencia mala es ruido', () => {
    expect(sugerirDelCatalogo('Accesorios de camping', CATEGORIAS)).toEqual([]);
  });

  it('la coincidencia exacta vale más que cualquier otra', () => {
    expect(parecido('Frenos', 'Frenos')).toBe(1);
    expect(parecido('Frenos', 'Motor')).toBeLessThan(0.55);
  });
});

describe('contarValoresDeColumna', () => {
  it('cuenta cada valor distinto y los ordena por frecuencia', () => {
    const rows = [['Frenos'], ['frenos delanteros'], ['Frenos'], [''], ['Frenos'], ['Filtros']];
    expect(contarValoresDeColumna(rows, 0)).toEqual([
      { valor: 'Frenos', filas: 3 },
      { valor: 'frenos delanteros', filas: 1 },
      { valor: 'Filtros', filas: 1 },
    ]);
  });
});

describe('decisionesDeCatalogo', () => {
  it('sólo pregunta por lo que no está en el catálogo, empezando por lo más frecuente', () => {
    const valores = [
      { valor: 'Frenos', filas: 50 },
      { valor: 'Frenos delanteros', filas: 43 },
      { valor: 'Amortiguacion', filas: 7 },
    ];
    const decisiones = decisionesDeCatalogo(valores, CATEGORIAS);
    expect(decisiones.map((d) => d.valor)).toEqual(['Frenos delanteros', 'Amortiguacion']);
    expect(decisiones[0]).toMatchObject({ filas: 43, sugerencias: ['Frenos'] });
  });

  it('sin catálogo no hay nada que decidir: el esquema pudo no responder', () => {
    expect(decisionesDeCatalogo([{ valor: 'Lo que sea', filas: 1 }], [])).toEqual([]);
  });
});

describe('todasLasSubcategorias', () => {
  it('junta las de todas las categorías, sin repetir', () => {
    expect(todasLasSubcategorias({ Frenos: ['Pastillas', 'Discos'], Motor: ['Pistones', 'Discos'] }))
      .toEqual(['Discos', 'Pastillas', 'Pistones']);
  });
});

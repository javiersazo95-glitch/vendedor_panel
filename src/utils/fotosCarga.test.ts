import { describe, expect, it } from 'vitest';
import { asignarPorCodigo, extractFolderImages, matchesSku } from './fotosCarga';

describe('Fotos de la carga masiva', () => {
  it('reconoce la foto por el código del repuesto, con o sin sufijo', () => {
    expect(matchesSku('pf-100.jpg', 'PF-100')).toBe(true);
    expect(matchesSku('pf-100_2.jpg', 'PF-100')).toBe(true);
    expect(matchesSku('pf-100-3.png', 'PF-100')).toBe(true);
    expect(matchesSku('pf-1000.jpg', 'PF-100')).toBe(false);
    expect(matchesSku('cualquier.jpg', '')).toBe(false);
  });

  it('asigna por clave de fila, hasta 4 fotos, y lo declarado en el Excel manda', () => {
    const fotos = ['a1.jpg', 'a1_2.jpg', 'a1_3.jpg', 'a1_4.jpg', 'a1_5.jpg', 'b2.jpg', 'foto-rara.jpg'];
    const asignadas = asignarPorCodigo(
      [{ clave: '0', sku: 'A1' }, { clave: '1', sku: 'B2' }, { clave: '2', sku: 'C3' }],
      fotos,
      { B2: ['C:/fotos/FOTO-RARA.jpg'] },
    );
    expect(asignadas['0']).toHaveLength(4);
    expect(asignadas['1']).toEqual(['foto-rara.jpg']);
    expect(asignadas['2']).toBeUndefined();
  });

  it('de una carpeta sólo toma imágenes', () => {
    const archivos = [new File(['x'], 'A1.JPG'), new File(['x'], 'lista.xlsx'), new File(['x'], 'b2.webp')];
    expect(Object.keys(extractFolderImages(archivos)).sort()).toEqual(['a1.jpg', 'b2.webp']);
  });
});

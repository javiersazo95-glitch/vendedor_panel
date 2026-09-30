import { afterEach, describe, expect, it, vi } from 'vitest';
import { asignarPorCodigo, extractFolderImages, matchesSku, subirFotosAProductos } from './fotosCarga';

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

/**
 * Prueba en local del 30-sep: 5 de 7 fotos de una carga fallaban con 413 "El archivo supera el
 * tamaño máximo permitido". Cada id de versión iba en su propia parte del multipart y un auto con
 * muchas versiones pasaba el tope de 50 partes de Tomcat.
 */
describe('subirFotosAProductos', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('manda los vehículos en un solo campo, aunque sean muchos', async () => {
    const ids = Array.from({ length: 66 }, (_, i) => 1000 + i);
    const cuerpos: FormData[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/editar')) {
        cuerpos.push(init?.body as FormData);
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ skuProveedor: 'T30-005', nombrePublicado: 'Radiador', vehiculoCatalogoIds: ids }), { status: 200 });
    }));

    const [resultado] = await subirFotosAProductos({
      sellerId: '1', token: 't', productos: [{ clave: 'f5', sku: 'T30-005', productoId: 8082 }],
      asignaciones: { f5: ['T30-005.jpg'] }, obtenerImagen: () => new Blob(['x'], { type: 'image/jpeg' }),
    });

    expect(resultado.ok).toBe(true);
    expect(cuerpos[0].getAll('vehiculoCatalogoIds')).toEqual([ids.join(',')]);
    expect([...cuerpos[0].keys()].length).toBeLessThan(50);
  });
});

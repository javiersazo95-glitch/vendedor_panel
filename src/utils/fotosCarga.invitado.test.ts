import { afterEach, describe, expect, it, vi } from 'vitest';
import { subirFotosAProductos } from './fotosCarga';

/**
 * Acceso asistido (17-nov): tras un Excel, soporte en modo invitado sube las fotos a /fotos (solo imágenes).
 * No puede usar /editar, que reemplaza el producto entero y el backend le rechaza.
 */
describe('subirFotosAProductos en modo invitado', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('manda solo las fotos a /fotos, sin leer ni editar el producto', async () => {
    sessionStorage.setItem('repuestop_session', JSON.stringify({
      token: 't', user: { id: 1, sellerId: 3, invitado: { accesoId: 9, estado: 'ACTIVO' } },
    }));
    const llamadas: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      llamadas.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    }));

    const [resultado] = await subirFotosAProductos({
      sellerId: '3', token: 't', productos: [{ clave: 'f2', sku: 'QA-P5-1', productoId: 701 }],
      asignaciones: { f2: ['QA-P5-1.jpg'] }, obtenerImagen: () => new Blob(['x'], { type: 'image/jpeg' }),
    });

    expect(resultado.ok).toBe(true);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toMatch(/\/inventario\/701\/fotos$/);
    expect(llamadas[0].init?.method).toBe('POST');
    const cuerpo = llamadas[0].init?.body as FormData;
    expect([...cuerpo.keys()]).toEqual(['imagenes']);
  });
});

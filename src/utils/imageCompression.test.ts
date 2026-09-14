import { describe, expect, it } from 'vitest';
import { comprimirImagen, comprimirImagenes } from './imageCompression';

// El redimensionado real usa canvas/createImageBitmap, no disponibles en jsdom (igual que
// en Repuestop_Market, que tampoco testea esa rama). Estos tests cubren las guardas que sí
// corren sin canvas: tipos que se dejan pasar tal cual, y que un error nunca pierde la foto.

describe('comprimirImagen', () => {
  it('deja pasar un GIF sin tocarlo (perdería la animación en canvas)', async () => {
    const archivo = new Blob([new Uint8Array(10)], { type: 'image/gif' });
    const resultado = await comprimirImagen(archivo, 'animacion.gif');
    expect(resultado.blob).toBe(archivo);
    expect(resultado.filename).toBe('animacion.gif');
  });

  it('deja pasar un SVG sin tocarlo (no es raster)', async () => {
    const archivo = new Blob([new Uint8Array(10)], { type: 'image/svg+xml' });
    const resultado = await comprimirImagen(archivo, 'logo.svg');
    expect(resultado.blob).toBe(archivo);
  });

  it('deja pasar un archivo que no es imagen', async () => {
    const archivo = new Blob([new Uint8Array(10)], { type: 'application/pdf' });
    const resultado = await comprimirImagen(archivo, 'documento.pdf');
    expect(resultado.blob).toBe(archivo);
    expect(resultado.filename).toBe('documento.pdf');
  });

  it('si createImageBitmap no esta disponible (o falla), devuelve el original en vez de perder la foto', async () => {
    const archivo = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
    const resultado = await comprimirImagen(archivo, 'producto.jpg');
    expect(resultado.blob).toBe(archivo);
    expect(resultado.filename).toBe('producto.jpg');
  });
});

describe('comprimirImagenes', () => {
  it('procesa varios archivos preservando el orden', async () => {
    const a = new Blob([new Uint8Array(10)], { type: 'image/gif' });
    const b = new Blob([new Uint8Array(10)], { type: 'application/pdf' });
    const resultado = await comprimirImagenes([
      { blob: a, filename: 'a.gif' },
      { blob: b, filename: 'b.pdf' },
    ]);
    expect(resultado.map((r) => r.filename)).toEqual(['a.gif', 'b.pdf']);
  });
});

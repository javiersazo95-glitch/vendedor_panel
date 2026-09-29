import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  descargarFotos,
  dominiosDeFotos,
  esNombreDeArchivoDeImagen,
  esUrlDeImagen,
  fotosPorSku,
  MOTIVO_SIN_CARGA,
  nombreDesdeUrl,
  separarFotos,
  tipoColumnaFotos,
} from './plantillaFotos';

describe('reconocer lo que trae la columna', () => {
  it('distingue enlaces de nombres de archivo', () => {
    expect(esUrlDeImagen('https://mitienda.cl/fotos/a.jpg')).toBe(true);
    expect(esUrlDeImagen('a.jpg')).toBe(false);
    expect(esNombreDeArchivoDeImagen('PF-100.JPG')).toBe(true);
    expect(esNombreDeArchivoDeImagen('sin foto')).toBe(false);
  });

  it('una celda puede traer varias fotos', () => {
    expect(separarFotos('a.jpg, b.png ; c.webp')).toEqual(['a.jpg', 'b.png', 'c.webp']);
    expect(separarFotos('sin foto')).toEqual([]);
  });

  it('decide el tipo de columna por mayoría', () => {
    expect(tipoColumnaFotos(['https://x.cl/a.jpg', 'https://x.cl/b.jpg', ''])).toBe('url');
    expect(tipoColumnaFotos(['PF-100.jpg', 'FA-200.png'])).toBe('archivo');
    expect(tipoColumnaFotos(['consultar', 'varios', 'a.jpg'])).toBeNull();
    expect(tipoColumnaFotos([])).toBeNull();
  });
});

describe('fotosPorSku', () => {
  it('junta las fotos de cada código, sin repetir y con tope', () => {
    const rows = [
      ['A-1', 'https://x.cl/1.jpg'],
      ['A-1', 'https://x.cl/2.jpg'],
      ['A-1', 'https://x.cl/1.jpg'],
      ['B-2', 'sin foto'],
    ];
    expect(fotosPorSku(rows, 1, 0)).toEqual({ 'A-1': ['https://x.cl/1.jpg', 'https://x.cl/2.jpg'] });
  });
});

describe('nombreDesdeUrl', () => {
  it('usa el nombre del enlace y numera las siguientes', () => {
    expect(nombreDesdeUrl('https://x.cl/fotos/pastilla.jpg', 'A-1', 0)).toBe('pastilla.jpg');
    expect(nombreDesdeUrl('https://x.cl/fotos/pastilla.jpg', 'A-1', 1)).toBe('pastilla_2.jpg');
  });

  it('sin nombre reconocible cae al código del repuesto', () => {
    expect(nombreDesdeUrl('https://x.cl/img?id=99', 'A-1', 0)).toBe('A-1.jpg');
  });
});

describe('descargarFotos', () => {
  // H31: las fotos se traen como <img> (la CSP del panel no permite fetch a otros sitios);
  // aca se reemplaza ese paso por uno falso para probar la logica de alrededor.
  const obtener = vi.fn<(url: string) => Promise<Blob>>();
  beforeEach(() => { obtener.mockReset(); });

  const imagen = (tipo = 'image/jpeg') => new Blob(['x'], { type: tipo });

  it('deja las fotos listas para el paso de fotos, asignadas a su repuesto', async () => {
    obtener.mockResolvedValue(imagen());
    const { archivos, asignaciones, fallidas } = await descargarFotos({ 'A-1': ['https://x.cl/a.jpg'] }, undefined, obtener);
    expect(Object.keys(archivos)).toEqual(['a.jpg']);
    expect(asignaciones).toEqual({ 'A-1': ['a.jpg'] });
    expect(fallidas).toEqual([]);
  });

  it('una foto bloqueada por el sitio no deja sin fotos al resto', async () => {
    obtener
      .mockRejectedValueOnce(new Error(MOTIVO_SIN_CARGA))
      .mockResolvedValueOnce(imagen());
    const { archivos, fallidas } = await descargarFotos(
      { 'A-1': ['https://x.cl/a.jpg'], 'B-2': ['https://x.cl/b.jpg'] }, undefined, obtener);
    expect(Object.keys(archivos)).toEqual(['b.jpg']);
    expect(fallidas).toHaveLength(1);
    expect(fallidas[0].motivo).toBe(MOTIVO_SIN_CARGA);
  });

  it('un enlace que no es imagen se reporta en vez de guardarse', async () => {
    obtener.mockResolvedValue(new Blob(['<html>'], { type: 'text/html' }));
    const { archivos, fallidas } = await descargarFotos({ 'A-1': ['https://x.cl/pagina'] }, undefined, obtener);
    expect(archivos).toEqual({});
    expect(fallidas[0].motivo).toBe('el enlace no es una imagen');
  });

  it('el nombre calza con el formato en que quedo la foto (un GIF sale como PNG)', async () => {
    obtener.mockResolvedValue(imagen('image/png'));
    const { archivos } = await descargarFotos({ 'A-1': ['https://x.cl/anima.gif'] }, undefined, obtener);
    expect(Object.keys(archivos)).toEqual(['anima.png']);
  });

  it('informa el avance, que con cien fotos es la diferencia entre esperar y no saber', async () => {
    obtener.mockResolvedValue(imagen());
    const avances: number[] = [];
    await descargarFotos({ 'A-1': ['https://x.cl/a.jpg', 'https://x.cl/b.jpg'] }, (h) => avances.push(h), obtener);
    expect(avances).toEqual([1, 2]);
  });

  it('por defecto no usa fetch: la CSP del panel lo bloquearia fuera de la API', async () => {
    const fetchMock = vi.fn();
    const cargadas: string[] = [];
    // <img> falsa que falla como lo hace un sitio sin permiso CORS.
    class ImagenSinCors {
      crossOrigin = '';
      referrerPolicy = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(valor: string) {
        if (!valor) return;
        cargadas.push(valor);
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Image', ImagenSinCors);
    try {
      const { fallidas } = await descargarFotos({ 'A-1': ['https://x.cl/a.jpg'] });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(cargadas).toEqual(['https://x.cl/a.jpg']);
      expect(fallidas).toEqual([{ sku: 'A-1', url: 'https://x.cl/a.jpg', motivo: MOTIVO_SIN_CARGA }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('dominiosDeFotos (SEC-MARKET-A35)', () => {
  it('lista los sitios de origen sin repetir, para mostrarlos antes de descargar', () => {
    expect(dominiosDeFotos({
      'SKU-1': ['https://fotos.proveedor.cl/a.jpg', 'https://fotos.proveedor.cl/b.jpg'],
      'SKU-2': ['https://cdn.otro.com/c.jpg'],
    })).toEqual(['fotos.proveedor.cl', 'cdn.otro.com']);
  });

  it('deja fuera los nombres de archivo, que no se descargan de ninguna parte', () => {
    expect(dominiosDeFotos({ 'SKU-1': ['foto-local.jpg'] })).toEqual([]);
  });

  it('hace visible un origen interno, que es el caso que justifica el aviso', () => {
    // Un Excel armado por un tercero puede apuntar a la red del propio vendedor.
    expect(dominiosDeFotos({ 'SKU-1': ['http://192.168.1.10/panel/logo.png'] }))
      .toEqual(['192.168.1.10']);
  });

  it('sin fotos declaradas no hay nada que avisar', () => {
    expect(dominiosDeFotos({})).toEqual([]);
  });
});

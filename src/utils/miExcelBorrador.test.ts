import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, saveSession } from './session';
import {
  ESTADO_VACIO,
  FotoBorradorRechazadaError,
  guardarBorrador,
  subirImagenBorrador,
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

/**
 * H33 (revisión del 30-sep): la subida de fotos del borrador comparte el tope de 120 peticiones
 * por minuto con todo el panel. Un 429 o un corte no son un rechazo de la foto.
 */
describe('subirImagenBorrador ante 429 y errores', () => {
  const foto = new Blob(['x'], { type: 'image/jpeg' });
  const respuestas = (lista: Response[]) => {
    const fetchMock = vi.fn(async () => lista.shift()!);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  beforeEach(() => {
    saveSession({ email: 'v@x.cl', role: 'vendedor', token: 'tok', sellerId: '1' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession();
  });

  it('un 429 con Retry-After espera y vuelve a intentar', async () => {
    const fetchMock = respuestas([
      new Response('', { status: 429, headers: { 'Retry-After': '2' } }),
      new Response(JSON.stringify({ id: 7, nombreArchivo: 'a.jpg' }), { status: 200 }),
    ]);
    const esperas: number[] = [];
    const guardada = await subirImagenBorrador(foto, 'a.jpg', { esperar: async (ms) => { esperas.push(ms); } });

    expect(guardada.id).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(esperas[0]).toBeGreaterThanOrEqual(2000);
  });

  it('el guardado del progreso también espera un 429 y sigue', async () => {
    const fetchMock = respuestas([
      new Response('', { status: 429, headers: { 'Retry-After': '1' } }),
      new Response(JSON.stringify({ version: 3, updatedAt: '2026-09-30T12:00:00Z' }), { status: 200 }),
    ]);
    const r = await guardarBorrador(ESTADO_VACIO, 2, { esperar: async () => {} });
    expect(r.version).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('un 400 es un rechazo definitivo de la foto', async () => {
    respuestas([new Response(JSON.stringify({ message: 'Solo JPG, PNG o WEBP' }), { status: 400 })]);
    await expect(subirImagenBorrador(foto, 'a.gif')).rejects.toBeInstanceOf(FotoBorradorRechazadaError);
  });

  it('un 500 o un 429 que no cede no la dan por rechazada', async () => {
    respuestas([new Response('', { status: 503 })]);
    const error = await subirImagenBorrador(foto, 'a.jpg').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(FotoBorradorRechazadaError);

    respuestas([new Response('', { status: 429 }), new Response('', { status: 429 })]);
    const otro = await subirImagenBorrador(foto, 'a.jpg', { intentos: 2, esperar: async () => {} }).catch((e) => e);
    expect(otro).not.toBeInstanceOf(FotoBorradorRechazadaError);
  });
});

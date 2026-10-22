import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MS, CLAVE_CACHE, INTERVALO_VERSION_MS, leerParametro, parsearParametro, remoteConfig,
} from './remoteConfig';
import { GARANTIA_OPCIONES_FALLBACK } from './fallbacks';
import type { BootstrapDTO, EstadoRemoteConfig } from './types';

/**
 * Contrato del Mantenedor común, sección 6: caché local primero, bootstrap con `If-None-Match`,
 * 304 no cambia nada, error reintenta con backoff y nunca bloquea; sin nada, valen los fallbacks.
 */
const bootstrap = (extra: Partial<BootstrapDTO> = {}): BootstrapDTO => ({
  version: 7,
  cliente: 'PANEL',
  generadoEn: '2026-10-20T12:00:00Z',
  parametros: { 'comision.tasa.alta': '0.10', 'comision.iva.incluido': 'true', 'inventario.fotos.maximo': 'abc' },
  parametrosTipos: { 'comision.tasa.alta': 'PERCENT', 'comision.iva.incluido': 'BOOLEAN', 'inventario.fotos.maximo': 'NUMBER' },
  flags: { 'panel.nav.historial': false },
  flagsMetadata: {},
  listas: { GARANTIA_PRODUCTO: [] },
  categorias: [],
  marcasVehiculo: [{ id: 1, nombre: 'Toyota', slug: 'toyota', orden: 0, iconoUrl: null, color: null, destacada: true }],
  marcasRepuestoDestacadas: [],
  ...extra,
});

const respuestaJson = (cuerpo: unknown, status = 200, etag?: string) =>
  new Response(JSON.stringify(cuerpo), { status, headers: etag ? { ETag: etag, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' } });

const llamadas = () => vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), init }));

beforeEach(() => {
  localStorage.clear();
  remoteConfig._reiniciarParaPruebas();
  vi.useFakeTimers();
});

afterEach(() => {
  remoteConfig._reiniciarParaPruebas();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('remoteConfig: caché local', () => {
  it('sin caché ni red el estado está vacío y los accesores devuelven el fallback', () => {
    const estado = remoteConfig.get();
    expect(estado.data).toBeNull();
    expect(estado.origen).toBe('ninguno');
    expect(remoteConfig.flag('panel.nav.historial')).toBe(true);
    expect(remoteConfig.flag('panel.nav.historial', false)).toBe(false);
    expect(remoteConfig.lista('GARANTIA_PRODUCTO').map((o) => o.valor)).toEqual([...GARANTIA_OPCIONES_FALLBACK]);
    expect(remoteConfig.lista('LISTA_QUE_NO_EXISTE')).toEqual([]);
    expect(remoteConfig.parametro('comision.tasa.alta', 0.07)).toBe(0.07);
    expect(remoteConfig.catalogo('marcasVehiculo').length).toBeGreaterThan(200);
  });

  it('al arrancar lee la caché y la expone antes de que responda la red', () => {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ version: 7, data: bootstrap(), guardadoEn: '2026-10-20T10:00:00Z' }));
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    remoteConfig.iniciar();

    const estado = remoteConfig.get();
    expect(estado.origen).toBe('cache');
    expect(estado.data?.version).toBe(7);
    expect(remoteConfig.flag('panel.nav.historial')).toBe(false);
    expect(remoteConfig.catalogo('marcasVehiculo').map((m) => m.nombre)).toEqual(['Toyota']);
  });

  it('ignora una caché corrupta o con otra forma', () => {
    localStorage.setItem(CLAVE_CACHE, '{no es json');
    expect(remoteConfig.get().data).toBeNull();
    remoteConfig._reiniciarParaPruebas();
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ version: 'x', data: { hola: 1 } }));
    expect(remoteConfig.get().data).toBeNull();
  });

  it('un 200 reemplaza lo que había, guarda la caché con su ETag y avisa a los suscritos', async () => {
    const etag = 'W/"8-PANEL"';
    vi.stubGlobal('fetch', vi.fn(async () => respuestaJson(bootstrap({ version: 8 }), 200, etag)));
    const oyente = vi.fn();
    remoteConfig.subscribe(oyente);

    remoteConfig.iniciar();
    await vi.advanceTimersByTimeAsync(0);

    expect(remoteConfig.get().origen).toBe('red');
    expect(remoteConfig.get().data?.version).toBe(8);
    expect(oyente).toHaveBeenCalled();
    const guardado = JSON.parse(localStorage.getItem(CLAVE_CACHE) ?? 'null');
    expect(guardado).toMatchObject({ version: 8, etag });
    expect(typeof guardado.guardadoEn).toBe('string');
    const [primera] = llamadas();
    expect(primera.url).toContain('/api/v1/config/bootstrap?cliente=PANEL');
    expect(new Headers(primera.init?.headers).get('X-Client')).toBe('panel');
  });

  it('manda If-None-Match con el ETag de la caché y un 304 deja todo como estaba', async () => {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ version: 7, data: bootstrap(), guardadoEn: '2026-10-20T10:00:00Z', etag: 'W/"7-PANEL"' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 304 })));
    const oyente = vi.fn();
    remoteConfig.subscribe(oyente);

    remoteConfig.iniciar();
    await vi.advanceTimersByTimeAsync(0);

    expect(new Headers(llamadas()[0].init?.headers).get('If-None-Match')).toBe('W/"7-PANEL"');
    expect(remoteConfig.get().origen).toBe('cache');
    expect(remoteConfig.get().data?.version).toBe(7);
    expect(oyente).not.toHaveBeenCalled();
  });

  it('sin ETag guardado arma el If-None-Match desde la versión de la caché', async () => {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ version: 7, data: bootstrap(), guardadoEn: '' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 304 })));
    remoteConfig.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(new Headers(llamadas()[0].init?.headers).get('If-None-Match')).toBe('W/"7-PANEL"');
  });

  it('un error de red deja los fallbacks, no cierra la sesión y reintenta con backoff 1 s / 5 s / 30 s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"no"}', { status: 401 })));
    const listener = vi.fn();
    window.addEventListener('repuestop:session-expired', listener);

    remoteConfig.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteConfig.get().data).toBeNull();
    expect(remoteConfig.get().error).toContain('401');
    expect(remoteConfig.flag('panel.nav.historial')).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(llamadas()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
    expect(llamadas()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1]);
    expect(llamadas()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[2]);
    expect(llamadas()).toHaveLength(4);
    // Después del último backoff no insiste: espera al foco o al chequeo de los 5 minutos.
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[2]);
    expect(llamadas()).toHaveLength(4);
    window.removeEventListener('repuestop:session-expired', listener);
  });

  it('tras un error, el siguiente 200 recupera y limpia el error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(respuestaJson(bootstrap({ version: 9 }), 200, 'W/"9-PANEL"'));
    vi.stubGlobal('fetch', fetchMock);

    remoteConfig.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteConfig.get().error).toContain('500');
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
    expect(remoteConfig.get().error).toBeNull();
    expect(remoteConfig.get().data?.version).toBe(9);
  });

  it('cada 5 minutos consulta /config/version y sólo vuelve a pedir el bootstrap si cambió', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/config/version')) return respuestaJson({ version: versionServidor });
      return respuestaJson(bootstrap({ version: versionServidor }), 200, `W/"${versionServidor}-PANEL"`);
    });
    let versionServidor = 7;
    vi.stubGlobal('fetch', fetchMock);

    remoteConfig.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(llamadas()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(INTERVALO_VERSION_MS);
    expect(llamadas().map((l) => l.url.includes('/config/version'))).toEqual([false, true]);
    expect(remoteConfig.get().data?.version).toBe(7);

    versionServidor = 8;
    await vi.advanceTimersByTimeAsync(INTERVALO_VERSION_MS);
    expect(llamadas()).toHaveLength(4);
    expect(remoteConfig.get().data?.version).toBe(8);
  });

  it('al volver a la pestaña consulta la versión', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/config/version')
      ? respuestaJson({ version: 7 })
      : respuestaJson(bootstrap(), 200, 'W/"7-PANEL"'))));
    remoteConfig.iniciar();
    await vi.advanceTimersByTimeAsync(0);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(llamadas().at(-1)?.url).toContain('/api/v1/config/version');
  });

  it('detener corta temporizadores y oyentes, pero conserva lo cargado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuestaJson(bootstrap(), 200, 'W/"7-PANEL"')));
    const detener = remoteConfig.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    detener();
    await vi.advanceTimersByTimeAsync(INTERVALO_VERSION_MS * 2);
    expect(llamadas()).toHaveLength(1);
    expect(remoteConfig.get().data?.version).toBe(7);
  });
});

describe('remoteConfig: parámetros según parametrosTipos', () => {
  it('parsea cada tipo del contrato', () => {
    expect(parsearParametro('0.07', 'PERCENT')).toBe(0.07);
    expect(parsearParametro('100000', 'MONEY')).toBe(100000);
    expect(parsearParametro('30', 'NUMBER')).toBe(30);
    expect(parsearParametro('true', 'BOOLEAN')).toBe(true);
    expect(parsearParametro('false', 'BOOLEAN')).toBe(false);
    expect(parsearParametro('si', 'BOOLEAN')).toBeUndefined();
    expect(parsearParametro('2026-10-18', 'STRING')).toBe('2026-10-18');
    expect(parsearParametro('{"a":1}', 'JSON')).toEqual({ a: 1 });
    expect(parsearParametro('{no', 'JSON')).toBeUndefined();
    expect(parsearParametro('abc', 'NUMBER')).toBeUndefined();
    expect(parsearParametro('1', undefined)).toBeUndefined();
  });

  it('devuelve el fallback si el valor no vino, no se pudo parsear o no es del tipo esperado', () => {
    const estado: EstadoRemoteConfig = { data: bootstrap(), origen: 'red', error: null, actualizadoEn: null };
    expect(leerParametro(estado, 'comision.tasa.alta', 0.07)).toBe(0.1);
    expect(leerParametro(estado, 'comision.iva.incluido', false)).toBe(true);
    expect(leerParametro(estado, 'inventario.fotos.maximo', 10)).toBe(10);
    expect(leerParametro(estado, 'comision.tasa.alta', 'texto')).toBe('texto');
    expect(leerParametro(estado, 'no.existe', 3)).toBe(3);
  });

  it('una lista presente pero vacía se respeta (el Mantenedor desactivó todo); una ausente usa el fallback', () => {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ version: 7, data: bootstrap(), guardadoEn: '' }));
    remoteConfig._reiniciarParaPruebas();
    expect(remoteConfig.lista('GARANTIA_PRODUCTO')).toEqual([]);
    expect(remoteConfig.lista('CONDICION_PRODUCTO').map((o) => o.valor)).toEqual(['ORIGINAL', 'ALTERNATIVO']);
  });
});

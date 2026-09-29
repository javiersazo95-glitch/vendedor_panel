import { describe, expect, it, vi } from 'vitest';

import { conReintento429, segundosDeEspera } from './reintento429';

const respuesta = (status: number, retryAfter?: string) =>
  new Response(null, { status, headers: retryAfter ? { 'Retry-After': retryAfter } : {} });

describe('segundosDeEspera', () => {
  it('usa Retry-After en segundos, acotado a un minuto', () => {
    expect(segundosDeEspera(respuesta(429, '7'))).toBe(7);
    expect(segundosDeEspera(respuesta(429, '600'))).toBe(60);
    expect(segundosDeEspera(respuesta(429, '0'))).toBe(1);
  });

  it('sin Retry-After espera cinco segundos', () => {
    expect(segundosDeEspera(respuesta(429))).toBe(5);
  });
});

describe('conReintento429', () => {
  const sinEsperar = () => Promise.resolve();

  it('un 429 no pierde la foto: espera lo indicado y vuelve a intentar', async () => {
    const hacer = vi.fn()
      .mockResolvedValueOnce(respuesta(429, '3'))
      .mockResolvedValueOnce(respuesta(200));
    const esperas: number[] = [];
    const final = await conReintento429(hacer, { esperar: sinEsperar, onEspera: (s) => esperas.push(s) });
    expect(final.status).toBe(200);
    expect(hacer).toHaveBeenCalledTimes(2);
    expect(esperas).toEqual([3]);
  });

  it('otros errores se devuelven sin reintentar', async () => {
    const hacer = vi.fn().mockResolvedValue(respuesta(404));
    const final = await conReintento429(hacer, { esperar: sinEsperar });
    expect(final.status).toBe(404);
    expect(hacer).toHaveBeenCalledTimes(1);
  });

  it('se rinde al agotar los intentos y devuelve el último 429', async () => {
    const hacer = vi.fn().mockResolvedValue(respuesta(429, '1'));
    const final = await conReintento429(hacer, { intentos: 3, esperar: sinEsperar });
    expect(final.status).toBe(429);
    expect(hacer).toHaveBeenCalledTimes(3);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AccionNoPermitidaInvitadoError, EVENTO_ACCESO_TERMINADO, SessionExpiredError, apiFetch } from './apiFetch';
import { ModoInvitadoProvider } from '../components/ModoInvitadoProvider';
import {
  calcularRestante,
  nivelPermite,
  tonoRestante,
  useModoInvitado,
  type InvitadoSesion,
} from './modoInvitado';

const invitado = (nivel: InvitadoSesion['nivel']): InvitadoSesion => ({
  accesoId: 3,
  tienda: 'Repuestos Vera',
  estado: 'ACTIVO',
  nivel,
  nivelSolicitado: 'COMPLETO',
  expiraEn: '2026-11-17T18:00:00Z',
  solicitudExpiraEn: '2026-11-19T15:00:00Z',
  offsetMs: 0,
});

describe('nivelPermite', () => {
  it('cada nivel incluye al anterior', () => {
    expect(nivelPermite('BASICO', 'CREAR')).toBe(true);
    expect(nivelPermite('BASICO', 'PRECIOS')).toBe(false);
    expect(nivelPermite('BASICO', 'EXCEL')).toBe(false);
    expect(nivelPermite('MEDIO', 'PRECIOS')).toBe(true);
    expect(nivelPermite('MEDIO', 'EXCEL')).toBe(false);
    expect(nivelPermite('COMPLETO', 'EXCEL')).toBe(true);
  });

  it('sin nivel no permite nada', () => {
    expect(nivelPermite(null, 'CREAR')).toBe(false);
  });
});

describe('contador', () => {
  const fin = '2026-11-17T18:00:00Z';
  const ahora = Date.parse('2026-11-17T15:00:00Z');

  it('cuenta hasta el fin con el reloj del servidor, no el del equipo', () => {
    expect(calcularRestante(fin, 0, ahora).texto).toBe('03:00:00');
    // El reloj del equipo va 1 h atrasado: el servidor ya esta 1 h mas adelante.
    expect(calcularRestante(fin, 3_600_000, ahora).texto).toBe('02:00:00');
  });

  it('muestra los dias cuando faltan mas de 24 h', () => {
    expect(calcularRestante('2026-11-19T16:04:05Z', 0, ahora).texto).toBe('2d 01:04:05');
  });

  it('vencido o sin fecha queda en cero', () => {
    expect(calcularRestante(fin, 0, Date.parse('2026-11-17T18:00:01Z'))).toMatchObject({ ms: 0, vencido: true, texto: '00:00:00' });
    expect(calcularRestante(null, 0, ahora).vencido).toBe(true);
  });

  it('el progreso avanza entre inicio y fin', () => {
    expect(calcularRestante(fin, 0, ahora, '2026-11-17T12:00:00Z').progreso).toBeCloseTo(0.5);
  });

  it('el tono sube de normal a ambar a rojo', () => {
    expect(tonoRestante(7 * 3_600_000)).toBe('normal');
    expect(tonoRestante(5 * 3_600_000)).toBe('ambar');
    expect(tonoRestante(30 * 60_000)).toBe('rojo');
  });
});

function Lector() {
  const m = useModoInvitado();
  return <p>{m.activo ? `invitado ${m.nivel} crear=${m.puede('CREAR')} precios=${m.puede('PRECIOS')} excel=${m.puede('EXCEL')}` : 'vendedor'}</p>;
}

describe('contexto del modo invitado', () => {
  it('fuera del modo invitado el vendedor lo puede todo', () => {
    render(<Lector />);
    expect(screen.getByText('vendedor')).toBeInTheDocument();
  });

  it('dentro, solo lo que el nivel permite', () => {
    render(<ModoInvitadoProvider invitado={invitado('MEDIO')}><Lector /></ModoInvitadoProvider>);
    expect(screen.getByText('invitado MEDIO crear=true precios=true excel=false')).toBeInTheDocument();
  });
});

describe('apiFetch en modo invitado', () => {
  const sesion = (conInvitado: boolean) => sessionStorage.setItem('repuestop_session', JSON.stringify({
    user: { email: 'Sofía', role: 'Soporte (invitado)', token: 'jwt', sellerId: '7', ...(conInvitado ? { invitado: invitado('COMPLETO') } : {}) },
    timestamp: Date.now(),
  }));

  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('un 403 avisa que no esta permitido y NO cierra la sesion', async () => {
    sesion(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    await expect(apiFetch('http://api/x')).rejects.toBeInstanceOf(AccionNoPermitidaInvitadoError);
    expect(sessionStorage.getItem('repuestop_session')).not.toBeNull();
  });

  it('un 401 cierra la sesion y avisa que el acceso termino', async () => {
    sesion(true);
    const aviso = vi.fn();
    window.addEventListener(EVENTO_ACCESO_TERMINADO, aviso);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(apiFetch('http://api/x')).rejects.toBeInstanceOf(SessionExpiredError);
    expect(sessionStorage.getItem('repuestop_session')).toBeNull();
    expect(aviso).toHaveBeenCalled();
    window.removeEventListener(EVENTO_ACCESO_TERMINADO, aviso);
  });

  it('el vendedor normal sigue igual: un 403 cierra su sesion', async () => {
    sesion(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    await expect(apiFetch('http://api/x')).rejects.toBeInstanceOf(SessionExpiredError);
    expect(sessionStorage.getItem('repuestop_session')).toBeNull();
  });
});

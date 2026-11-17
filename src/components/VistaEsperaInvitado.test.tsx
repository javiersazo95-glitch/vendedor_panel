import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VistaEsperaInvitado } from './VistaEsperaInvitado';
import { PantallaAccesoTerminado } from './ModoInvitadoMarco';
import type { InvitadoSesion } from '../utils/modoInvitado';

const api = vi.hoisted(() => ({
  estadoDelAcceso: vi.fn(),
  reenviarCorreo: vi.fn(),
  cancelarSolicitud: vi.fn(),
}));
vi.mock('../utils/accesoAsistidoApi', () => api);

const AHORA = Date.parse('2026-11-17T15:00:00Z');
const invitado = (solicitudExpiraEn: string): InvitadoSesion => ({
  accesoId: 3, tienda: 'Repuestos Vera', estado: 'PENDIENTE_VENDEDOR', nivel: null, nivelSolicitado: 'MEDIO',
  expiraEn: null, solicitudExpiraEn, offsetMs: 0,
});
const acceso = (estado: string) => ({ id: 3, estado });

describe('VistaEsperaInvitado', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
    Object.values(api).forEach((f) => f.mockReset());
    api.estadoDelAcceso.mockResolvedValue(acceso('PENDIENTE_VENDEDOR'));
  });
  afterEach(() => vi.useRealTimers());

  it('dice a quien espera, que se pidio y cuanto falta para que venza la solicitud', () => {
    render(<VistaEsperaInvitado token="t" invitado={invitado('2026-11-17T21:30:00Z')} onCambio={vi.fn()} onSalir={vi.fn()} />);
    expect(screen.getByText('Esperando que Repuestos Vera autorice el acceso')).toBeInTheDocument();
    expect(screen.getByText('Carga uno a uno y precios')).toBeInTheDocument();
    expect(screen.getByText('06:30:00')).toBeInTheDocument();
  });

  it('el contador baja cada segundo y cambia de tono al acercarse el vencimiento', () => {
    const { container } = render(<VistaEsperaInvitado token="t" invitado={invitado('2026-11-17T16:00:30Z')} onCambio={vi.fn()} onSalir={vi.fn()} />);
    expect(container.querySelector('.espera-invitado-contador')).toHaveClass('tono-ambar');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('01:00:28')).toBeInTheDocument();
    const rojo = render(<VistaEsperaInvitado token="t" invitado={invitado('2026-11-17T15:30:00Z')} onCambio={vi.fn()} onSalir={vi.fn()} />);
    expect(rojo.container.querySelector('.espera-invitado-contador')).toHaveClass('tono-rojo');
  });

  it.each(['ACTIVO', 'RECHAZADO', 'EXPIRADO', 'CANCELADO'])('al pasar a %s avisa para que App cambie de pantalla', async (estado) => {
    const onCambio = vi.fn();
    api.estadoDelAcceso.mockResolvedValue(acceso(estado));
    render(<VistaEsperaInvitado token="t" invitado={invitado('2026-11-17T21:30:00Z')} onCambio={onCambio} onSalir={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(onCambio).toHaveBeenCalledWith(expect.objectContaining({ estado }));
  });

  it('mientras siga pendiente no cambia de pantalla', async () => {
    const onCambio = vi.fn();
    render(<VistaEsperaInvitado token="t" invitado={invitado('2026-11-17T21:30:00Z')} onCambio={onCambio} onSalir={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(api.estadoDelAcceso).toHaveBeenCalledTimes(3);
    expect(onCambio).not.toHaveBeenCalled();
  });

  it('reenviar el correo avisa y cancelar pasa la solicitud a cancelada', async () => {
    const onCambio = vi.fn();
    api.reenviarCorreo.mockResolvedValue(acceso('PENDIENTE_VENDEDOR'));
    api.cancelarSolicitud.mockResolvedValue(acceso('CANCELADO'));
    render(<VistaEsperaInvitado token="t" invitado={invitado('2026-11-17T21:30:00Z')} onCambio={onCambio} onSalir={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reenviar correo' })); });
    expect(screen.getByText('Correo reenviado al vendedor.')).toBeInTheDocument();
    expect(onCambio).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancelar solicitud' })); });
    expect(onCambio).toHaveBeenCalledWith(expect.objectContaining({ estado: 'CANCELADO' }));
  });

  it('muestra el motivo si el reenvio falla (por ejemplo, demasiado pronto)', async () => {
    api.reenviarCorreo.mockRejectedValue(new Error('Ya enviaste el correo hace poco. Podrás reenviarlo en 9 min.'));
    render(<VistaEsperaInvitado token="t" invitado={invitado('2026-11-17T21:30:00Z')} onCambio={vi.fn()} onSalir={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reenviar correo' })); });
    expect(screen.getByText(/Podrás reenviarlo en 9 min/)).toBeInTheDocument();
  });

  it('cerrar sale sin cancelar nada', () => {
    const onSalir = vi.fn();
    render(<VistaEsperaInvitado token="t" invitado={invitado('2026-11-17T21:30:00Z')} onCambio={vi.fn()} onSalir={onSalir} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onSalir).toHaveBeenCalled();
    expect(api.cancelarSolicitud).not.toHaveBeenCalled();
  });
});

describe('PantallaAccesoTerminado', () => {
  it('explica por que termino y no ofrece iniciar sesion', () => {
    render(<PantallaAccesoTerminado estado="RECHAZADO" comentario="Prefiero cargarlos yo" />);
    expect(screen.getByText('El vendedor rechazó la solicitud')).toBeInTheDocument();
    expect(screen.getByText(/Prefiero cargarlos yo/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('un estado desconocido igual dice que ya no esta vigente', () => {
    render(<PantallaAccesoTerminado estado="DESCONOCIDO" />);
    expect(screen.getByText('El acceso ya no está vigente')).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Auth } from './Auth';
import { revocarSesionVencida } from '../db';

vi.mock('../db', () => ({
  revocarSesionVencida: vi.fn().mockResolvedValue(undefined),
}));

const respuestaLogin = (cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'Content-Type': 'application/json' } });

const renderAuth = (onLogin = vi.fn()) => {
  render(
    <GoogleOAuthProvider clientId="client-id-de-prueba">
      <Auth onLogin={onLogin} />
    </GoogleOAuthProvider>,
  );
  return onLogin;
};

const ingresar = () => {
  fireEvent.change(screen.getByLabelText(/Correo Electrónico/i), { target: { value: 'vendedor@repuestop.cl' } });
  fireEvent.change(screen.getByLabelText(/Contraseña/i), { target: { value: 'clave-de-prueba' } });
  fireEvent.click(screen.getByRole('button', { name: /Ingresar al Panel/i }));
};

describe('Auth: tienda suspendida (H61)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(revocarSesionVencida).mockClear();
  });

  /**
   * F2-43 (30-sep): el login respondia 200 con `sellerBlocked`, el panel guardaba la sesion y el
   * primer 403 lo devolvia al login en menos de un segundo, sin mensaje.
   */
  it('muestra el motivo y dónde pedir la revisión, sin abrir el panel', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuestaLogin({
      token: 'jwt-suspendido',
      sellerId: 6,
      usuario: { email: 'vendedor@repuestop.cl' },
      sellerBlocked: true,
      sellerBlockReason: 'Cuenta suspendida por el equipo de mediación. Motivo: Publica repuestos falsificados',
      sellerCanAppeal: true,
      suspendedUntil: null,
    }));
    const onLogin = renderAuth();

    ingresar();

    const aviso = await screen.findByTestId('aviso-tienda-suspendida');
    expect(aviso).toHaveTextContent('Tu tienda se encuentra suspendida');
    expect(aviso).toHaveTextContent('Publica repuestos falsificados');
    expect(aviso).toHaveTextContent('Solicitar Revisión');
    expect(onLogin).not.toHaveBeenCalled();
    await waitFor(() => expect(revocarSesionVencida).toHaveBeenCalledWith('jwt-suspendido'));
  });

  it('en una suspensión temporal dice cuándo termina y no ofrece la revisión', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuestaLogin({
      token: 'jwt-temporal',
      sellerId: 6,
      usuario: { email: 'vendedor@repuestop.cl' },
      sellerBlocked: true,
      sellerBlockReason: 'Cuenta suspendida por el equipo de mediación. Motivo: Conducta inadecuada',
      sellerCanAppeal: false,
      suspendedUntil: '2026-10-03T20:26:00Z',
    }));
    const onLogin = renderAuth();

    ingresar();

    const aviso = await screen.findByTestId('aviso-tienda-suspendida');
    expect(aviso).toHaveTextContent('La suspensión termina el');
    expect(aviso).toHaveTextContent('2026');
    expect(aviso).not.toHaveTextContent('Solicitar Revisión');
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('una tienda activa entra al panel como siempre', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuestaLogin({
      token: 'jwt-activo',
      sellerId: 6,
      usuario: { email: 'vendedor@repuestop.cl' },
      sellerBlocked: false,
      founder: true,
    }));
    const onLogin = renderAuth();

    ingresar();

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('vendedor@repuestop.cl', 'Vendedor', 'jwt-activo', '6', true));
    expect(screen.queryByTestId('aviso-tienda-suspendida')).not.toBeInTheDocument();
    expect(revocarSesionVencida).not.toHaveBeenCalled();
  });
});

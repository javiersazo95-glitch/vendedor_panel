import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BotonSoporte } from './BotonSoporte';
import { clearSession, saveSession } from '../../utils/session';
import { listarChatsSoporte, obtenerChatActivo, obtenerResumenSoporte } from '../../utils/soporteCargaApi';

vi.mock('../../utils/soporteCargaApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../utils/soporteCargaApi')>();
  return {
    ...real,
    obtenerResumenSoporte: vi.fn(),
    obtenerChatActivo: vi.fn(),
    listarChatsSoporte: vi.fn(),
    obtenerMensajesSoporte: vi.fn().mockResolvedValue([]),
  };
});

describe('BotonSoporte', () => {
  beforeEach(() => {
    saveSession({ email: 'a@a.com', role: 'vendedor', token: 'tok', sellerId: '7' });
    vi.mocked(obtenerResumenSoporte).mockResolvedValue({ chatActivoId: 5, estado: 'ESPERANDO_VENDEDOR', noLeidos: 3 });
    vi.mocked(obtenerChatActivo).mockResolvedValue(null);
    vi.mocked(listarChatsSoporte).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearSession();
  });

  it('muestra cuantos mensajes de soporte hay sin leer', async () => {
    render(<BotonSoporte />);
    expect(await screen.findByTestId('soporte-badge')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /habla con soporte\. tienes 3 mensajes nuevos/i })).toBeInTheDocument();
  });

  it('abre la ventana de soporte y la cierra con Escape', async () => {
    render(<BotonSoporte />);
    const boton = screen.getByRole('button', { name: /necesitas ayuda/i });
    expect(boton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(boton);
    const panel = screen.getByRole('dialog', { name: 'Soporte RepuesTop' });
    expect(panel).toHaveTextContent('Te ayudamos a cargar tu inventario');
    // Sin conversacion abierta aparece el formulario para abrir una.
    expect(await screen.findByRole('button', { name: /enviar a soporte/i })).toBeInTheDocument();

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Soporte RepuesTop' })).not.toBeInTheDocument();
  });
});

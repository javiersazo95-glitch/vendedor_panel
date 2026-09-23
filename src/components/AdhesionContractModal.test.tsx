import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdhesionContractModal } from './AdhesionContractModal';
import { acceptAdhesionContract, getAdhesionContractPdf, isAdhesionContractPending } from '../db';

vi.mock('../db', () => ({
  isAdhesionContractPending: vi.fn(),
  getAdhesionContractPdf: vi.fn(),
  acceptAdhesionContract: vi.fn(),
}));

describe('AdhesionContractModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:contrato');
    URL.revokeObjectURL = vi.fn();
    vi.mocked(getAdhesionContractPdf).mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
  });

  it('no aparece si el contrato ya está firmado', async () => {
    vi.mocked(isAdhesionContractPending).mockResolvedValue(false);
    render(<AdhesionContractModal onLogout={vi.fn()} />);
    await waitFor(() => expect(isAdhesionContractPending).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getAdhesionContractPdf).not.toHaveBeenCalled();
  });

  it('bloquea hasta aceptar: el botón exige la casilla y al firmar se cierra', async () => {
    vi.mocked(isAdhesionContractPending).mockResolvedValue(true);
    vi.mocked(acceptAdhesionContract).mockResolvedValue(undefined);
    render(<AdhesionContractModal onLogout={vi.fn()} />);

    const aceptar = await screen.findByRole('button', { name: 'Aceptar y continuar' }) as HTMLButtonElement;
    await waitFor(() => expect(getAdhesionContractPdf).toHaveBeenCalled());
    expect(aceptar.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(aceptar.disabled).toBe(false));
    fireEvent.click(aceptar);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(acceptAdhesionContract).toHaveBeenCalledTimes(1);
  });

  it('si el registro falla muestra el error y sigue abierto', async () => {
    vi.mocked(isAdhesionContractPending).mockResolvedValue(true);
    vi.mocked(acceptAdhesionContract).mockRejectedValue(new Error('No pudimos registrar tu aceptación.'));
    render(<AdhesionContractModal onLogout={vi.fn()} />);

    const aceptar = await screen.findByRole('button', { name: 'Aceptar y continuar' }) as HTMLButtonElement;
    await waitFor(() => expect(getAdhesionContractPdf).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(aceptar.disabled).toBe(false));
    fireEvent.click(aceptar);

    expect((await screen.findByRole('alert')).textContent).toContain('No pudimos registrar tu aceptación.');
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('la única salida sin firmar es cerrar sesión', async () => {
    vi.mocked(isAdhesionContractPending).mockResolvedValue(true);
    const onLogout = vi.fn();
    render(<AdhesionContractModal onLogout={onLogout} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

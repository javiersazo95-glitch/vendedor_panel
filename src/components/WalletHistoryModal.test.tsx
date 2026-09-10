import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WalletHistoryModal } from './WalletHistoryModal';
import { getWalletHistory, type WalletMovement } from '../db';

vi.mock('../db', () => ({
  getWalletHistory: vi.fn(),
  getRechargeDocumentUrl: vi.fn(),
}));

const movimiento = (extra: Partial<WalletMovement>): WalletMovement => ({
  id: '1',
  tipo: 'CREDITO',
  cantidad: 220,
  motivo: 'COMPRA',
  descripcion: null,
  anuncioId: null,
  fecha: '2026-09-01T12:00:00Z',
  compraId: null,
  documentoDisponible: false,
  documentoTipo: null,
  documentoFolio: null,
  documentoFecha: null,
  ...extra,
});

const abrirDetalle = async (nombre: RegExp) => fireEvent.click(await screen.findByRole('button', { name: nombre }));

describe('WalletHistoryModal', () => {
  beforeEach(() => vi.mocked(getWalletHistory).mockResolvedValue({ saldo: 220, movimientos: [] }));
  afterEach(() => vi.clearAllMocks());

  it('resume las recargas y los cobros, y nombra el motivo cuando no hay descripción', async () => {
    vi.mocked(getWalletHistory).mockResolvedValue({
      saldo: 20,
      movimientos: [
        movimiento({ id: '2', tipo: 'DEBITO', cantidad: 200, motivo: 'PRODUCTO_TOP', descripcion: 'Activación Top por 30 días: Filtro de aceite' }),
        movimiento({ id: '1' }),
      ],
    });

    render(<WalletHistoryModal onClose={() => {}} />);

    expect(await screen.findByText('Activación Top por 30 días: Filtro de aceite')).toBeInTheDocument();
    // Sin descripción, la fila igual dice qué fue: el motivo tiene su propio texto.
    expect(screen.getByText('Recarga de monedas')).toBeInTheDocument();
    expect(screen.getByText('+220')).toBeInTheDocument();
    expect(screen.getByText('−200')).toBeInTheDocument();
  });

  it('ofrece la factura de una recarga documentada, con su folio', async () => {
    vi.mocked(getWalletHistory).mockResolvedValue({
      saldo: 220,
      movimientos: [movimiento({ compraId: '10', documentoDisponible: true, documentoTipo: 'FACTURA', documentoFolio: '4521', documentoFecha: '2026-09-02T10:00:00Z' })],
    });

    render(<WalletHistoryModal onClose={() => {}} />);
    await abrirDetalle(/Recarga de monedas/i);

    expect(screen.getByRole('button', { name: /Ver mi factura/i })).toBeInTheDocument();
    expect(screen.getByText('Factura N.º 4521')).toBeInTheDocument();
  });

  /**
   * Sin `compraId` no hay a qué pedirle el documento, por más que el backend marque que existe:
   * ofrecer el botón dejaría al vendedor apretando algo que solo puede fallar.
   */
  it('no ofrece el documento de una recarga vieja sin compra asociada', async () => {
    vi.mocked(getWalletHistory).mockResolvedValue({
      saldo: 220,
      movimientos: [movimiento({ compraId: null, documentoDisponible: true, documentoTipo: 'BOLETA' })],
    });

    render(<WalletHistoryModal onClose={() => {}} />);
    await abrirDetalle(/Recarga de monedas/i);

    expect(screen.queryByRole('button', { name: /Ver mi/i })).not.toBeInTheDocument();
  });

  /** Una recarga sin documento todavía no es un error: RepuesTop lo emite a mano y puede tardar. */
  it('explica que el documento todavía no está emitido en vez de callarse', async () => {
    vi.mocked(getWalletHistory).mockResolvedValue({ saldo: 220, movimientos: [movimiento({ compraId: '11' })] });

    render(<WalletHistoryModal onClose={() => {}} />);
    await abrirDetalle(/Recarga de monedas/i);

    expect(screen.getByText(/todavía no está emitida/i)).toBeInTheDocument();
  });

  it('devuelve al monedero el saldo que trae el historial', async () => {
    const onBalance = vi.fn();
    vi.mocked(getWalletHistory).mockResolvedValue({ saldo: 640, movimientos: [] });

    render(<WalletHistoryModal onClose={() => {}} onBalance={onBalance} />);

    expect(await screen.findByText(/Todavía no hay movimientos/i)).toBeInTheDocument();
    expect(onBalance).toHaveBeenCalledWith(640);
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
import { getAllProducts, getWalletBalance, logout } from './db';
import { getStoredSession, saveSession } from './utils/session';

vi.mock('./db', () => ({
  logout: vi.fn(),
  getAllProducts: vi.fn(),
  deleteProduct: vi.fn(),
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  pauseProduct: vi.fn(),
  resumeProduct: vi.fn(),
  getProductTopSummary: vi.fn(),
  getWalletBalance: vi.fn(),
  setProductTop: vi.fn(),
  saveProductsBatch: vi.fn(),
  savePreciosStockBatch: vi.fn(),
  getCoinPacks: vi.fn(),
  getRechargeDocumentData: vi.fn(),
  startRecharge: vi.fn(),
  getRechargeDocumentUrl: vi.fn(),
  getWalletHistory: vi.fn(),
}));

/** Al cerrar sesión App vuelve a Auth, que monta GoogleLogin: necesita el mismo proveedor que main.tsx. */
const renderApp = () => render(<GoogleOAuthProvider clientId="client-id-de-prueba"><App /></GoogleOAuthProvider>);

describe('App: cierre de sesión (SEC-MARKET-B06)', () => {
  beforeEach(() => {
    vi.mocked(getAllProducts).mockResolvedValue([]);
    vi.mocked(getWalletBalance).mockResolvedValue({ saldo: 0 });
    vi.mocked(logout).mockResolvedValue(undefined);
    saveSession({ email: 'vendedor@repuestop.cl', role: 'Vendedor', token: 'jwt-de-prueba', sellerId: '42' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  /**
   * El control que faltaba: antes de este arreglo, cerrar sesión sólo borraba el
   * almacenamiento local y el JWT seguía abriendo inventario y monedero hasta su `exp`.
   */
  it('revoca la sesión en el servidor, no sólo en el navegador', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Cerrar Sesión/i }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(getStoredSession()).toBeNull();
  });

  /** Un backend caído no puede dejar al vendedor encerrado en un panel que ya no debería ver. */
  it('cierra igual en la interfaz aunque la revocación falle', async () => {
    vi.mocked(logout).mockRejectedValue(new Error('sin red'));
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /Cerrar Sesión/i }));

    expect(await screen.findByRole('button', { name: /Ingresar al Panel/i })).toBeInTheDocument();
    expect(getStoredSession()).toBeNull();
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
import { getAllProducts, getWalletBalance, logout, revocarSesionVencida } from './db';
import { getStoredSession, saveSession } from './utils/session';

vi.mock('./db', () => ({
  logout: vi.fn(),
  revocarSesionVencida: vi.fn(),
  getAllProducts: vi.fn(),
  deleteProduct: vi.fn(),
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  pauseProduct: vi.fn(),
  resumeProduct: vi.fn(),
  getProductTopSummary: vi.fn(),
  getWalletBalance: vi.fn(),
  // El Dashboard lo llama al montar (avatar del encabezado, 905e1477). Es decorativo: sin foto
  // queda la inicial, asi que el mock devuelve null.
  getSellerProfileImage: vi.fn().mockResolvedValue(null),
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
    vi.mocked(revocarSesionVencida).mockResolvedValue(undefined);
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

describe('App: sesión vencida por TTL (SEC-MARKET-B03)', () => {
  beforeEach(() => {
    vi.mocked(getAllProducts).mockResolvedValue([]);
    vi.mocked(getWalletBalance).mockResolvedValue({ saldo: 0 });
    vi.mocked(revocarSesionVencida).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.useRealTimers();
  });

  /**
   * El panel daba la sesión por terminada a las 2 h y no le avisaba al servidor: el token seguía
   * abriendo inventario y monedero hasta su `exp`, que son 8 h deslizantes.
   */
  it('revoca en el servidor el token de la sesión que venció', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    saveSession({ email: 'vendedor@repuestop.cl', role: 'Vendedor', token: 'tok-vencido', sellerId: '42' });
    vi.setSystemTime(new Date('2026-01-01T02:00:01Z'));

    renderApp();

    await waitFor(() => expect(revocarSesionVencida).toHaveBeenCalledWith('tok-vencido'));
    // Y el vendedor queda en el login, no dentro del panel.
    expect(await screen.findByRole('button', { name: /Ingresar al Panel/i })).toBeInTheDocument();
  });

  it('no revoca nada cuando la sesión sigue vigente', async () => {
    saveSession({ email: 'vendedor@repuestop.cl', role: 'Vendedor', token: 'tok-vivo', sellerId: '42' });

    renderApp();

    await screen.findByRole('button', { name: /Cerrar Sesión/i });
    expect(revocarSesionVencida).not.toHaveBeenCalled();
  });
});

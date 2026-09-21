import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RechargeModal } from './RechargeModal';
import { getCoinPacks, getRechargeDocumentData, startRecharge } from '../db';

vi.mock('../db', () => ({
  getCoinPacks: vi.fn(),
  getRechargeDocumentData: vi.fn(),
  startRecharge: vi.fn(),
}));

const PACKS = [
  { id: 'PACK_BASICO', nombre: 'Pack Básico', monedas: 100, bonus: 0, totalMonedas: 100, precioClp: 5000, etiqueta: 'Inicial', descripcion: '', color: null, destacado: false },
  { id: 'PACK_MEDIO', nombre: 'Pack Medio', monedas: 200, bonus: 20, totalMonedas: 220, precioClp: 10000, etiqueta: 'El más elegido', descripcion: '', color: null, destacado: true },
];

/** La redirección a Flow es `window.location.href`; jsdom no navega, así que se intercepta. */
function espiarNavegacion() {
  const location = { href: '' } as Location;
  Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true });
  return location;
}

const escribir = (etiqueta: RegExp, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });

describe('RechargeModal', () => {
  beforeEach(() => {
    vi.mocked(getCoinPacks).mockResolvedValue(PACKS);
    vi.mocked(getRechargeDocumentData).mockResolvedValue({ tipoSugerido: 'BOLETA', rut: '', razonSocial: '', giro: '' });
    vi.mocked(startRecharge).mockResolvedValue({ url: 'https://sandbox.flow.cl/pagar/abc', token: 'abc' });
  });

  afterEach(() => vi.clearAllMocks());

  it('muestra los packs del backend y preselecciona el destacado', async () => {
    render(<RechargeModal onClose={() => {}} />);

    expect(await screen.findByText('Pack Medio')).toBeInTheDocument();
    expect(screen.getByText('Pack Básico')).toBeInTheDocument();
    // El destacado queda elegido, y el total a pagar es el suyo.
    expect(screen.getByRole('radio', { name: /Pack Medio/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /Pagar \$10\.000 CLP/i })).toBeEnabled();
  });

  it('manda a Flow con el pack elegido y no acredita nada por su cuenta', async () => {
    const location = espiarNavegacion();
    render(<RechargeModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('radio', { name: /Pack Básico/i }));
    fireEvent.click(screen.getByRole('button', { name: /Pagar \$5\.000 CLP/i }));

    await waitFor(() => expect(location.href).toBe('https://sandbox.flow.cl/pagar/abc'));
    expect(startRecharge).toHaveBeenCalledWith('PACK_BASICO', expect.objectContaining({ tipo: 'BOLETA' }));
  });

  /**
   * El caso que justifica validar en el cliente: el RUT se corta ANTES de cobrar. Después del
   * cobro, una factura que no se puede emitir obliga a devolver la plata.
   */
  it('no deja pagar una factura con un RUT de dígito verificador equivocado', async () => {
    render(<RechargeModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('radio', { name: /Factura/i }));
    escribir(/RUT/i, '123456789');
    escribir(/Razón social/i, 'Repuestos SpA');

    expect(screen.getByRole('button', { name: /Pagar/i })).toBeDisabled();
    expect(startRecharge).not.toHaveBeenCalled();
  });

  it('deja pagar una factura con RUT válido y razón social', async () => {
    render(<RechargeModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('radio', { name: /Factura/i }));
    escribir(/RUT/i, '183281232');
    escribir(/Razón social/i, 'Repuestos SpA');

    // El RUT se va formateando mientras se escribe, como en la web y en la app.
    expect(screen.getByLabelText(/RUT/i)).toHaveValue('18.328.123-2');
    expect(screen.getByRole('button', { name: /Pagar/i })).toBeEnabled();
  });

  /** Una boleta no pide RUT: exigirlo dejaría sin recargar a quien no tiene giro. */
  it('con boleta no pide datos de facturación', async () => {
    render(<RechargeModal onClose={() => {}} />);

    await screen.findByText('Pack Medio');
    expect(screen.queryByLabelText(/RUT/i)).not.toBeInTheDocument();
  });

  it('avisa cuando la pasarela falla, en vez de dejar el botón girando', async () => {
    vi.mocked(startRecharge).mockRejectedValue(new Error('La pasarela no está disponible.'));
    render(<RechargeModal onClose={() => {}} />);

    // Se espera al pack, no al botón: mientras el catálogo carga el botón ya existe pero sin
    // pack elegido, y apretarlo no llama a nada.
    fireEvent.click(await screen.findByRole('button', { name: /Pagar \$10\.000 CLP/i }));

    expect(await screen.findByText('La pasarela no está disponible.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pagar/i })).toBeEnabled();
  });

  /**
   * SEC-MARKET-C07: el panel sale de sí mismo justo antes de pagar. Si la URL de cobro no
   * apunta a la pasarela, no se navega: es el peor momento para mandar al vendedor a un
   * formulario ajeno a escribir sus datos.
   */
  it('no redirige si la URL de cobro no es de la pasarela', async () => {
    vi.mocked(startRecharge).mockResolvedValue({ url: 'https://flow.cl.attacker.com/pagar', token: 'abc' });
    const location = espiarNavegacion();
    render(<RechargeModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Pagar \$10\.000 CLP/i }));

    expect(await screen.findByText(/No pudimos llevarte al pago de forma segura/i)).toBeInTheDocument();
    expect(location.href).toBe('');
    // El botón vuelve a estar disponible: el vendedor puede reintentar.
    expect(screen.getByRole('button', { name: /Pagar/i })).toBeEnabled();
  });

  /** Que no se puedan leer los datos de facturación no puede impedir recargar con boleta. */
  it('recarga igual si no se pueden prellenar los datos del documento', async () => {
    vi.mocked(getRechargeDocumentData).mockRejectedValue(new Error('sin datos'));
    render(<RechargeModal onClose={() => {}} />);

    expect(await screen.findByRole('button', { name: /Pagar \$10\.000 CLP/i })).toBeEnabled();
  });
});

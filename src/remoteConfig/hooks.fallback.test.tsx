import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Feature } from './Feature';
import { useCatalogo, useFlag, useLista, useParametro } from './hooks';
import { RemoteConfigProvider } from './RemoteConfigContext';
import { CLAVE_CACHE, remoteConfig } from './remoteConfig';
import { GARANTIA_OPCIONES_FALLBACK } from './fallbacks';
import type { BootstrapDTO } from './types';

/**
 * Contrato del Mantenedor común, sección 6, puntos 4 y 5: cada hook devuelve su fallback mientras
 * no haya bootstrap (sin provider, con la API caída o con un build viejo), y cambia solo cuando
 * el bootstrap llega.
 */
function Sonda() {
  const historial = useFlag('panel.nav.historial');
  const cargaUnificada = useFlag('panel.carga-excel-unificada', false);
  const garantias = useLista('GARANTIA_PRODUCTO');
  const tasa = useParametro('comision.tasa.alta', 0.07);
  const marcas = useCatalogo('marcasVehiculo');
  return (
    <ul>
      <li data-testid="historial">{String(historial)}</li>
      <li data-testid="unificada">{String(cargaUnificada)}</li>
      <li data-testid="garantias">{garantias.map((g) => g.valor).join('|')}</li>
      <li data-testid="tasa">{tasa}</li>
      <li data-testid="marcas">{marcas.length}</li>
      <Feature flag="panel.monedero"><li data-testid="monedero">monedero</li></Feature>
      <Feature flag="panel.soporte-chat" fallback={false}><li data-testid="soporte">soporte</li></Feature>
    </ul>
  );
}

const bootstrap = (): BootstrapDTO => ({
  version: 3,
  cliente: 'PANEL',
  generadoEn: '2026-10-20T12:00:00Z',
  parametros: { 'comision.tasa.alta': '0.10' },
  parametrosTipos: { 'comision.tasa.alta': 'PERCENT' },
  flags: { 'panel.nav.historial': false, 'panel.carga-excel-unificada': true, 'panel.monedero': false, 'panel.soporte-chat': true },
  flagsMetadata: {},
  listas: { GARANTIA_PRODUCTO: [{ valor: '1 año', etiqueta: '1 año', descripcion: null, orden: 0, esDefault: true, iconoUrl: null, color: null, metadata: null }] },
  categorias: [],
  marcasVehiculo: [{ id: 1, nombre: 'Toyota', slug: 'toyota', orden: 0, iconoUrl: null, color: null, destacada: true }],
  marcasRepuestoDestacadas: [],
});

beforeEach(() => {
  localStorage.clear();
  remoteConfig._reiniciarParaPruebas();
});

afterEach(() => {
  remoteConfig._reiniciarParaPruebas();
  vi.unstubAllGlobals();
});

const esperar = (ms = 0) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

describe('hooks de configuración remota: fallbacks', () => {
  it('sin provider devuelven el fallback de cada uno', () => {
    render(<Sonda />);
    expect(screen.getByTestId('historial')).toHaveTextContent('true');
    expect(screen.getByTestId('unificada')).toHaveTextContent('false');
    expect(screen.getByTestId('garantias')).toHaveTextContent(GARANTIA_OPCIONES_FALLBACK.join('|'));
    expect(screen.getByTestId('tasa')).toHaveTextContent('0.07');
    expect(Number(screen.getByTestId('marcas').textContent)).toBeGreaterThan(200);
    expect(screen.getByTestId('monedero')).toBeInTheDocument();
    expect(screen.queryByTestId('soporte')).not.toBeInTheDocument();
  });

  it('con provider y la API caída siguen los fallbacks y el panel no se entera', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    render(<RemoteConfigProvider><Sonda /></RemoteConfigProvider>);
    await esperar();
    expect(screen.getByTestId('historial')).toHaveTextContent('true');
    expect(screen.getByTestId('tasa')).toHaveTextContent('0.07');
    expect(screen.getByTestId('monedero')).toBeInTheDocument();
  });

  it('con provider, al llegar el bootstrap cada hook pasa al valor remoto', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(bootstrap()), {
      status: 200, headers: { ETag: 'W/"3-PANEL"', 'Content-Type': 'application/json' },
    })));
    render(<RemoteConfigProvider><Sonda /></RemoteConfigProvider>);
    await esperar();
    expect(screen.getByTestId('historial')).toHaveTextContent('false');
    expect(screen.getByTestId('unificada')).toHaveTextContent('true');
    expect(screen.getByTestId('garantias')).toHaveTextContent('1 año');
    expect(screen.getByTestId('tasa')).toHaveTextContent('0.1');
    expect(screen.getByTestId('marcas')).toHaveTextContent('1');
    expect(screen.queryByTestId('monedero')).not.toBeInTheDocument();
    expect(screen.getByTestId('soporte')).toBeInTheDocument();
  });

  it('con caché local renderiza con ella desde el primer frame, antes de que responda la red', () => {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ version: 3, data: bootstrap(), guardadoEn: '2026-10-20T10:00:00Z' }));
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    render(<RemoteConfigProvider><Sonda /></RemoteConfigProvider>);
    expect(screen.getByTestId('historial')).toHaveTextContent('false');
    expect(screen.queryByTestId('monedero')).not.toBeInTheDocument();
  });
});

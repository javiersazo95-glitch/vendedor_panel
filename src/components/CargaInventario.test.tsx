import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../utils/session', async (original) => ({
  ...(await original<typeof import('../utils/session')>()),
  getStoredSession: () => ({ sellerId: '1', token: 'token-de-prueba' }),
}));

import { CargaInventario } from './CargaInventario';

/**
 * Fase 8 del plan de auditoría de carga: una sola entrada, "¿Qué tienes?". Desde la carga con Excel
 * unificada son tres caminos: el Excel propio y la plantilla de RepuesTop entran por el mismo.
 */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [], totalPages: 0, currentPage: 0 }) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const abrir = (extra: Partial<React.ComponentProps<typeof CargaInventario>> = {}) => {
  const onAbrirUnoAUno = vi.fn();
  render(
    <CargaInventario isOpen embedded onClose={() => {}} onUploadSuccess={() => {}} onAbrirUnoAUno={onAbrirUnoAUno} {...extra} />,
  );
  return { onAbrirUnoAUno };
};

describe('Cargar inventario: ¿Qué tienes?', () => {
  it('muestra tres caminos: un repuesto, el Excel (propio o la plantilla) y precios y stock', () => {
    abrir();
    expect(screen.getByText('¿Qué tienes?')).toBeInTheDocument();
    for (const titulo of ['Un repuesto', 'Cargar mi inventario con Excel', 'Sólo cambiar precios y stock']) {
      expect(screen.getByRole('button', { name: new RegExp(titulo) })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /^Mi propio Excel/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^La plantilla de RepuesTop/ })).not.toBeInTheDocument();
  });

  it('"Un repuesto" abre el formulario 1 a 1', () => {
    const { onAbrirUnoAUno } = abrir();
    fireEvent.click(screen.getByRole('button', { name: /Un repuesto/ }));
    expect(onAbrirUnoAUno).toHaveBeenCalled();
  });

  it('"Cargar mi inventario con Excel" pregunta si tiene su Excel o quiere la plantilla, y la deja descargar', async () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: /Cargar mi inventario con Excel/ }));
    expect(await screen.findByText('¿Tienes tu propio Excel o prefieres la plantilla de RepuesTop?')).toBeInTheDocument();
    expect(screen.getByText('Tu Excel de inventario')).toBeInTheDocument();
    expect(screen.getByText('Fotos de tus repuestos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Descargar la plantilla/ })).toBeInTheDocument();
  });

  it('con una carga de cada tipo guardada ofrece retomar cualquiera de las dos', async () => {
    const estado = (paso: number, nombre: string) => ({
      v: 1, paso, archivo: { nombre, sha256: 'x', hojaIndex: 0, filaEncabezados: 0, recortado: false, filas: 120 },
      mapping: { oficial: {}, extras: {}, valueMap: {} }, opcionalesVacios: [], fotos: { asignaciones: {}, origen: null, totalDisponibles: 0 },
      vistaPaso4: 'tarjetas', publicacion: null,
    });
    const guardadas = [
      { tipo: 'PLANTILLA', estadoJson: JSON.stringify(estado(3, 'plantilla-llena.xlsx')), paso: 3, version: 1, tieneArchivo: true, imagenes: [], updatedAt: '2026-09-30T10:00:00Z' },
      { tipo: 'MI_EXCEL', estadoJson: JSON.stringify(estado(3, 'lista-octubre.xlsx')), paso: 3, version: 2, tieneArchivo: true, imagenes: [], updatedAt: '2026-09-29T18:05:00Z' },
    ];
    vi.mocked(fetch).mockImplementation(async (url) => (String(url).includes('borrador-carga/todos')
      ? { ok: true, status: 200, json: async () => guardadas }
      : { ok: true, status: 200, json: async () => ({ content: [] }) }) as Response);
    abrir();
    const plantilla = await screen.findByRole('region', { name: 'Carga sin terminar: Plantilla de RepuesTop' });
    expect(plantilla).toHaveTextContent('plantilla-llena.xlsx');
    // En la plantilla la etapa interna 3 es el paso 2 de 3.
    expect(plantilla).toHaveTextContent('Ibas en el paso 2 de 3: Corrige');
    const propio = screen.getByRole('region', { name: 'Carga sin terminar: Tu propio Excel' });
    expect(propio).toHaveTextContent('lista-octubre.xlsx');
    expect(propio).toHaveTextContent('Ibas en el paso 3 de 4: Completa');
    expect(screen.getAllByRole('button', { name: /Continuar donde quedé/ })).toHaveLength(2);
    expect(screen.getByRole('heading', { name: /Tienes 2 cargas sin terminar/ })).toBeInTheDocument();
  });

  it('"Sólo cambiar precios y stock" abre ese modo', () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: /Sólo cambiar precios y stock/ }));
    expect(screen.getByRole('button', { name: /Descargar mis productos/ })).toBeInTheDocument();
  });

  it('bajo la pregunta muestra las últimas cargas y lleva al historial', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ id: 5, modo: 'EXPRESS', estado: 'CON_ERRORES', productosCargados: 1, productosConError: 1, createdAt: '2026-09-23T13:52:00Z' }],
        totalPages: 1,
        currentPage: 0,
      }),
    } as Response);
    const onVerHistorial = vi.fn();
    abrir({ onVerHistorial });

    expect(await screen.findByText('Tus últimas cargas')).toBeInTheDocument();
    expect(screen.getByText('Cambiar precios y stock')).toBeInTheDocument();
    expect(screen.getByText(/1 por corregir/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ver todo el historial/ }));
    expect(onVerHistorial).toHaveBeenCalled();
  });

  it('el historial muestra todas las cargas en un solo lugar', async () => {
    abrir({ vista: 'historial' });
    expect(screen.getByText('Historial de cargas')).toBeInTheDocument();
    expect(await screen.findByText('Todavía no has cargado ningún archivo.')).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/excel/cargas?') && !String(url).includes('modo='))).toBe(true);
  });
});

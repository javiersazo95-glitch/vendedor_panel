import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../utils/session', async (original) => ({
  ...(await original<typeof import('../utils/session')>()),
  getStoredSession: () => ({ sellerId: '1', token: 'token-de-prueba' }),
}));

import { CargaInventario } from './CargaInventario';

/**
 * Fase 8 del plan de auditoría de carga: una sola entrada, "¿Qué tienes?", con los cuatro caminos.
 * Antes eran cuatro nombres distintos y había que descubrir pestañas dentro de otras pantallas.
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
  it('muestra los cuatro caminos', () => {
    abrir();
    expect(screen.getByText('¿Qué tienes?')).toBeInTheDocument();
    for (const titulo of ['Un repuesto', 'Mi propio Excel', 'La plantilla de RepuesTop', 'Sólo cambiar precios y stock']) {
      expect(screen.getByRole('button', { name: new RegExp(titulo) })).toBeInTheDocument();
    }
  });

  it('"Un repuesto" abre el formulario 1 a 1', () => {
    const { onAbrirUnoAUno } = abrir();
    fireEvent.click(screen.getByRole('button', { name: /Un repuesto/ }));
    expect(onAbrirUnoAUno).toHaveBeenCalled();
  });

  it('"Mi propio Excel" abre el asistente de 4 pasos para subir el archivo del vendedor', async () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: /Mi propio Excel/ }));
    expect(await screen.findByText('Carga tu inventario desde tu propio Excel')).toBeInTheDocument();
    expect(screen.getByText('Tu Excel de inventario')).toBeInTheDocument();
    expect(screen.getByText('Fotos de tus repuestos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Descargar la plantilla/ })).not.toBeInTheDocument();
  });

  it('con una carga guardada ofrece "Retomar desde el punto guardado" en la pregunta', async () => {
    const estado = {
      v: 1, paso: 3, archivo: { nombre: 'lista-octubre.xlsx', sha256: 'x', hojaIndex: 0, filaEncabezados: 0, recortado: false, filas: 120 },
      mapping: { oficial: {}, extras: {}, valueMap: {} }, opcionalesVacios: [], fotos: { asignaciones: {}, origen: null, totalDisponibles: 0 },
      vistaPaso4: 'tarjetas', publicacion: null,
    };
    vi.mocked(fetch).mockImplementation(async (url) => (String(url).includes('borrador-carga')
      ? { ok: true, status: 200, json: async () => ({ estadoJson: JSON.stringify(estado), paso: 3, version: 2, tieneArchivo: true, imagenes: [], updatedAt: '2026-09-29T18:05:00Z' }) }
      : { ok: true, status: 200, json: async () => ({ content: [] }) }) as Response);
    abrir();
    expect(await screen.findByText(/Tienes una carga de "Mi propio Excel" guardada/)).toBeInTheDocument();
    expect(screen.getByText(/lista-octubre\.xlsx/)).toBeInTheDocument();
    expect(screen.getByText(/ibas en el paso 3: Completa/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retomar desde el punto guardado/ })).toBeInTheDocument();
  });

  it('"La plantilla de RepuesTop" ofrece descargarla y se puede volver a la pregunta', () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: /La plantilla de RepuesTop/ }));
    expect(screen.getByRole('button', { name: /Descargar la plantilla/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Elegir otra forma de cargar/ }));
    expect(screen.getByText('¿Qué tienes?')).toBeInTheDocument();
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

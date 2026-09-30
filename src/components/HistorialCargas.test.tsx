import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../utils/session', async (original) => ({
  ...(await original<typeof import('../utils/session')>()),
  getStoredSession: () => ({ sellerId: '1', token: 'token-de-prueba' }),
}));

import { HistorialCargas } from './HistorialCargas';

/**
 * Validación previa al push: una carga que falló entera (sin filas) sólo trae el motivo en
 * `errores`, y el detalle del historial no lo mostraba: decía "0 repuestos quedaron listos" y nada más.
 */
describe('Historial de cargas: detalle de una carga que falló entera', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const texto = String(url);
      if (texto.includes('/excel/cargas/5')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            totalFilas: 0, productosCargados: 0, productosConError: 0, productosConAdvertencia: 0,
            errores: ['El archivo no trae la hoja "inventario".'], filas: [],
          }),
        };
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          content: [{ id: 5, archivoNombre: 'inventario.xlsx', estado: 'ERROR', modo: 'COMPLETA', totalFilas: 0,
            productosCargados: 0, productosConError: 0, productosConAdvertencia: 0, createdAt: '2026-09-29T15:00:00Z' }],
          totalPages: 1, currentPage: 0,
        }),
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('muestra el motivo que mandó el servidor', async () => {
    render(<HistorialCargas />);
    fireEvent.click(await screen.findByRole('button', { name: /Ver detalle/ }));

    expect(await screen.findByText('El archivo no trae la hoja "inventario".')).toBeInTheDocument();
    expect(screen.getByText('Por qué no se cargó:')).toBeInTheDocument();
  });
});

/** El detalle muestra en una tabla todo lo que se cargó, no sólo lo que falló. */
describe('Historial de cargas: tabla resumen del detalle', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const texto = String(url);
      if (texto.includes('/excel/cargas/9')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            totalFilas: 3, productosCargados: 2, productosConError: 1, productosConAdvertencia: 1,
            filas: [
              { fila: 2, sku: 'PF-100', estado: 'OK', mensajes: [], productoId: 7 },
              { fila: 3, sku: 'PF-101', estado: 'ADVERTENCIA', mensajes: ['El motor no está en el catálogo.'], productoId: 8 },
              { fila: 4, sku: 'CR-400', estado: 'ERROR', mensajes: ['Falta la categoría.'], productoId: null },
            ],
          }),
        };
      }
      if (/\/inventario$/.test(texto)) {
        return {
          ok: true, status: 200,
          json: async () => ([
            { id: 7, skuProveedor: 'PF-100', nombrePublicado: 'Pastilla de freno', categoria: 'Frenos', precio: 24990, stock: 5 },
            { id: 8, skuProveedor: 'PF-101', nombrePublicado: 'Disco de freno', categoria: 'Frenos', precio: 39990, stock: 2 },
          ]),
        };
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          content: [{ id: 9, archivoNombre: 'lista.xlsx', estado: 'CON_ERRORES', modo: 'COMPLETA', totalFilas: 3,
            productosCargados: 2, productosConError: 1, productosConAdvertencia: 1, createdAt: '2026-09-29T15:00:00Z' }],
          totalPages: 1, currentPage: 0,
        }),
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('lista cada fila con su repuesto, precio, stock y resultado, y se puede filtrar', async () => {
    render(<HistorialCargas />);
    fireEvent.click(await screen.findByRole('button', { name: /Ver detalle/ }));
    const tabla = await screen.findByRole('table', { name: 'Lo que se cargó' });
    expect(await within(tabla).findByText('Pastilla de freno')).toBeInTheDocument();
    expect(within(tabla).getByText('Disco de freno')).toBeInTheDocument();
    expect(within(tabla).getByText('No se creó')).toBeInTheDocument();
    expect(within(tabla).getByText('Cargado con aviso')).toBeInTheDocument();
    expect(within(tabla).getByText('Falta la categoría.')).toBeInTheDocument();
    expect(within(tabla).getByText(/24\.990/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'No se cargaron (1)' }));
    expect(within(tabla).queryByText('Pastilla de freno')).not.toBeInTheDocument();
    expect(within(tabla).getByText('CR-400')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Descargar resumen en Excel/ })).toBeInTheDocument();
  });
});

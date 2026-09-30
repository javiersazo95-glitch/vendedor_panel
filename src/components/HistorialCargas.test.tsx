import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

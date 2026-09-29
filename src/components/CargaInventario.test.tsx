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

  it('"Mi propio Excel" entra directo a leer el archivo del vendedor', async () => {
    abrir();
    fireEvent.click(screen.getByRole('button', { name: /Mi propio Excel/ }));
    expect(await screen.findByText('Publicar desde mi propio Excel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Descargar la plantilla/ })).not.toBeInTheDocument();
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

  it('el historial muestra todas las cargas en un solo lugar', async () => {
    abrir({ vista: 'historial' });
    expect(screen.getByText('Historial de cargas')).toBeInTheDocument();
    expect(await screen.findByText('Todavía no has cargado ningún archivo.')).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/excel/cargas?') && !String(url).includes('modo='))).toBe(true);
  });
});

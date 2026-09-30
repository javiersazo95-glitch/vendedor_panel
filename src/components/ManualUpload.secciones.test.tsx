import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Product } from '../db';
import { ManualUpload } from './ManualUpload';

/**
 * Fase 7 del plan de auditoría de carga: el 1 a 1 para personas mayores. El formulario dice qué
 * falta sección por sección, no publica con Enter a medio llenar, explica el chasis antes de
 * cambiar el precio y confirma lo publicado en pantalla.
 */
const CATALOGO: Record<string, unknown> = {
  'categorias-repuesto': [{ id: 1, nombre: 'Frenos' }],
  'marcas-repuesto': [{ id: 1, nombre: 'Bosch' }],
  'marcas-vehiculo': [],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const clave = Object.keys(CATALOGO).find((ruta) => String(url).includes(ruta));
    return { ok: true, status: 200, json: async () => (clave ? CATALOGO[clave] : []) };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const abrir = (onSave = vi.fn(async () => {})) => {
  render(<ManualUpload isOpen onClose={() => {}} onSave={onSave} editProduct={null} />);
  return onSave;
};

const escribir = (placeholder: string, valor: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: valor } });

async function completarLoObligatorio() {
  escribir('Ej. Pastillas de freno delanteras', 'Pastilla de freno');
  const categoria = screen.getByLabelText('Categoría');
  await waitFor(() => expect(categoria.querySelectorAll('option').length).toBeGreaterThan(1));
  fireEvent.change(categoria, { target: { value: 'Frenos' } });
  fireEvent.change(screen.getByLabelText('Marca del repuesto'), { target: { value: 'Bosch' } });
  escribir('Ej. PFD1234', 'PF-100');
  escribir('0', '24990');
  fireEvent.click(screen.getByLabelText('Compatibilidad universal'));
  escribir('Describe el repuesto: para qué sirve, medidas, qué incluye...', 'Pastilla de freno delantera cerámica');
}

describe('1 a 1 por secciones', () => {
  it('al publicar vacío dice qué falta en cada sección y no guarda', async () => {
    const onSave = abrir();

    fireEvent.click(screen.getByRole('button', { name: 'Publicar repuesto' }));

    expect(await screen.findByText('Falta: nombre, categoría, marca del repuesto, código (SKU).')).toBeInTheDocument();
    expect(screen.getByText('Falta: precio.')).toBeInTheDocument();
    expect(screen.getByText('Falta: marca del vehículo.')).toBeInTheDocument();
    expect(screen.getByText(`Falta: descripción (mínimo 15 letras).`)).toBeInTheDocument();
    expect(screen.getAllByText(/Faltan datos en "Información básica"/).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('cada sección muestra cuántos datos le faltan y "Listo" cuando está completa', async () => {
    abrir();
    expect(screen.getByText('Faltan 4 datos')).toBeInTheDocument();

    await completarLoObligatorio();

    expect(screen.getAllByText('Listo')).toHaveLength(4);
  });

  it('la descripción cuenta en vivo cuántas letras faltan', () => {
    abrir();
    const descripcion = screen.getByPlaceholderText('Describe el repuesto: para qué sirve, medidas, qué incluye...');

    fireEvent.change(descripcion, { target: { value: 'Pastilla' } });
    expect(screen.getByText('Escribe al menos 7 letras más.')).toBeInTheDocument();

    fireEvent.change(descripcion, { target: { value: 'Pastilla de freno cerámica' } });
    expect(screen.getByText('26/1000')).toBeInTheDocument();
  });

  it('el chasis se explica antes de elegirlo y siempre hay un botón para volver atrás', () => {
    abrir();
    expect(screen.getByText(/el precio no se muestra: el comprador te pide cotización con su número de chasis/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Sí' }));
    expect(screen.getByText(/este repuesto va/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'No necesito el chasis' }));
    expect(screen.getByRole('radio', { name: 'No' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: 'No necesito el chasis' })).not.toBeInTheDocument();
  });

  it('Enter en un campo de texto no publica el repuesto', async () => {
    const onSave = abrir();
    await completarLoObligatorio();

    fireEvent.keyDown(screen.getByPlaceholderText('Ej. PFD1234'), { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('al publicar confirma en pantalla y deja publicar otro', async () => {
    const onSave = abrir();
    await completarLoObligatorio();

    fireEvent.click(screen.getByRole('button', { name: 'Publicar repuesto' }));

    expect(await screen.findByText('Listo: publicaste tu repuesto')).toBeInTheDocument();
    const [payload] = onSave.mock.calls[0] as unknown as [Product];
    expect(payload).toMatchObject({ name: 'Pastilla de freno', sku: 'PF-100', esUniversal: true, price: 24990 });

    fireEvent.click(screen.getByRole('button', { name: 'Publicar otro repuesto' }));
    expect((screen.getByPlaceholderText('Ej. Pastillas de freno delanteras') as HTMLInputElement).value).toBe('');
  });

  it('"Ver en inventario" lleva al inventario y no solo cierra el modal (H47)', async () => {
    const onClose = vi.fn();
    const onVerInventario = vi.fn();
    render(<ManualUpload isOpen onClose={onClose} onVerInventario={onVerInventario}
      onSave={vi.fn(async () => {})} editProduct={null} />);
    await completarLoObligatorio();
    fireEvent.click(screen.getByRole('button', { name: 'Publicar repuesto' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Ver en inventario' }));

    expect(onVerInventario).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('un universal nuevo puede llevar número OEM', async () => {
    const onSave = abrir();
    await completarLoObligatorio();
    escribir('Ej. 04465-0K090', '04465-0k090');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar repuesto' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [payload] = onSave.mock.calls[0] as unknown as [Product];
    expect(payload.oem).toBe('04465-0K090');
  });
});

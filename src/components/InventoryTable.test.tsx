import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InventoryTable } from './InventoryTable';
import type { Product } from '../db';
import '@testing-library/jest-dom';

const mockProducts: Product[] = [
  {
    id: '1',
    sku: 'TEST-SKU-1',
    oem: 'OEM-123',
    name: 'Repuesto Test 1',
    category: 'Motor',
    partBrand: 'TestBrand',
    vehicleBrand: 'Toyota',
    vehicleModel: 'Yaris',
    vehicleYear: 2018,
    vehicleVersion: '1.5',
    price: 10000,
    stock: 5,
    description: 'Test description',
    image: '',
    activo: true
  }
];

function makeProducts(count: number): Product[] {
  return Array.from({ length: count }, (_, i) => ({
    ...mockProducts[0],
    id: String(i + 1),
    sku: `SKU-${i + 1}`,
    name: `Repuesto ${i + 1}`,
  }));
}

describe('InventoryTable', () => {
  it('renders products correctly', () => {
    render(
      <InventoryTable
        products={mockProducts}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTogglePause={vi.fn()}
      />
    );
    expect(screen.getByText('TEST-SKU-1')).toBeInTheDocument();
    expect(screen.getByText('Repuesto Test 1')).toBeInTheDocument();
  });

  it('dice que un repuesto universal es universal, en vez de un auto vacío con un año inventado', () => {
    const universal: Product = {
      ...mockProducts[0],
      esUniversal: true,
      // Como llega de la API un repuesto sin compatibilidad vehicular.
      vehicleBrand: '',
      vehicleModel: '',
      vehicleYear: 0,
      vehicleVersion: '',
    };

    render(
      <InventoryTable
        products={[universal]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTogglePause={vi.fn()}
      />
    );

    expect(screen.getByText('Compatibilidad universal')).toBeInTheDocument();
    // El año actual aparecía acá cuando el panel lo rellenaba solo.
    expect(screen.queryByText(new RegExp(String(new Date().getFullYear())))).not.toBeInTheDocument();
  });

  it('no deja un guión suelto cuando el repuesto no trae año ni motor', () => {
    const sinDatos: Product = {
      ...mockProducts[0],
      vehicleYear: 0,
      vehicleVersion: '',
    };

    render(
      <InventoryTable
        products={[sinDatos]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTogglePause={vi.fn()}
      />
    );

    // El auto sí se muestra; lo que no hay no se dibuja. Antes esta celda mostraba "0 - ",
    // con el 0 del año ausente y un guión que no separaba nada.
    expect(screen.getByText('Toyota Yaris')).toBeInTheDocument();
    expect(screen.queryByText(/0\s*-/)).not.toBeInTheDocument();
  });

  it('re-slices the current page when itemsPerPage changes while staying on page 1 (QA-SRC-003)', () => {
    render(
      <InventoryTable
        products={makeProducts(20)}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTogglePause={vi.fn()}
      />
    );

    // Default itemsPerPage is 15, so 15 rows should be visible on page 1.
    expect(screen.getAllByText(/^SKU-/)).toHaveLength(15);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } });

    // Staying on page 1 but with itemsPerPage now 5 must re-slice the table
    // immediately, without requiring an unrelated page change first.
    expect(screen.getAllByText(/^SKU-/)).toHaveLength(5);
  });

  it('makes a current Top product explicit in the row and opens its management action', () => {
    const onManageTop = vi.fn();
    render(<InventoryTable products={[{ ...mockProducts[0], destacado: true, topHasta: new Date(Date.now() + 86_400_000 * 3).toISOString() }]} onEdit={vi.fn()} onDelete={vi.fn()} onTogglePause={vi.fn()} onManageTop={onManageTop} />);
    expect(screen.getByText(/Producto Top/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Renovar producto Top'));
    expect(onManageTop).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });
});

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
});

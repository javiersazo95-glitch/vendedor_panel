import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});

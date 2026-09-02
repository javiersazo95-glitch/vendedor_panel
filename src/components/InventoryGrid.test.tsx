import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InventoryGrid } from './InventoryGrid';
import type { Product } from '../db';

const product: Product = { id: '42', sku: 'GRID-42', oem: '', name: 'Bujía de prueba', category: 'Motor', partBrand: '', vehicleBrand: '', vehicleModel: '', vehicleYear: 2024, vehicleVersion: '', price: 12500, stock: 8, description: '', image: '/imagen.png', destacado: true, topHasta: new Date(Date.now() + 86_400_000).toISOString() };

describe('InventoryGrid', () => {
  it('shows product information, its Top badge and all four actions', () => {
    const onEdit = vi.fn(); const onTop = vi.fn(); const onPause = vi.fn();
    render(<InventoryGrid products={[product]} onEdit={onEdit} onManageTop={onTop} onTogglePause={onPause} onDelete={vi.fn()} />);
    expect(screen.getByText('Bujía de prueba')).toBeInTheDocument();
    expect(screen.getByText('$12.500')).toBeInTheDocument();
    expect(screen.getByText(/Producto Top/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Gestionar Top: Bujía de prueba'));
    expect(onTop).toHaveBeenCalledWith(product);
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });
});

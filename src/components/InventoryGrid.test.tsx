import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InventoryGrid } from './InventoryGrid';
import type { Product } from '../db';

const product: Product = { id: '42', sku: 'GRID-42', oem: '', name: 'Bujía de prueba', category: 'Motor', partBrand: '', vehicleBrand: '', vehicleModel: '', vehicleYear: 2024, vehicleVersion: '', price: 12500, stock: 8, description: '', image: '/imagen.png', destacado: true, topHasta: new Date(Date.now() + 86_400_000).toISOString() };

function makeProducts(count: number): Product[] {
  return Array.from({ length: count }, (_, i) => ({
    ...product,
    id: String(i + 1),
    sku: `GRID-${i + 1}`,
    name: `Repuesto ${i + 1}`,
    destacado: false,
    topHasta: undefined,
  }));
}

describe('InventoryGrid', () => {
  it('shows product information, its Top badge and all four actions', () => {
    const onEdit = vi.fn(); const onTop = vi.fn(); const onPause = vi.fn();
    render(<InventoryGrid products={[product]} onEdit={onEdit} onManageTop={onTop} onTogglePause={onPause} onDelete={vi.fn()} />);
    expect(screen.getByText('Bujía de prueba')).toBeInTheDocument();
    expect(screen.getByText('$12.500')).toBeInTheDocument();
    expect(screen.getByText(/Producto Top/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Gestionar Top: Bujía de prueba'));
    expect(onTop).toHaveBeenCalledWith(product);
    // Las 4 acciones de la tarjeta más los 2 botones de paginación (Anterior/Siguiente).
    expect(screen.getAllByRole('button')).toHaveLength(6);
  });

  /**
   * El bug real: con un catálogo de miles de repuestos, la cuadrícula montaba una tarjeta
   * -con su imagen y sus cuatro botones- por cada uno, de una sola vez. Sin paginar, eso
   * son miles de <img> pidiéndose juntas y el navegador atascándose al hacer scroll.
   */
  it('no monta más tarjetas que las de la página actual, aunque el catálogo tenga miles', () => {
    render(<InventoryGrid products={makeProducts(2950)} onEdit={vi.fn()} onManageTop={vi.fn()} onTogglePause={vi.fn()} onDelete={vi.fn()} />);
    // Página por defecto: 20 tarjetas (múltiplo de las 4 columnas del escritorio).
    expect(screen.getAllByText(/Repuesto \d+/)).toHaveLength(20);
    expect(screen.getByText('Repuesto 1')).toBeInTheDocument();
    expect(screen.queryByText('Repuesto 21')).not.toBeInTheDocument();
    expect(screen.getByText(/Mostrando/)).toHaveTextContent('Mostrando 1 a 20 de 2950 productos.');
  });

  it('avanza de página sin duplicar ni perder repuestos', () => {
    render(<InventoryGrid products={makeProducts(45)} onEdit={vi.fn()} onManageTop={vi.fn()} onTogglePause={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(screen.queryByText('Repuesto 1')).not.toBeInTheDocument();
    expect(screen.getByText('Repuesto 21')).toBeInTheDocument();
    expect(screen.getByText('Pág. 2 de 3')).toBeInTheDocument();
  });

  it('deja elegir cuántas tarjetas mostrar por página', () => {
    render(<InventoryGrid products={makeProducts(45)} onEdit={vi.fn()} onManageTop={vi.fn()} onTogglePause={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '40' } });
    expect(screen.getAllByText(/Repuesto \d+/)).toHaveLength(40);
    expect(screen.getByText('Repuesto 40')).toBeInTheDocument();
  });
});

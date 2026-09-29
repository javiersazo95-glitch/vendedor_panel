import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as XLSX from 'xlsx';
import type { Product } from '../db';
import { analizarExpress, detectarColumnasExpress, itemsParaEnviar } from '../utils/expressPreciosStock';

const { getAllProducts, savePreciosStockBatch } = vi.hoisted(() => ({
  getAllProducts: vi.fn(),
  savePreciosStockBatch: vi.fn(),
}));
vi.mock('../db', () => ({ getAllProducts, savePreciosStockBatch }));

import { ExpressUpload } from './ExpressUpload';

/**
 * Fase 6 del plan de auditoría de carga: "Cambiar precios y stock" (antes Express).
 *
 * Antes el precio se leía con Number(): "4.990" quedaba en 4,99 pesos y pasaba en verde; los
 * encabezados tenían que ser exactamente sku/precio/stock; y un producto "Sólo cotizar" no se
 * podía actualizar porque su precio 0 era un error.
 */
const producto = (sku: string, extra: Partial<Product> = {}): Product => ({
  id: sku,
  sku,
  oem: '',
  name: `Repuesto ${sku}`,
  category: 'Frenos',
  partBrand: 'Bosch',
  vehicleBrand: '',
  vehicleModel: '',
  vehicleYear: 0,
  vehicleVersion: '',
  price: 10000,
  stock: 5,
  description: '',
  image: '',
  pricingMode: 'show_price',
  ...extra,
});

const COLUMNAS = { sku: 0, precio: 1, stock: 2 };

describe('lectura del archivo de precios y stock', () => {
  it('reconoce "Código / Precio Venta / Cantidad"', () => {
    expect(detectarColumnasExpress(['Código', 'Nombre', 'Precio Venta', 'Cantidad'])).toEqual({ sku: 0, precio: 2, stock: 3 });
    expect(detectarColumnasExpress(['sku', 'precio', 'stock'])).toEqual({ sku: 0, precio: 1, stock: 2 });
    expect(detectarColumnasExpress(['Nombre', 'Precio']).sku).toBeNull();
  });

  it('"4.990" es 4990 y avisa con el número final', () => {
    const { cambios, retenidas } = analizarExpress([['PF-1', '4.990', '5']], COLUMNAS, [producto('PF-1')]);
    expect(retenidas).toEqual([]);
    expect(cambios[0].precioDespues).toBe(4990);
    expect(cambios[0].avisos.join(' ')).toContain('$4.990');
  });

  it('"$ 12.900" y "8 unid" se leen sin problema', () => {
    const { cambios } = analizarExpress([['PF-1', '$ 12.900', '8 unid']], COLUMNAS, [producto('PF-1')]);
    expect(cambios[0]).toMatchObject({ precioDespues: 12900, stockDespues: 8 });
  });

  it('"4,99" se retiene: un precio en pesos no lleva decimales', () => {
    const { cambios, retenidas } = analizarExpress([['PF-1', '4,99', '5']], COLUMNAS, [producto('PF-1')]);
    expect(cambios).toEqual([]);
    expect(retenidas[0].motivo).toContain('decimales');
  });

  it('un stock que no es entero se retiene', () => {
    const { retenidas } = analizarExpress([['PF-1', '1000', '1,5']], COLUMNAS, [producto('PF-1')]);
    expect(retenidas[0].motivo).toContain('entero');
  });

  it('un "Sólo cotizar" sin precio se actualiza sólo en stock', () => {
    const cotizar = producto('QC-1', { pricingMode: 'quote_only', price: 0 });
    const { cambios, retenidas } = analizarExpress([['QC-1', '', '12']], COLUMNAS, [cotizar]);
    expect(retenidas).toEqual([]);
    expect(itemsParaEnviar(cambios)).toEqual([{ skuProveedor: 'QC-1', precio: null, stock: 12 }]);
  });

  it('un "Sólo cotizar" con precio lo guarda y avisa que sigue a cotizar', () => {
    const cotizar = producto('QC-1', { pricingMode: 'quote_only', price: 0 });
    const { cambios } = analizarExpress([['QC-1', '15000', '']], COLUMNAS, [cotizar]);
    expect(cambios[0].precioDespues).toBe(15000);
    expect(cambios[0].avisos.join(' ')).toContain('Sólo cotizar');
  });

  it('un código que no está en el inventario se omite con aviso, sin retener las demás', () => {
    const { cambios, noEncontrados } = analizarExpress(
      [['NO-EXISTE', '1000', '1'], ['PF-1', '2000', '2']],
      COLUMNAS,
      [producto('PF-1')],
    );
    expect(noEncontrados.map((f) => f.sku)).toEqual(['NO-EXISTE']);
    expect(cambios.map((c) => c.sku)).toEqual(['PF-1']);
  });

  it('un producto pausado se actualiza y se avisa que sigue pausado', () => {
    const { cambios } = analizarExpress([['PF-1', '2000', '2']], COLUMNAS, [producto('PF-1', { pausado: true })]);
    expect(cambios[0].avisos.join(' ')).toContain('pausado');
  });

  it('sólo se manda lo que cambia, y lo que ya estaba igual no cuenta como cambio', () => {
    const { cambios, sinCambios } = analizarExpress(
      [['PF-1', '10000', '9'], ['PF-2', '10000', '5']],
      COLUMNAS,
      [producto('PF-1'), producto('PF-2')],
    );
    expect(itemsParaEnviar(cambios)).toEqual([{ skuProveedor: 'PF-1', precio: null, stock: 9 }]);
    expect(sinCambios).toBe(1);
  });

  it('un código repetido se retiene y se usa sólo la primera vez', () => {
    const { cambios, retenidas } = analizarExpress([['PF-1', '2000', '2'], ['pf-1', '3000', '3']], COLUMNAS, [producto('PF-1')]);
    expect(cambios).toHaveLength(1);
    expect(retenidas[0].fila).toBe(3);
  });
});

describe('pantalla "Cambiar precios y stock"', () => {
  beforeEach(() => {
    getAllProducts.mockResolvedValue([
      producto('PF-100', { name: 'Pastilla de freno', price: 11000, stock: 3 }),
      producto('QC-1', { name: 'Culata', pricingMode: 'quote_only', price: 0, stock: 1 }),
    ]);
    savePreciosStockBatch.mockImplementation(async (items: { skuProveedor: string }[]) => ({
      totalFilas: items.length,
      productosCargados: items.length,
      productosConError: 0,
      filas: items.map((item, i) => ({ fila: i + 1, sku: item.skuProveedor, estado: 'OK', mensajes: [] })),
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const subir = (file: File) => {
    fireEvent.change(screen.getByLabelText('Elegir archivo de precios y stock'), { target: { files: [file] } });
  };

  it('un Excel con "Código / Precio Venta / Cantidad" y "$ 12.900" se confirma en una pantalla', async () => {
    const onExpressSuccess = vi.fn();
    const hoja = XLSX.utils.aoa_to_sheet([
      ['Código', 'Precio Venta', 'Cantidad'],
      ['PF-100', '$ 12.900', 8],
      ['QC-1', '', 4],
    ]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Hoja1');
    const bytes = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
    render(<ExpressUpload isOpen embedded onClose={() => {}} onUploadSuccess={() => {}} onExpressSuccess={onExpressSuccess} onSwitchToFull={() => {}} />);

    subir(new File([bytes], 'precios.xlsx'));

    expect(await screen.findByText('Revisa los cambios antes de guardarlos')).toBeInTheDocument();
    expect(screen.getByText('$12.900')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 2 cambios' }));

    await waitFor(() => expect(onExpressSuccess).toHaveBeenCalledWith(2));
    expect(savePreciosStockBatch).toHaveBeenCalledWith([
      { skuProveedor: 'PF-100', precio: 12900, stock: 8 },
      { skuProveedor: 'QC-1', precio: null, stock: 4 },
    ]);
  });

  it('si quedan filas fuera no manda al inventario: muestra cuáles y por qué', async () => {
    const onExpressSuccess = vi.fn();
    const csv = 'sku,precio,stock\nPF-100,"4,99",8\nNO-EXISTE,1000,1\nQC-1,,2\n';
    render(<ExpressUpload isOpen embedded onClose={() => {}} onUploadSuccess={() => {}} onExpressSuccess={onExpressSuccess} onSwitchToFull={() => {}} />);

    subir(new File([csv], 'precios.csv', { type: 'text/csv' }));

    expect(await screen.findByText(/1 fila no se va a guardar/)).toBeInTheDocument();
    expect(screen.getByText(/1 código no está en tu inventario/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 cambio' }));

    expect(await screen.findByText('Se guardó 1 cambio.')).toBeInTheDocument();
    expect(onExpressSuccess).not.toHaveBeenCalled();
    expect(savePreciosStockBatch).toHaveBeenCalledWith([{ skuProveedor: 'QC-1', precio: null, stock: 2 }]);
  });

  it('sin columna de código lo dice con las columnas que sí trae el archivo', async () => {
    render(<ExpressUpload isOpen embedded onClose={() => {}} onUploadSuccess={() => {}} onSwitchToFull={() => {}} />);

    subir(new File(['Nombre,Precio\nPastilla,1000\n'], 'precios.csv', { type: 'text/csv' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('«Nombre», «Precio»');
    expect(savePreciosStockBatch).not.toHaveBeenCalled();
  });
});

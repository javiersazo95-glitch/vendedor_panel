import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../utils/session', async (original) => ({
  ...(await original<typeof import('../utils/session')>()),
  getStoredSession: () => ({ sellerId: '1', token: 'token-de-prueba' }),
}));
vi.mock('../remoteConfig/hooks', async (original) => ({
  ...(await original<typeof import('../remoteConfig/hooks')>()),
  useFlag: (clave: string, fallback = true) => (clave === 'global.ficha-codigo' ? flag : fallback),
}));

import type { Product } from '../db';
import { ManualUpload } from './ManualUpload';

let flag = true;
const FICHA = {
  fichaId: 9, codigo: 'GDB 3424', marca: 'TRW', nombre: 'Juego de pastillas de freno', confianza: 'ALTA', verificada: false,
  categoria: 'Frenos', subcategoria: 'Pastillas de Freno', categoriaExterna: null, referenciaOem: '04465-02220',
  compatibilidad: {
    grupos: [
      { marca: 'Toyota', modelo: 'Corolla', anioDesde: 2009, anioHasta: 2014, motor: '1.6', vehiculoCatalogoIds: [11, 12], versiones: ['GLI', 'XEI'], segura: true },
      { marca: 'Toyota', modelo: 'Auris', anioDesde: 2008, anioHasta: 2012, motor: '', vehiculoCatalogoIds: [20], versiones: ['LEI'], segura: false },
    ],
    fueraDeCatalogo: ['Toyota Verso'],
  },
};
let respuesta: unknown;
let pedidos: string[];

beforeEach(() => {
  flag = true;
  pedidos = [];
  localStorage.clear();
  respuesta = { estado: 'RECONOCIDO', mensaje: null, opciones: [], ficha: FICHA };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/inventario/codigos')) { pedidos.push(u); return { ok: true, status: 200, json: async () => respuesta }; }
    if (u.includes('/subcategorias')) return { ok: true, status: 200, json: async () => [{ id: 5, nombre: 'Pastillas de Freno' }] };
    if (u.includes('categorias-repuesto')) return { ok: true, status: 200, json: async () => [{ id: 1, nombre: 'Frenos' }] };
    if (u.includes('marcas-repuesto')) return { ok: true, status: 200, json: async () => [{ id: 1, nombre: 'Trw' }] };
    return { ok: true, status: 200, json: async () => [] };
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const abrir = (onSave = vi.fn(async () => {})) => {
  render(<ManualUpload isOpen onClose={() => {}} onSave={onSave} editProduct={null} />);
  return onSave;
};
const buscar = (codigo = 'gdb3424') => {
  const campo = screen.getByLabelText('Código del fabricante');
  fireEvent.change(campo, { target: { value: codigo } });
  fireEvent.keyDown(campo, { key: 'Enter' });
};

describe('autocompletar con el código de la caja', () => {
  it('con el flag apagado el formulario es el de siempre', () => {
    flag = false;
    abrir();
    expect(screen.queryByLabelText('Código del fabricante')).not.toBeInTheDocument();
  });

  it('llena el formulario y sólo falta precio, condición y garantía; publica con el código y las versiones', async () => {
    const onSave = abrir();
    buscar();
    expect(await screen.findByText(/Pusimos 1 vehículo/)).toBeInTheDocument();
    expect(pedidos[0]).toContain('codigo=gdb3424');
    expect(screen.getByDisplayValue('Juego de pastillas de freno TRW GDB 3424')).toBeInTheDocument();
    expect(screen.getByDisplayValue('GDB3424')).toBeInTheDocument();
    expect(screen.getByText('Toyota Corolla')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Nuevo alternativo/ }));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '32990' } });
    fireEvent.change(screen.getByLabelText(/^Garantía/), { target: { value: '1 año' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar repuesto' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [p] = onSave.mock.calls[0] as unknown as [Product];
    expect(p.codigoFabricante).toBe('GDB 3424');
    expect(p.partBrand.toLowerCase()).toBe('trw');
    expect(p.oem).toBe('04465-02220');
    expect(p.vehiculoCatalogoIds).toEqual([11, 12]);
    expect(JSON.parse(p.compatibilityGroupsJson ?? '[]')).toHaveLength(1);
    expect(p.price).toBe(32990);
  });

  it('lo no confirmado sólo entra si el vendedor lo agrega', async () => {
    abrir();
    buscar();
    expect(await screen.findByText(/no los pudimos confirmar/)).toBeInTheDocument();
    expect(screen.queryByText('Toyota Auris')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(screen.getByText('Toyota Auris')).toBeInTheDocument();
    expect(screen.getByText('Toyota Corolla')).toBeInTheDocument();
    expect(screen.getByText(/1 vehículo del fabricante no está/)).toBeInTheDocument();
  });

  it('con varias marcas pregunta cuál', async () => {
    respuesta = { estado: 'ELEGIR_MARCA', mensaje: 'Elige la marca que aparece en la caja.', opciones: [{ marca: 'TRW', nombre: 'Pastillas' }, { marca: 'Otra', nombre: 'Pastillas' }], ficha: null };
    abrir();
    buscar();
    const boton = await screen.findByRole('button', { name: /TRW/ });
    respuesta = { estado: 'RECONOCIDO', mensaje: null, opciones: [], ficha: FICHA };
    fireEvent.click(boton);
    await screen.findByText(/Pusimos 1 vehículo/);
    expect(pedidos[1]).toContain('marca=TRW');
  });

  it('no pisa lo escrito sin preguntar', async () => {
    abrir();
    fireEvent.change(screen.getByPlaceholderText('Ej. Pastillas de freno delanteras'), { target: { value: 'Mi título' } });
    buscar();
    expect(await screen.findByText(/Reemplazará el nombre/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'No, dejar lo mío' }));
    expect(screen.getByDisplayValue('Mi título')).toBeInTheDocument();
  });

  it('si no lo encuentra lo dice y deja publicar a mano', async () => {
    respuesta = { estado: 'NO_ENCONTRADO', mensaje: 'No encontramos este código. Puedes completar los datos tú.', opciones: [], ficha: null };
    abrir();
    buscar('ZZ999');
    expect(await screen.findByText(/No encontramos este código/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ej. Pastillas de freno delanteras')).toHaveValue('');
  });

  it('un vehículo del código se puede editar o quitar', async () => {
    abrir();
    buscar();
    await screen.findByText('Toyota Corolla');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Toyota Auris' }));
    expect(screen.queryByText('Toyota Auris')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Toyota Corolla' }));
    expect(screen.getByText('Vehículo 1')).toBeInTheDocument();
  });
});

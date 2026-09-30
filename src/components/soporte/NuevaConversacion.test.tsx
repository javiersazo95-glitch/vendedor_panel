import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NuevaConversacion } from './NuevaConversacion';
import { publicarContextoSoporte } from '../../utils/contextoSoporte';
import { SoporteApiError } from '../../utils/soporteCargaApi';

const CONTEXTO = { flujo: 'mi-excel' as const, paso: 3, pasoTitulo: 'Completa', archivoNombre: 'inventario.xlsx' };

describe('NuevaConversacion', () => {
  afterEach(() => {
    act(() => publicarContextoSoporte(null));
  });

  it('envia motivo, detalle y el paso en que va el vendedor', async () => {
    act(() => publicarContextoSoporte(CONTEXTO));
    const onCrear = vi.fn().mockResolvedValue('creado');
    render(<NuevaConversacion onCrear={onCrear} />);

    expect(screen.getByText('Mi propio Excel · Paso 3: Completa · inventario.xlsx')).toBeInTheDocument();
    expect(screen.getByLabelText(/adjuntar en qué paso voy/i)).toBeChecked();

    fireEvent.click(screen.getByLabelText('Ayuda para cargar mi inventario'));
    fireEvent.change(screen.getByLabelText('Cuéntanos qué necesitas'), { target: { value: '  No sé qué columna elegir  ' } });
    expect(screen.getByText('28/1000')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /enviar a soporte/i }));

    await waitFor(() => expect(onCrear).toHaveBeenCalledWith('AYUDA_CARGA', 'No sé qué columna elegir', CONTEXTO));
  });

  it('sin la casilla marcada manda contexto null', async () => {
    act(() => publicarContextoSoporte(CONTEXTO));
    const onCrear = vi.fn().mockResolvedValue('creado');
    render(<NuevaConversacion onCrear={onCrear} />);

    fireEvent.click(screen.getByLabelText('Tengo una duda'));
    fireEvent.change(screen.getByLabelText('Cuéntanos qué necesitas'), { target: { value: 'hola' } });
    fireEvent.click(screen.getByLabelText(/adjuntar en qué paso voy/i));
    fireEvent.click(screen.getByRole('button', { name: /enviar a soporte/i }));

    await waitFor(() => expect(onCrear).toHaveBeenCalledWith('DUDA', 'hola', null));
  });

  it('sin contexto publicado no muestra la casilla y manda null', async () => {
    const onCrear = vi.fn().mockResolvedValue('creado');
    render(<NuevaConversacion onCrear={onCrear} />);
    expect(screen.queryByLabelText(/adjuntar en qué paso voy/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Algo no funciona'));
    fireEvent.change(screen.getByLabelText('Cuéntanos qué necesitas'), { target: { value: 'no carga' } });
    fireEvent.click(screen.getByRole('button', { name: /enviar a soporte/i }));
    await waitFor(() => expect(onCrear).toHaveBeenCalledWith('ERROR', 'no carga', null));
  });

  it('pide motivo y texto antes de enviar', () => {
    const onCrear = vi.fn();
    render(<NuevaConversacion onCrear={onCrear} />);

    fireEvent.click(screen.getByRole('button', { name: /enviar a soporte/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Elige el motivo de tu consulta.');

    fireEvent.click(screen.getByLabelText('Otro'));
    fireEvent.click(screen.getByRole('button', { name: /enviar a soporte/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/cuéntanos qué necesitas/i);
    expect(onCrear).not.toHaveBeenCalled();
  });

  it('muestra el error del servidor si no se pudo crear', async () => {
    const onCrear = vi.fn().mockRejectedValue(new SoporteApiError('El detalle es muy largo', 400));
    render(<NuevaConversacion onCrear={onCrear} />);
    fireEvent.click(screen.getByLabelText('Otro'));
    fireEvent.change(screen.getByLabelText('Cuéntanos qué necesitas'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /enviar a soporte/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El detalle es muy largo');
    expect(screen.getByRole('button', { name: /enviar a soporte/i })).toBeEnabled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useState } from 'react';
import { DialogoGuardarCambios } from './DialogoGuardarCambios';
import { useGuardiaDeSalida, type GuardiaSalida } from '../utils/guardiaSalida';

describe('Aviso de cambios sin guardar', () => {
  it('ofrece guardar y salir, salir sin guardar o quedarse', async () => {
    const guardar = vi.fn(async () => true);
    const salir = vi.fn();
    const quedarse = vi.fn();
    render(<DialogoGuardarCambios onGuardarYSalir={guardar} onSalirSinGuardar={salir} onQuedarse={quedarse} />);
    expect(screen.getByRole('alertdialog', { name: '¿Quieres guardar tus cambios?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    expect(quedarse).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }));
    expect(salir).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y salir' }));
    expect(guardar).toHaveBeenCalled();
  });

  it('si no se pudo guardar, lo dice y no sale', async () => {
    render(<DialogoGuardarCambios onGuardarYSalir={async () => false} onSalirSinGuardar={() => {}} onQuedarse={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y salir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar');
  });

  it('la pantalla registra su guardia y el navegador avisa al cerrar la pestaña con cambios', () => {
    let registrada: GuardiaSalida | null = null;
    const Pantalla = () => {
      const [sucio] = useState(true);
      useGuardiaDeSalida((g) => { registrada = g; }, { hayCambiosSinGuardar: () => sucio, guardar: async () => true });
      return null;
    };
    const { unmount } = render(<Pantalla />);
    expect(registrada).not.toBeNull();
    expect(registrada!.hayCambiosSinGuardar()).toBe(true);
    const evento = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
    unmount();
    expect(registrada).toBeNull();
  });
});

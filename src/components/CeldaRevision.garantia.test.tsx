import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CeldaRevision } from './CeldaRevision';
import { GARANTIA_OPCIONES_FALLBACK } from '../utils/garantia';
import { limiteDeColumna } from '../utils/plantillaNormalizacion';

/** Garantía en la tabla del paso 3 (2.4.0): se elige de las opciones comunes o se escribe. */
describe('CeldaRevision: garantía', () => {
  it('la celda vacía ofrece las opciones comunes y acepta una escrita a mano', () => {
    const onCambio = vi.fn();
    render(<CeldaRevision valor="" columna="garantia" opciones={[]} onCambio={onCambio} etiqueta="Garantía" destacada />);

    const input = screen.getByLabelText('Garantía') as HTMLInputElement;
    const lista = document.getElementById(input.getAttribute('list') ?? '');
    expect(lista?.tagName).toBe('DATALIST');
    expect([...(lista?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'))).toEqual([...GARANTIA_OPCIONES_FALLBACK]);
    expect(input.maxLength).toBe(80);

    fireEvent.change(input, { target: { value: '18 meses o 50.000 km' } });
    fireEvent.blur(input);
    expect(onCambio).toHaveBeenCalledWith('18 meses o 50.000 km');
  });

  it('las demás columnas de texto no traen sugerencias', () => {
    render(<CeldaRevision valor="" columna="nombre_publicado" opciones={[]} onCambio={vi.fn()} etiqueta="Nombre" destacada />);
    expect(screen.getByLabelText('Nombre')).not.toHaveAttribute('list');
  });

  it('el tope de la garantía es el de la columna del backend', () => {
    expect(limiteDeColumna('garantia')).toEqual({ maxLength: 80, tipo: 'texto' });
  });
});

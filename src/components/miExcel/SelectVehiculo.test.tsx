import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SelectVehiculo } from './SelectVehiculo';
import type { VersionCatalogo } from '../../utils/catalogoVersiones';

const yaris: VersionCatalogo[] = [
  { id: 1, modelo: 'Yaris', anioDesde: 2014, anioHasta: 2016, motor: '1.3' },
  { id: 2, modelo: 'Yaris', anioDesde: 2017, anioHasta: 2019, motor: '1.5' },
];
const datos: Record<string, string> = { compatibilidad_marca: 'Toyota', compatibilidad_modelo: 'Yaris', anio_desde: '', anio_hasta: '' };
const leer = (c: string) => datos[c] ?? '';

describe('Elegir año o motor del vehículo', () => {
  it('ofrece sólo los años del catálogo y la opción de todos los años del modelo', () => {
    const onElegir = vi.fn();
    render(<SelectVehiculo columna="anio_desde" valor="" etiqueta="Año desde" leer={leer} versiones={yaris} respaldo={['1995']} onElegir={onElegir} />);
    const select = screen.getByRole('combobox', { name: 'Año desde' });
    const opciones = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(opciones).toContain('2014');
    expect(opciones).toContain('2019');
    expect(opciones).not.toContain('1995');
    expect(opciones).not.toContain('2020');
    fireEvent.change(select, { target: { value: '__especial__' } });
    expect(onElegir).toHaveBeenCalledWith({ anio_desde: '2014', anio_hasta: '2019' });
  });

  it('el motor se puede dejar sin asignar', () => {
    const onElegir = vi.fn();
    render(<SelectVehiculo columna="motor" valor="2.0" etiqueta="Motor" leer={leer} versiones={yaris} respaldo={[]} onElegir={onElegir} />);
    const select = screen.getByRole('combobox', { name: 'Motor' });
    expect(within(select).getByRole('option', { name: /No asignar motor/ })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: '1.5' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: '__especial__' } });
    expect(onElegir).toHaveBeenCalledWith({ motor: '' });
  });

  it('siempre es una lista con "Dejar en blanco", aunque falten la marca y el modelo', () => {
    const onElegir = vi.fn();
    const { rerender } = render(<SelectVehiculo columna="motor" valor="" etiqueta="Motor" leer={() => ''} versiones={yaris} respaldo={[]} onElegir={onElegir} />);
    const select = screen.getByRole('combobox', { name: 'Motor' });
    expect(within(select).getByRole('option', { name: 'Dejar en blanco' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: /Primero elige la marca y el modelo/ })).toBeDisabled();

    rerender(<SelectVehiculo columna="anio_desde" valor="2015" etiqueta="Año desde" leer={leer} versiones={yaris} respaldo={[]} onElegir={onElegir} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Año desde' }), { target: { value: '' } });
    expect(onElegir).toHaveBeenCalledWith({ anio_desde: '', anio_hasta: '' });
  });

  it('sin marca y modelo pide elegirlos primero; un modelo sin versiones lo dice', () => {
    const { rerender } = render(<SelectVehiculo columna="anio_desde" valor="" etiqueta="Año" leer={() => ''} versiones={yaris} respaldo={[]} onElegir={() => {}} />);
    expect(screen.getByText(/Primero elige la marca y el modelo/)).toBeInTheDocument();
    rerender(<SelectVehiculo columna="anio_desde" valor="" etiqueta="Año" leer={leer} versiones={[]} respaldo={[]} onElegir={() => {}} />);
    expect(screen.getByText(/no tiene versiones en el catálogo/)).toBeInTheDocument();
  });
});

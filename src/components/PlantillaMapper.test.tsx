import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as XLSX from 'xlsx';
import { PlantillaMapper } from './PlantillaMapper';
import { PLANTILLA_COLUMNAS } from '../utils/plantillaMapping';

/** Lee el .xlsx generado (File) y devuelve la matriz de la primera hoja. */
async function readGeneratedFile(file: File): Promise<unknown[][]> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
  const wb = XLSX.read(buffer, { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
}

const CSV = [
  'Codigo,Titulo,Marca,Precio,Stock,Condicion,Garantia',
  'A-1,Filtro de aceite,Bosch,4990,10,Nuevo,12 meses',
  'A-2,Pastilla freno,Brembo,15990,4,Usado,6 meses',
].join('\n');

describe('PlantillaMapper', () => {
  beforeEach(() => localStorage.clear());

  it('mapea un Excel propio y genera el archivo en formato oficial', async () => {
    const onGenerated = vi.fn();
    render(<PlantillaMapper onGenerated={onGenerated} onCancel={vi.fn()} />);

    const file = new File([CSV], 'mi-inventario.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Aparece la pantalla de mapeo con autodetección.
    expect(await screen.findByRole('heading', { name: /Relaciona tus columnas con las de RepuesTop/ })).toBeInTheDocument();
    expect(screen.getByText('2 filas · 7 columnas')).toBeInTheDocument();

    // "Garantia" no calza con ninguna columna oficial: cae en la sección B.
    expect(screen.getByText(/Columnas de tu Excel sin asignar/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Generar y continuar/ }));

    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
    const generated = onGenerated.mock.calls[0][0] as File;
    expect(generated.name).toMatch(/^plantilla-adaptada_.*\.xlsx$/);

    const aoa = await readGeneratedFile(generated);
    expect(aoa[0]).toEqual([...PLANTILLA_COLUMNAS]);

    const idx = (k: string) => PLANTILLA_COLUMNAS.indexOf(k as (typeof PLANTILLA_COLUMNAS)[number]);
    expect(aoa[1][idx('sku_proveedor')]).toBe('A-1');
    expect(aoa[1][idx('nombre_publicado')]).toBe('Filtro de aceite');
    expect(aoa[1][idx('marca_repuesto')]).toBe('Bosch');
    // "Garantia" sin asignar -> por defecto va a la descripción.
    expect(String(aoa[1][idx('descripcion')])).toContain('Garantia: 12 meses');
  });

  it('recuerda el mapeo para un Excel con las mismas columnas', async () => {
    const first = render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    const file = new File([CSV], 'mi-inventario.csv', { type: 'text/csv' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole('button', { name: /Generar y continuar/ }));
    await waitFor(() => expect(localStorage.getItem('repuestop_column_mappings')).toBeTruthy());
    first.unmount();

    render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    expect(await screen.findByText(/Aplicamos un mapeo que guardaste antes/)).toBeInTheDocument();
  });
});

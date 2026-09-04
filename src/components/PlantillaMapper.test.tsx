import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as XLSX from 'xlsx';
import { PlantillaMapper } from './PlantillaMapper';
import { ESQUEMA_FALLBACK, PLANTILLA_COLUMNAS, type EsquemaPlantilla } from '../utils/plantillaMapping';

/** Esquema como el que devuelve el backend, con catálogos de verdad. */
const ESQUEMA_CON_CATALOGOS: EsquemaPlantilla = {
  ...ESQUEMA_FALLBACK,
  catalogos: {
    ...ESQUEMA_FALLBACK.catalogos,
    categorias: ['Frenos', 'Filtros', 'Suspensión'],
    subcategoriasPorCategoria: { Frenos: ['Pastillas'], Filtros: ['Filtro de aceite'] },
    marcasRepuesto: ['Bosch', 'Brembo'],
  },
};

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

const subir = (contenido: string, nombre = 'mi-inventario.csv') => {
  const file = new File([contenido], nombre, { type: 'text/csv' });
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });
  return file;
};

const clic = (nombre: RegExp) => fireEvent.click(screen.getByRole('button', { name: nombre }));

/** Sube el archivo y avanza del paso 1 (hoja y títulos) al paso 2 (relacionar). */
async function subirYRelacionar(contenido = CSV) {
  subir(contenido);
  // La lectura del archivo es asíncrona: hay que esperar la pantalla del paso 1.
  await screen.findByRole('button', { name: /Siguiente/ });
  clic(/Siguiente/);
  await screen.findByRole('heading', { name: /Relaciona tus columnas con las de RepuesTop/ });
}

describe('PlantillaMapper', () => {
  beforeEach(() => localStorage.clear());

  it('mapea un Excel propio y genera el archivo en formato oficial', async () => {
    const onGenerated = vi.fn();
    render(<PlantillaMapper onGenerated={onGenerated} onCancel={vi.fn()} />);

    subir(CSV);

    // Paso 1: confirmamos qué estamos leyendo antes de mapear nada.
    expect(await screen.findByRole('heading', { name: /Revisemos que estemos leyendo bien tu archivo/ })).toBeInTheDocument();
    expect(screen.getByText(/2 filas · 7 columnas/)).toBeInTheDocument();
    clic(/Siguiente/);

    // Paso 2: relación de columnas con autodetección.
    expect(await screen.findByRole('heading', { name: /Relaciona tus columnas con las de RepuesTop/ })).toBeInTheDocument();
    // "Garantia" no calza con ningún dato oficial: cae en las columnas sin asignar.
    expect(screen.getByText(/Columnas de tu Excel sin asignar/)).toBeInTheDocument();
    // El archivo no trae categoría, que es obligatoria: el paso queda bloqueado hasta
    // que se elija una columna o se dé un valor para todas las filas.
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Valor fijo para Categoría'), { target: { value: 'Filtros' } });
    clic(/Siguiente/);

    // Paso 3: revisar y generar.
    expect(await screen.findByRole('heading', { name: /Revisa antes de generar/ })).toBeInTheDocument();
    clic(/Generar y continuar/);

    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
    const generated = onGenerated.mock.calls[0][0] as File;
    expect(generated.name).toMatch(/^plantilla-adaptada_.*\.xlsx$/);

    const aoa = await readGeneratedFile(generated);
    expect(aoa[0]).toEqual([...PLANTILLA_COLUMNAS]);

    const idx = (k: string) => PLANTILLA_COLUMNAS.indexOf(k as (typeof PLANTILLA_COLUMNAS)[number]);
    // El valor fijo se aplica a todas las filas.
    expect(aoa[1][idx('categoria')]).toBe('Filtros');
    expect(aoa[2][idx('categoria')]).toBe('Filtros');
    expect(aoa[1][idx('sku_proveedor')]).toBe('A-1');
    expect(aoa[1][idx('nombre_publicado')]).toBe('Filtro de aceite');
    expect(aoa[1][idx('marca_repuesto')]).toBe('Bosch');
    // "Garantia" sin asignar -> por defecto va a la descripción.
    expect(String(aoa[1][idx('descripcion')])).toContain('Garantia: 12 meses');
  });

  it('recuerda el mapeo para un Excel con las mismas columnas', async () => {
    const first = render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    await subirYRelacionar();
    fireEvent.change(screen.getByLabelText('Valor fijo para Categoría'), { target: { value: 'Filtros' } });
    clic(/Siguiente/);
    clic(/Generar y continuar/);
    await waitFor(() => expect(localStorage.getItem('repuestop_column_mappings')).toBeTruthy());
    first.unmount();

    render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    await subirYRelacionar();
    expect(screen.getByText(/Aplicamos la relación que guardaste antes/)).toBeInTheDocument();
  });

  it('encuentra los títulos aunque el Excel empiece con el nombre de la tienda y filas en blanco', async () => {
    render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    subir(['REPUESTOS DON JOSE', '', ...CSV.split('\n')].join('\n'));

    // La fila 3 del archivo es la de títulos: encima hay un encabezado de planilla.
    expect(await screen.findByText(/2 filas · 7 columnas/)).toBeInTheDocument();
    clic(/Siguiente/);
    await screen.findByRole('heading', { name: /Relaciona tus columnas/ });
    expect(screen.getByLabelText('SKU / Código')).toHaveDisplayValue('Codigo');
  });

  it('permite corregir a mano la fila de títulos haciendo clic en la vista previa', async () => {
    render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    subir(['Lista mayo,,,,,,', ...CSV.split('\n')].join('\n'));
    await screen.findByText(/2 filas · 7 columnas/);

    // El vendedor dice que sus títulos están en la fila 1, no en la 2.
    fireEvent.click(screen.getByTitle('Usar la fila 1 como títulos'));
    expect(await screen.findByText(/3 filas/)).toBeInTheDocument();
  });

  it('no deja avanzar mientras falten datos obligatorios, y acepta un valor fijo como salida', async () => {
    render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    // Sin columna de categoría ni de marca: dos obligatorios sin resolver.
    await subirYRelacionar(['Codigo,Titulo,Stock', 'A-1,Filtro,10'].join('\n'));

    expect(screen.getByText(/Todavía falta indicar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Valor fijo para Categoría'), { target: { value: 'Filtros' } });
    fireEvent.change(screen.getByLabelText('Valor fijo para Marca del repuesto'), { target: { value: 'Bosch' } });

    await waitFor(() => expect(screen.getByRole('button', { name: /Siguiente/ })).toBeEnabled());
  });

  it('en el paso de revisar muestra la ficha del primer repuesto y marca las filas con problemas', async () => {
    render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    await subirYRelacionar([
      'Codigo,Titulo,Marca,Categoria,Precio,Cantidad',
      'A-1,Filtro de aceite,Bosch,Filtros,$ 4.990,10',
      'A-2,Pastilla de freno,Brembo,Frenos,consultar,4',
      'A-3,,Gates,Correas,9990,7',
    ].join('\n'));
    clic(/Siguiente/);
    await screen.findByRole('heading', { name: /Revisa antes de generar/ });

    // Contadores en lenguaje llano: 3 filas, 1 con precio ilegible y 1 sin nombre.
    expect(screen.getByText(/se pueden publicar/)).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.mapper-counts .ok b' })).toBeInTheDocument();
    expect(screen.getByText('2', { selector: '.mapper-counts .mal b' })).toBeInTheDocument();

    // La ficha muestra el primer repuesto que sí se puede publicar, ya armado.
    expect(screen.getByText('Así se verá tu primer repuesto en RepuesTop')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Filtro de aceite' })).toBeInTheDocument();
    expect(screen.getByText(/4\.990/, { selector: '.mapper-ficha-precio' })).toBeInTheDocument();

    // Y la tabla dice qué revisar, con el número de fila del Excel del vendedor.
    expect(screen.getByText(/"consultar" no es un número/)).toBeInTheDocument();
    expect(screen.getByText(/Falta nombre publicado/)).toBeInTheDocument();
  });

  it('ofrece dividir la columna de años con rangos y muestra los arreglos que hizo', async () => {
    render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    await subirYRelacionar([
      'Codigo,Titulo,Marca,Categoria,Precio,Cantidad,Años,Chasis',
      'A-1,Filtro de aceite,Bosch,Filtros,$ 4.990,10,2014-2020,x',
    ].join('\n'));

    // El interruptor viene propuesto porque el archivo trae rangos, con un ejemplo real.
    const interruptor = screen.getByRole('checkbox');
    expect(interruptor).toBeChecked();
    expect(screen.getByText(/"2014-2020" queda como 2014 y 2020/)).toBeInTheDocument();

    clic(/Siguiente/);
    await screen.findByRole('heading', { name: /Revisa antes de generar/ });

    // Los arreglos se muestran antes de generar: nadie se entera después de publicar.
    expect(screen.getByText(/Arreglos que hicimos por ti/)).toBeInTheDocument();
    expect(screen.getByText('4990', { selector: '.mapper-arreglo-despues' })).toBeInTheDocument();
    expect(screen.getByText('$ 4.990', { selector: '.mapper-arreglo-antes' })).toBeInTheDocument();
  });

  it('deja poner el mismo valor para todas las filas en cualquier columna sin asignar', async () => {
    render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    await subirYRelacionar(['Codigo,Titulo,Marca,Categoria,Precio,Cantidad', 'A-1,Filtro,Bosch,Filtros,4990,10'].join('\n'));

    // Condición no es obligatoria y el archivo no la trae: igual se puede fijar, y como es
    // una columna de lista se ofrecen los valores válidos en vez de texto libre.
    const select = screen.getByLabelText('Valor fijo para Condición');
    expect(select.tagName).toBe('SELECT');
    fireEvent.change(select, { target: { value: 'ALTERNATIVO' } });

    clic(/Siguiente/);
    await screen.findByRole('heading', { name: /Revisa antes de generar/ });
    expect(screen.getByText('Alternativo', { selector: '.mapper-ficha-chip.cond' })).toBeInTheDocument();
  });

  it('propone la categoría del catálogo que más se parece, ordenada por cuántos repuestos afecta', async () => {
    render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} esquema={ESQUEMA_CON_CATALOGOS} />);
    await subirYRelacionar([
      'Codigo,Titulo,Marca,Categoria,Precio,Cantidad',
      'A-1,Pastilla,Brembo,Frenos delanteros,4990,10',
      'A-2,Pastilla trasera,Brembo,Frenos delanteros,5990,4',
      'A-3,Filtro,Bosh,Filtros,3990,7',
    ].join('\n'));
    clic(/Siguiente/);
    await screen.findByRole('heading', { name: /Revisa antes de generar/ });

    // "Frenos delanteros" no está en el catálogo: el backend rechazaría esas dos filas.
    expect(screen.getByText(/Tus palabras y las de RepuesTop \(2 sin responder\)/)).toBeInTheDocument();
    expect(screen.getByText('2 repuestos')).toBeInTheDocument();
    const decision = screen.getByLabelText('Categoría: Frenos delanteros');
    expect(decision).toHaveDisplayValue('dejar como está (no se va a publicar)');

    // Y la marca mal escrita se avisa, pero no bloquea: el backend la crearía.
    expect(screen.getByLabelText('Marca del repuesto: Bosh')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Usar todas las sugerencias/ }));
    await waitFor(() => expect(decision).toHaveDisplayValue('Frenos — parecido'));
    expect(screen.getByLabelText('Marca del repuesto: Bosh')).toHaveDisplayValue('Bosch — parecido');
  });

  it('con la traducción aplicada, las filas pasan a ser publicables', async () => {
    const onGenerated = vi.fn();
    render(<PlantillaMapper onGenerated={onGenerated} onCancel={vi.fn()} esquema={ESQUEMA_CON_CATALOGOS} />);
    await subirYRelacionar([
      'Codigo,Titulo,Marca,Categoria,Precio,Cantidad',
      'A-1,Pastilla,Brembo,Frenos delanteros,4990,10',
    ].join('\n'));
    clic(/Siguiente/);
    await screen.findByRole('heading', { name: /Revisa antes de generar/ });

    expect(screen.getByText('1', { selector: '.mapper-counts .mal b' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Usar todas las sugerencias/ }));
    await waitFor(() => expect(screen.getByText('1', { selector: '.mapper-counts .ok b' })).toBeInTheDocument());

    clic(/Generar y continuar/);
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
    const aoa = await readGeneratedFile(onGenerated.mock.calls[0][0] as File);
    expect(aoa[1][PLANTILLA_COLUMNAS.indexOf('categoria')]).toBe('Frenos');
  });

  it('deja elegir la hoja cuando el libro trae varias', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Portada de la lista']]), 'Portada');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Codigo', 'Titulo', 'Marca', 'Stock'],
        ['A-1', 'Filtro', 'Bosch', 5],
        ['A-2', 'Correa', 'Gates', 3],
      ]),
      'Toyota',
    );
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const file = new File([buffer], 'catalogo.xlsx');

    render(<PlantillaMapper onGenerated={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    // Se abre en la primera hoja con datos, no en la portada.
    expect(await screen.findByText(/hoja "Toyota"/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Portada/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Portada/ }));
    expect(await screen.findByText(/Debajo de esa fila no hay datos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled();
  });
});

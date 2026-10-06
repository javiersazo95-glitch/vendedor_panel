import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as XLSX from 'xlsx';

vi.mock('../../utils/session', async (original) => ({
  ...(await original<typeof import('../../utils/session')>()),
  getStoredSession: () => ({ sellerId: '1', token: 'token-de-prueba', email: 'a@b.cl', role: 'PROVEEDOR' }),
}));

import { CargaExcelWizard } from './CargaExcelWizard';
import { ESQUEMA_FALLBACK } from '../../utils/plantillaMapping';
import { cuandoSeGuardo } from '../../utils/miExcelBorrador';

/**
 * El asistente "Mi propio Excel": etapas, "No tengo esta columna" sin valor fijo, guardar el
 * progreso y retomarlo con el aviso de fecha y hora.
 */
const CSV = 'Codigo,Descripcion,Precio,Stock\nPF-1,Pastilla freno,24990,5\nPF-2,Disco freno,39990,2\n';

type Ruta = { metodo?: string; incluye: string; respuesta: () => Partial<Response> };
let rutas: Ruta[] = [];
const llamadas: { url: string; metodo: string; body?: unknown }[] = [];

const respuestaJson = (data: unknown, status = 200): Partial<Response> => ({
  ok: status >= 200 && status < 300, status, json: async () => data, blob: async () => new Blob([JSON.stringify(data)]),
});

beforeEach(() => {
  llamadas.length = 0;
  rutas = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    llamadas.push({ url: String(url), metodo, body: init?.body });
    const ruta = rutas.find((r) => String(url).includes(r.incluye) && (!r.metodo || r.metodo === metodo));
    if (ruta) return ruta.respuesta() as Response;
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const montar = (extra: Partial<React.ComponentProps<typeof CargaExcelWizard>> = {}) => {
  const props = {
    onVolver: vi.fn(), onClose: vi.fn(), onUploadSuccess: vi.fn(), onAnchoCompletoChange: vi.fn(), ...extra,
  };
  render(<CargaExcelWizard {...props} />);
  return props;
};

const subirCsv = async () => {
  const archivo = new File([CSV], 'mi-inventario.csv', { type: 'text/csv' });
  fireEvent.change(await screen.findByTestId('mx-input-excel'), { target: { files: [archivo] } });
  await screen.findByText('mi-inventario.csv');
};

describe('Mi propio Excel: etapas 1 y 2', () => {
  beforeEach(() => {
    rutas.push({ incluye: 'borrador-carga/todos', metodo: 'GET', respuesta: () => respuestaJson([]) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'GET', respuesta: () => ({ ok: true, status: 204, json: async () => null }) });
    rutas.push({ incluye: 'excel/mapeos', respuesta: () => respuestaJson([]) });
  });

  it('la etapa 1 pide el Excel y ofrece subir la carpeta de fotos', async () => {
    montar();
    expect(await screen.findByText('Tu Excel de inventario')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Elegir carpeta/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Subir ZIP/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Siguiente: relacionar columnas/ })).toBeDisabled();
  });

  it('nombra la fila que se usará como títulos y atenúa lo que queda arriba (H48)', async () => {
    montar();
    await subirCsv();

    const ayuda = screen.getByText(/como los/).closest('p') as HTMLElement;
    expect(ayuda).toHaveTextContent('Usaremos la fila 1 (en azul) como los títulos de tus columnas');
    expect(screen.getByText('Títulos de tus columnas')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Usar la fila 2 como títulos'));

    expect(ayuda).toHaveTextContent('Usaremos la fila 2 (en azul)');
    expect(screen.getByTitle('Usar la fila 1 como títulos')).toHaveClass('fuera');
    expect(screen.getByTitle('Usar la fila 2 como títulos')).toHaveClass('titulos');
  });

  it('"No tengo esta columna" avisa que el dato se completa en el paso 3 y no ofrece un valor fijo', async () => {
    montar();
    await subirCsv();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: relacionar columnas/ }));
    const select = await screen.findByRole('combobox', { name: 'Marca del repuesto' });
    expect(select).toHaveValue('');
    const tarjeta = select.closest('.mx-campo') as HTMLElement;
    expect(within(tarjeta).getByRole('status')).toHaveTextContent(/lo completarás tú en el paso 3/);
    expect(screen.queryByLabelText(/Valor fijo/)).not.toBeInTheDocument();
    expect(screen.getByText('Datos que completarás en el paso 3')).toBeInTheDocument();
  });

  it('la columna que se suelta vuelve a "sin asignar", con sus dos opciones', async () => {
    montar();
    await subirCsv();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: relacionar columnas/ }));
    const stock = await screen.findByRole('combobox', { name: 'Stock' });
    fireEvent.change(stock, { target: { value: '' } });
    const grupo = await screen.findByRole('group', { name: /Qué hacer con Stock/ });
    expect(within(grupo).getByRole('button', { name: /Agregar a la descripción/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(grupo).getByRole('button', { name: /Dejar fuera/ }));
    expect(within(grupo).getByRole('button', { name: /Dejar fuera/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"Todo mi inventario es universal" con autos en el archivo pregunta en la pantalla, sin confirm del navegador (H39)', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    montar();
    const conAutos = 'Codigo,Descripcion,Aplicacion,Precio,Stock\nPF-1,Pastilla freno,Toyota Yaris 2015-2019,24990,5\nPF-2,Disco freno,Chevrolet Sail 2012-2018,39990,2\n';
    fireEvent.change(await screen.findByTestId('mx-input-excel'), { target: { files: [new File([conAutos], 'con-autos.csv', { type: 'text/csv' })] } });
    await screen.findByText('con-autos.csv');
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: relacionar columnas/ }));

    const interruptor = await screen.findByLabelText('Todo mi inventario es universal');
    fireEvent.click(interruptor);
    const pregunta = screen.getByRole('alertdialog', { name: /Todo tu inventario es universal/ });
    expect(pregunta).toHaveTextContent(/trae el auto en 2 filas/);
    expect(interruptor).not.toBeChecked();

    fireEvent.click(within(pregunta).getByRole('button', { name: 'No, mis repuestos son para autos' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(interruptor).not.toBeChecked();

    fireEvent.click(interruptor);
    fireEvent.click(screen.getByRole('button', { name: 'Sí, todo es universal' }));
    expect(screen.getByLabelText('Todo mi inventario es universal')).toBeChecked();
    expect(confirmar).not.toHaveBeenCalled();
    confirmar.mockRestore();
  });

  it('el aviso de qué corregir sólo aparece al tocar el ⚠ de la fila, y lleva a la celda con el error', async () => {
    montar();
    await subirCsv();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: relacionar columnas/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sirven para todos los vehículos/ }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: completar tus datos/ }));
    await screen.findByText('Falta completar');
    expect(screen.queryByText(/Corrigiendo la fila/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fila 2: ver qué hay que corregir' }));
    const banner = (await screen.findByText(/Corrigiendo la fila 2/)).closest('section') as HTMLElement;
    expect(within(banner).getByText(/No se publicará/)).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Columna «Categoría»' })).toBeInTheDocument();
    expect(within(banner).getAllByText(/Por qué:/).length).toBeGreaterThan(0);
    // Quedó abierta la celda del primer dato con error.
    expect(screen.getByLabelText(/^Categoría de la fila 2/)).toBeInTheDocument();
  });

  it('en la etapa 3 lo que falta sale en amarillo, se puede completar para todas las filas y el menú se oculta', async () => {
    const props = montar();
    await subirCsv();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: relacionar columnas/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sirven para todos los vehículos/ }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: completar tus datos/ }));
    expect(await screen.findByText('Falta completar')).toBeInTheDocument();
    expect(props.onAnchoCompletoChange).toHaveBeenLastCalledWith(true);
    const completar = screen.getAllByRole('button', { name: /Completar todas/ });
    expect(completar.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Fotos de Pastilla freno' })).toHaveTextContent('Elegir');
  });

  it('"Guardar progreso" guarda en la cuenta el estado y el Excel', async () => {
    rutas.push({ incluye: 'borrador-carga/archivo', metodo: 'PUT', respuesta: () => respuestaJson({}) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'PUT', respuesta: () => respuestaJson({ version: 1, updatedAt: new Date().toISOString() }) });
    montar();
    await subirCsv();
    fireEvent.click(screen.getByRole('button', { name: /Guardar progreso/ }));
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'PUT' && l.url.endsWith('/borrador-carga?tipo=MI_EXCEL'))).toBe(true));
    const put = llamadas.find((l) => l.metodo === 'PUT' && l.url.endsWith('/borrador-carga?tipo=MI_EXCEL'));
    const cuerpo = JSON.parse(String(put?.body));
    expect(JSON.parse(cuerpo.estadoJson).archivo.nombre).toBe('mi-inventario.csv');
    expect(cuerpo.versionEsperada).toBeNull();
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'PUT' && l.url.endsWith('/borrador-carga/archivo?tipo=MI_EXCEL'))).toBe(true));
    expect(await screen.findByText(/Guardado hace/)).toBeInTheDocument();
  });
});

describe('Mi propio Excel: retomar lo guardado', () => {
  const estado = {
    v: 1, paso: 3,
    archivo: { nombre: 'mi-inventario.csv', sha256: 'x', hojaIndex: 0, filaEncabezados: 0, recortado: false, filas: 2 },
    mapping: {
      oficial: { sku_proveedor: '0', nombre_publicado: '1', precio: '2', stock: '3' }, extras: {}, valueMap: {},
      defaults: { compatibilidad_general: 'SI' },
      parches: { 1: { categoria: 'Frenos' } },
    },
    opcionalesVacios: [], fotos: { asignaciones: { 0: ['pf-1.jpg'] }, origen: 'carpeta', totalDisponibles: 40 },
    vistaPaso4: 'tarjetas', publicacion: null,
  };
  const borrador = {
    estadoJson: JSON.stringify(estado), paso: 3, version: 4, archivoNombre: 'mi-inventario.csv', archivoBytes: 80,
    archivoSha256: 'x', archivoRecortado: false, tieneArchivo: true, imagenes: [{ id: 9, nombreArchivo: 'pf-1.jpg', bytes: 100 }],
    createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-29T15:30:00Z',
  };

  beforeEach(() => {
    rutas.push({ incluye: 'borrador-carga/archivo', metodo: 'GET', respuesta: () => ({ ok: true, status: 200, blob: async () => new Blob([CSV], { type: 'text/csv' }) }) });
    rutas.push({ incluye: 'borrador-carga/todos', metodo: 'GET', respuesta: () => respuestaJson([borrador]) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'GET', respuesta: () => respuestaJson(borrador) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'DELETE', respuesta: () => ({ ok: true, status: 204, json: async () => ({}) }) });
    rutas.push({ incluye: 'excel/mapeos', respuesta: () => respuestaJson([]) });
  });

  it('avisa que hay una carga sin terminar: de qué tipo, cuándo se guardó y en qué paso iba', async () => {
    montar();
    const dialogo = await screen.findByRole('dialog', { name: 'Tienes una carga sin terminar' });
    const tarjeta = within(dialogo).getByRole('region', { name: 'Carga sin terminar: Tu propio Excel' });
    expect(tarjeta).toHaveTextContent('mi-inventario.csv');
    expect(tarjeta).toHaveTextContent(`Guardada ${cuandoSeGuardo(borrador.updatedAt)}`);
    expect(tarjeta).toHaveTextContent('Ibas en el paso 3 de 4: Completa');
    expect(within(dialogo).getByRole('button', { name: /Continuar donde quedé/ })).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: /Empezar otra carga/ })).toBeInTheDocument();
  });

  it('retomar vuelve a la etapa donde iba y explica por qué hay que volver a elegir las fotos', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Continuar donde quedé/ }));
    expect(await screen.findByText('Vuelve a elegir tus fotos')).toBeInTheDocument();
    expect(screen.getByText(/sólo guardamos las fotos que ya habías asignado a un repuesto/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Seguir sin elegir/ }));
    expect(await screen.findByText('Falta completar')).toBeInTheDocument();
    expect(llamadas.some((l) => l.url.includes('borrador-carga/archivo'))).toBe(true);
    // Lo que había completado celda a celda sigue ahí: la categoría de la segunda fila.
    expect(screen.getByRole('button', { name: /^Categoría de la fila 3/ })).toHaveTextContent('Frenos');
    // La que falta sigue marcada, y dice por qué hay que corregirla.
    expect(screen.getByRole('button', { name: /^Categoría de la fila 2\. Hay que corregirlo: Falta categoría/ })).toHaveTextContent('Completar');
  });

  it('"Continuar donde quedé" en la pregunta retoma sin volver a preguntar', async () => {
    montar({ retomar: 'mi-excel' });
    expect(await screen.findByText('Vuelve a elegir tus fotos')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Tienes una carga sin terminar' })).not.toBeInTheDocument();
  });

  it('descartar pide confirmación, borra lo guardado y empieza de cero', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Descartar esta carga/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, descartar la carga/ }));
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'DELETE' && l.url.endsWith('/borrador-carga?tipo=MI_EXCEL'))).toBe(true));
    expect(await screen.findByText('Tu Excel de inventario')).toBeInTheDocument();
  });
});

describe('Mi propio Excel: vista previa y publicar', () => {
  const estado = {
    v: 1, paso: 4,
    archivo: { nombre: 'mi-inventario.csv', sha256: 'x', hojaIndex: 0, filaEncabezados: 0, recortado: false, filas: 2 },
    mapping: {
      oficial: { sku_proveedor: '0', nombre_publicado: '1', precio: '2', stock: '3' }, extras: {}, valueMap: {},
      defaults: { compatibilidad_general: 'SI', categoria: 'Frenos', marca_repuesto: 'Bosch' },
    },
    opcionalesVacios: [], fotos: { asignaciones: { 0: ['pf-1.jpg'] }, origen: null, totalDisponibles: 0 },
    vistaPaso4: 'tarjetas', publicacion: null,
  };
  const borrador = {
    estadoJson: JSON.stringify(estado), paso: 4, version: 2, archivoNombre: 'mi-inventario.csv', archivoBytes: 80,
    archivoSha256: 'x', archivoRecortado: false, tieneArchivo: true, imagenes: [{ id: 9, nombreArchivo: 'pf-1.jpg', bytes: 100 }],
    createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-29T15:30:00Z',
  };
  const filasOk = [
    { fila: 2, sku: 'PF-1', estado: 'OK', mensajes: [] },
    { fila: 3, sku: 'PF-2', estado: 'OK', mensajes: [] },
  ];
  const resumen = (filas: unknown[]) => ({
    totalFilas: 2, productosCargados: 2, productosConError: 0, productosConAdvertencia: 0, errores: [], advertencias: [], filas,
  });

  beforeEach(() => {
    rutas.push({ incluye: 'borrador-carga/archivo', metodo: 'GET', respuesta: () => ({ ok: true, status: 200, blob: async () => new Blob([CSV], { type: 'text/csv' }) }) });
    rutas.push({ incluye: 'borrador-carga/imagenes/9', metodo: 'GET', respuesta: () => ({ ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'image/jpeg' }) }) });
    rutas.push({ incluye: 'borrador-carga/todos', metodo: 'GET', respuesta: () => respuestaJson([borrador]) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'GET', respuesta: () => respuestaJson(borrador) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'PUT', respuesta: () => respuestaJson({ version: 3, updatedAt: new Date().toISOString() }) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'DELETE', respuesta: () => ({ ok: true, status: 204, json: async () => ({}) }) });
    rutas.push({ incluye: 'excel/mapeos', respuesta: () => respuestaJson([]) });
    rutas.push({ incluye: 'excel/validar', respuesta: () => respuestaJson(resumen(filasOk)) });
    rutas.push({ incluye: 'excel/cargar', respuesta: () => respuestaJson(resumen(filasOk.map((f, i) => ({ ...f, productoId: 100 + i })))) });
    rutas.push({ incluye: 'inventario/100/editar', metodo: 'POST', respuesta: () => respuestaJson({}) });
    rutas.push({ incluye: 'inventario/100', metodo: 'GET', respuesta: () => respuestaJson({ skuProveedor: 'PF-1', nombrePublicado: 'Pastilla freno', stock: 5 }) });
  });

  it('un repuesto que no se publicará dice qué dato corregir, y al corregirlo se abre justo ese dato', async () => {
    rutas.unshift({
      incluye: 'excel/validar',
      respuesta: () => respuestaJson(resumen([filasOk[0], { fila: 3, sku: 'PF-2', estado: 'ERROR', mensajes: ['Falta la marca del repuesto.'] }])),
    });
    montar({ retomar: 'mi-excel' });
    fireEvent.click(await screen.findByRole('button', { name: /Seguir sin elegir/ }));
    const aviso = await screen.findByRole('button', { name: /Corrige: Marca del repuesto/ });

    // En la ficha de tienda el dato queda marcado, con su motivo, y abierto para corregirlo.
    fireEvent.click(aviso);
    const ficha = await screen.findByRole('dialog', { name: 'Así se verá en tu tienda' });
    expect(within(ficha).getByRole('alert')).toHaveTextContent(/No se publicará/);
    expect(within(ficha).getByRole('button', { name: 'Corregir Marca del repuesto' })).toBeInTheDocument();
    expect(within(ficha).getByLabelText('Marca del repuesto')).toBeInTheDocument();
    expect(within(ficha).getAllByText('Falta la marca del repuesto.').length).toBeGreaterThan(0);
    fireEvent.click(within(ficha).getByRole('button', { name: 'Cerrar' }));

    // El lápiz de la tarjeta abre la misma ficha para editar (6-oct); desde ahí, "Corregir en la tabla"
    // lleva a la fila, la explica arriba y abre la celda del dato con problema.
    fireEvent.click(screen.getByRole('button', { name: 'Editar Disco freno' }));
    const fichaEditar = await screen.findByRole('dialog', { name: 'Así se verá en tu tienda' });
    fireEvent.click(within(fichaEditar).getByRole('button', { name: /Corregir en la tabla/ }));
    const banner = (await screen.findByText(/Corrigiendo la fila 3/)).closest('section') as HTMLElement;
    expect(within(banner).getByText(/No se publicará/)).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Columna «Marca del repuesto»' })).toBeInTheDocument();
    expect(within(banner).getByText('Falta la marca del repuesto.')).toBeInTheDocument();
    expect(screen.getByLabelText('Marca del repuesto de la fila 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver las columnas de la derecha' })).toBeInTheDocument();
  });

  it('lo que el panel retiene no se publica aunque el servidor lo dé por bueno (precio con decimales)', async () => {
    // Prueba en local del 30-sep: "15990,5" salía en la vista previa como "No se publicará" pero se
    // publicaba a $15.991, porque al publicar sólo se sacaban las filas que objetaba el servidor.
    const conDecimales = CSV.replace('39990', '"39990,5"');
    rutas.unshift({ incluye: 'borrador-carga/archivo', metodo: 'GET', respuesta: () => ({ ok: true, status: 200, blob: async () => new Blob([conDecimales], { type: 'text/csv' }) }) });
    rutas.unshift({ incluye: 'excel/cargar', respuesta: () => respuestaJson(resumen([{ ...filasOk[0], productoId: 100 }])) });
    montar({ retomar: 'mi-excel' });
    fireEvent.click(await screen.findByRole('button', { name: /Seguir sin elegir/ }));
    await screen.findByText(/Revisamos tu inventario:/);

    fireEvent.click(await screen.findByRole('button', { name: /Publicar 1 repuesto/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, publicar/ }));
    expect(await screen.findByText('¡Listo! Tu inventario está publicado')).toBeInTheDocument();

    const carga = llamadas.find((l) => l.url.includes('excel/cargar'));
    const enviado = (carga?.body as FormData).get('file') as File;
    const bytes = await new Promise<ArrayBuffer>((ok) => {
      const lector = new FileReader();
      lector.onload = () => ok(lector.result as ArrayBuffer);
      lector.readAsArrayBuffer(enviado);
    });
    const libro = XLSX.read(bytes, { type: 'array' });
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets.inventario);
    expect(filas.map((f) => f.sku_proveedor)).toEqual(['PF-1']);
  });

  it('la papelera quita un repuesto de la carga, se puede volver a incluir y lo quitado no se publica', async () => {
    rutas.unshift({ incluye: 'excel/cargar', respuesta: () => respuestaJson(resumen([{ ...filasOk[0], productoId: 100 }])) });
    montar({ retomar: 'mi-excel' });
    fireEvent.click(await screen.findByRole('button', { name: /Seguir sin elegir/ }));
    await screen.findByText(/Revisamos tu inventario:/);
    expect(screen.getByRole('button', { name: /Publicar 2 repuestos/ })).toBeEnabled();

    // Pregunta antes de quitar; "No, dejarlo" no toca nada.
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Disco freno de la carga' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Quitar este repuesto de la carga?' });
    expect(dialogo).toHaveTextContent('Disco freno (código PF-2) no se publicará con esta carga.');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'No, dejarlo' }));
    expect(screen.getByRole('button', { name: /Publicar 2 repuestos/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar Disco freno de la carga' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Sí, quitarlo/ }));
    expect(screen.getByRole('button', { name: /Publicar 1 repuesto$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver Disco freno como en tu tienda' })).not.toBeInTheDocument();

    // En "Quitados" está, y se puede volver a incluir; también en la lista.
    fireEvent.click(screen.getByRole('button', { name: 'Quitados (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver a incluir Disco freno' }));
    expect(screen.getByRole('button', { name: /Publicar 2 repuestos/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Quitados/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Lista/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Disco freno de la carga' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Sí, quitarlo/ }));

    fireEvent.click(screen.getByRole('button', { name: /Publicar 1 repuesto$/ }));
    expect(await screen.findByText(/1 repuesto que quitaste/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sí, publicar/ }));
    expect(await screen.findByText('¡Listo! Tu inventario está publicado')).toBeInTheDocument();
    expect(screen.getByText(/1 repuesto que quitaste no se publicó/)).toBeInTheDocument();
    expect(screen.queryByText(/porque tenían algo por corregir/)).not.toBeInTheDocument();

    const carga = llamadas.find((l) => l.url.includes('excel/cargar'));
    const enviado = (carga?.body as FormData).get('file') as File;
    const bytes = await new Promise<ArrayBuffer>((ok) => {
      const lector = new FileReader();
      lector.onload = () => ok(lector.result as ArrayBuffer);
      lector.readAsArrayBuffer(enviado);
    });
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.read(bytes, { type: 'array' }).Sheets.inventario);
    expect(filas.map((f) => f.sku_proveedor)).toEqual(['PF-1']);
  });

  it('lo quitado se guarda con el progreso y sigue quitado al retomar', async () => {
    // Un progreso guardado con el segundo repuesto (Disco freno) quitado.
    const i = rutas.findIndex((r) => r.incluye === 'borrador-carga/todos');
    rutas[i] = { ...rutas[i], respuesta: () => respuestaJson([{ ...borrador, estadoJson: JSON.stringify({ ...estado, quitados: ['1'] }) }]) };
    montar({ retomar: 'mi-excel' });
    fireEvent.click(await screen.findByRole('button', { name: /Seguir sin elegir/ }));
    await screen.findByText(/Revisamos tu inventario:/);
    expect(screen.getByRole('button', { name: /Publicar 1 repuesto$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitados (1)' })).toBeInTheDocument();
  });

  it('junto al precio muestra lo que recibe la tienda, como la carga uno a uno, y se recalcula al editarlo (6-oct)', async () => {
    montar({ retomar: 'mi-excel' });
    fireEvent.click(await screen.findByRole('button', { name: /Seguir sin elegir/ }));
    await screen.findByText(/Revisamos tu inventario:/);

    // $24.990 con la comisión estándar (8% + IVA) y Flow (2,89% + IVA): recibe $21.752.
    expect(screen.getAllByText(/Recibes \$21\.752/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Ver Pastilla freno como en tu tienda/ }));
    const ficha = await screen.findByRole('dialog', { name: 'Así se verá en tu tienda' });
    expect(within(ficha).getByText('Recibirás en tu cuenta (Líquido):')).toBeInTheDocument();
    expect(within(ficha).getByText('$21.752')).toBeInTheDocument();

    // Mientras se escribe el precio nuevo, la calculadora usa ese valor.
    fireEvent.click(within(ficha).getByRole('button', { name: 'Cambiar Precio' }));
    fireEvent.change(within(ficha).getByLabelText('Precio'), { target: { value: '30000' } });
    expect(within(ficha).getByText('$26.112')).toBeInTheDocument();
  });

  it('a una tienda Fundadora la calculadora le aplica su tarifa de 5% + IVA', async () => {
    montar({ retomar: 'mi-excel', fundador: true });
    fireEvent.click(await screen.findByRole('button', { name: /Seguir sin elegir/ }));
    await screen.findByText(/Revisamos tu inventario:/);

    expect(screen.getAllByText(/Recibes \$22\.643/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Ver Pastilla freno como en tu tienda/ }));
    const ficha = await screen.findByRole('dialog', { name: 'Así se verá en tu tienda' });
    expect(within(ficha).getByText(/Beneficio Fundador/)).toBeInTheDocument();
  });

  it('un cambio en la ficha queda "sin confirmar": se explica, se confirma, y Publicar pide confirmarlo antes', async () => {
    montar({ retomar: 'mi-excel' });
    fireEvent.click(await screen.findByRole('button', { name: /Seguir sin elegir/ }));
    await screen.findByText(/Revisamos tu inventario:/);
    const revisionesAntes = llamadas.filter((l) => l.url.includes('excel/validar')).length;

    // Se corrige el nombre desde la ficha de tienda.
    fireEvent.click(screen.getByRole('button', { name: /Ver Pastilla freno como en tu tienda/ }));
    const ficha = await screen.findByRole('dialog', { name: 'Así se verá en tu tienda' });
    fireEvent.click(within(ficha).getByRole('button', { name: 'Cambiar Nombre publicado' }));
    fireEvent.change(within(ficha).getByLabelText('Nombre publicado'), { target: { value: 'Pastilla freno delantera' } });
    fireEvent.click(within(ficha).getByRole('button', { name: 'Guardar' }));
    expect(within(ficha).getByText(/Tus cambios ya quedaron guardados/)).toBeInTheDocument();
    expect(within(ficha).getByRole('button', { name: /Confirmar cambios/ })).toBeInTheDocument();
    fireEvent.click(within(ficha).getByRole('button', { name: /Seguir corrigiendo otros/ }));

    // Arriba se explica qué cambió y cómo confirmarlo.
    const aviso = screen.getByText('Tienes cambios sin confirmar').closest('.mx-cambios-pendientes') as HTMLElement;
    expect(aviso).toHaveTextContent('Cambiaste 1 dato en 1 repuesto');
    expect(aviso).toHaveTextContent('Pastilla freno delantera: Nombre publicado');
    expect(within(aviso).getByRole('button', { name: /Confirmar cambios/ })).toBeInTheDocument();

    // Publicar no se apaga: pide confirmar los cambios primero, los revisa y recién ahí pregunta si publicar.
    fireEvent.click(screen.getByRole('button', { name: /Publicar 2 repuestos/ }));
    const antes = await screen.findByRole('dialog', { name: 'Antes de publicar, confirma tus cambios' });
    expect(antes).toHaveTextContent('Cambiaste 1 dato en 1 repuesto');
    fireEvent.click(within(antes).getByRole('button', { name: /Confirmar cambios y publicar/ }));
    expect(await screen.findByRole('dialog', { name: '¿Publicar tu inventario?' })).toBeInTheDocument();
    expect(llamadas.filter((l) => l.url.includes('excel/validar')).length).toBe(revisionesAntes + 1);
    expect(screen.getByText('¡Listo! Tus cambios quedaron confirmados.')).toBeInTheDocument();
  });

  it('revisa con el servidor, muestra lista y cuadrícula, publica, sube las fotos y borra lo guardado', async () => {
    const props = montar({ retomar: 'mi-excel' });
    fireEvent.click(await screen.findByRole('button', { name: /Seguir sin elegir/ }));
    expect(await screen.findByText(/Revisamos tu inventario:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver Pastilla freno como en tu tienda/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ver Pastilla freno como en tu tienda/ }));
    expect(await screen.findByRole('dialog', { name: 'Así se verá en tu tienda' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar Nombre publicado' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    fireEvent.click(screen.getByRole('button', { name: /Lista/ }));
    expect(screen.getByRole('columnheader', { name: 'Qué pasa' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Publicar 2 repuestos/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, publicar/ }));

    expect(await screen.findByText('¡Listo! Tu inventario está publicado')).toBeInTheDocument();
    expect(screen.getByText(/2 repuestos publicados/)).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'POST' && l.url.includes('inventario/100/editar'))).toBe(true);
    expect(llamadas.some((l) => l.metodo === 'DELETE' && l.url.endsWith('/borrador-carga?tipo=MI_EXCEL'))).toBe(true);
    expect(props.onUploadSuccess).toHaveBeenCalled();
  });
});

describe('Carga con Excel: la plantilla de RepuesTop', () => {
  const columnas = ESQUEMA_FALLBACK.columnas;
  const fila = (v: Record<string, string>) => columnas.map((c) => v[c] ?? '').join(',');
  const PLANTILLA_CSV = [
    columnas.join(','),
    fila({ nombre_publicado: 'Filtro de aceite Toyota Yaris', sku_proveedor: 'SKU-001', categoria: 'Filtros', stock: '10' }),
    fila({ nombre_publicado: 'Pastilla freno', sku_proveedor: 'PF-1', categoria: 'Frenos', marca_repuesto: 'Bosch', precio: '24990', stock: '5', compatibilidad_general: 'SI' }),
  ].join('\n');
  /** La plantilla tal como se descarga: sus tres hojas, con sus columnas exactas. */
  const plantillaXlsx = (hojas: [string, unknown[][]][] = [
    ['inventario', PLANTILLA_CSV.split('\n').map((l) => l.split(','))],
    ['compatibilidades', [ESQUEMA_FALLBACK.hojaCompatibilidadesColumnas]],
    ['instrucciones', [['VERSION_PLANTILLA: 2.3.0']]],
  ], nombre = 'plantilla-llena.xlsx') => {
    const libro = XLSX.utils.book_new();
    for (const [n, aoa] of hojas) XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(aoa), n);
    return new File([XLSX.write(libro, { bookType: 'xlsx', type: 'array' })], nombre, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  };
  const subirPlantilla = async (archivo = plantillaXlsx()) => {
    fireEvent.change(await screen.findByTestId('mx-input-excel'), { target: { files: [archivo] } });
    await screen.findByText(archivo.name);
  };
  const estadoGuardado = (tipo: 'mi-excel' | 'plantilla', paso: number, nombre: string) => ({
    v: 1, tipo, paso,
    archivo: { nombre, sha256: 'x', hojaIndex: 0, filaEncabezados: 0, recortado: false, filas: 2 },
    mapping: { oficial: { sku_proveedor: '0' }, extras: {}, valueMap: {} },
    opcionalesVacios: [], fotos: { asignaciones: {}, origen: null, totalDisponibles: 0 }, vistaPaso4: 'tarjetas', publicacion: null,
  });
  const guardada = (tipo: 'MI_EXCEL' | 'PLANTILLA', paso: number, nombre: string) => ({
    tipo, estadoJson: JSON.stringify(estadoGuardado(tipo === 'PLANTILLA' ? 'plantilla' : 'mi-excel', paso, nombre)), paso, version: 1,
    archivoNombre: nombre, archivoSha256: 'x', archivoRecortado: false, tieneArchivo: true, imagenes: [],
    createdAt: '2026-09-29T12:00:00Z', updatedAt: '2026-09-30T09:15:00Z',
  });

  beforeEach(() => {
    rutas.push({ incluye: 'excel/mapeos', respuesta: () => respuestaJson([]) });
  });

  it('la reconoce, se salta "Relaciona" y muestra 3 pasos; la fila de ejemplo no se carga', async () => {
    rutas.push({ incluye: 'borrador-carga/todos', metodo: 'GET', respuesta: () => respuestaJson([]) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'GET', respuesta: () => ({ ok: true, status: 204, json: async () => null }) });
    montar();
    await subirPlantilla();

    expect(screen.getByRole('status')).toHaveTextContent(/Es la plantilla de RepuesTop/);
    expect(screen.getByRole('status')).toHaveTextContent(/La fila de ejemplo \(SKU-001\) no se carga/);
    const pasos = within(screen.getByRole('list', { name: 'Pasos de la carga' })).getAllByRole('listitem');
    expect(pasos.map((p) => p.textContent)).toEqual([
      expect.stringMatching(/^1Sube tu archivo/), expect.stringMatching(/^2Corrige/), expect.stringMatching(/^3Revisa y publica/),
    ]);
    expect(screen.queryByText('¿Estamos leyendo bien tu archivo?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Siguiente: corregir/ }));
    // Directo a la tabla, sin pasar por "Relaciona": sólo el repuesto real, sin el de ejemplo.
    expect(await screen.findByRole('button', { name: /Fotos de Pastilla freno/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fotos de Filtro de aceite Toyota Yaris/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Relaciona tus columnas/)).not.toBeInTheDocument();

    // "Atrás" vuelve a subir el archivo, no a "Relaciona".
    fireEvent.click(screen.getByRole('button', { name: /^Atrás/ }));
    expect(await screen.findByText('Tu Excel de inventario')).toBeInTheDocument();
  });

  it('una plantilla antigua, con otras columnas, no es la plantilla: pasa por "Relaciona" (prueba del 30-sep)', async () => {
    rutas.push({ incluye: 'borrador-carga/todos', metodo: 'GET', respuesta: () => respuestaJson([]) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'GET', respuesta: () => ({ ok: true, status: 204, json: async () => null }) });
    montar();
    const sinAlgunas = columnas.filter((c) => !['subcategoria', 'tipo_precio', 'requiere_chasis'].includes(c));
    await subirPlantilla(plantillaXlsx([
      ['inventario', [sinAlgunas, sinAlgunas.map((c) => (c === 'sku_proveedor' ? 'PF-1' : c === 'nombre_publicado' ? 'Pastilla' : ''))]],
      ['instrucciones', [['VERSION_PLANTILLA: 1.2.0']]],
    ], 'plantilla-antigua.xlsx'));

    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(/Es tu propio Excel/);
    expect(within(screen.getByRole('list', { name: 'Pasos de la carga' })).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Siguiente: relacionar columnas/ })).toBeEnabled();
  });

  it('con una carga de cada tipo guardada pregunta cuál retomar y retoma la plantilla en su paso', async () => {
    const lista = [guardada('PLANTILLA', 3, 'plantilla-llena.csv'), guardada('MI_EXCEL', 2, 'mi-lista.csv')];
    rutas.push({ incluye: 'borrador-carga/todos', metodo: 'GET', respuesta: () => respuestaJson(lista) });
    rutas.push({ incluye: 'borrador-carga/archivo', metodo: 'GET', respuesta: () => ({ ok: true, status: 200, blob: async () => new Blob([PLANTILLA_CSV], { type: 'text/csv' }) }) });
    montar();

    const dialogo = await screen.findByRole('dialog', { name: 'Tienes 2 cargas sin terminar' });
    const plantilla = within(dialogo).getByRole('region', { name: 'Carga sin terminar: Plantilla de RepuesTop' });
    expect(plantilla).toHaveTextContent('Ibas en el paso 2 de 3: Corrige');
    expect(within(dialogo).getByRole('region', { name: 'Carga sin terminar: Tu propio Excel' })).toHaveTextContent('Ibas en el paso 2 de 4: Relaciona');

    fireEvent.click(within(plantilla).getByRole('button', { name: /Continuar esta carga/ }));
    expect(await screen.findByRole('button', { name: /Fotos de Pastilla freno/ })).toBeInTheDocument();
    expect(llamadas.some((l) => l.url.endsWith('/borrador-carga/archivo?tipo=PLANTILLA'))).toBe(true);
  });

  it('subir una plantilla con otra plantilla guardada avisa que la reemplaza; la del propio Excel no se toca', async () => {
    rutas.push({ incluye: 'borrador-carga/todos', metodo: 'GET', respuesta: () => respuestaJson([guardada('MI_EXCEL', 2, 'mi-lista.csv')]) });
    rutas.push({ incluye: 'borrador-carga?tipo=PLANTILLA', metodo: 'GET', respuesta: () => respuestaJson(guardada('PLANTILLA', 3, 'plantilla-vieja.csv')) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'DELETE', respuesta: () => ({ ok: true, status: 204, json: async () => ({}) }) });
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Empezar otra carga' }));
    await subirPlantilla();

    const aviso = await screen.findByRole('dialog', { name: 'Ya tienes una plantilla sin terminar' });
    expect(aviso).toHaveTextContent('plantilla-vieja.csv');
    fireEvent.click(within(aviso).getByRole('button', { name: /Reemplazarla con el archivo nuevo/ }));
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'DELETE' && l.url.endsWith('/borrador-carga?tipo=PLANTILLA'))).toBe(true));
    expect(llamadas.some((l) => l.metodo === 'DELETE' && l.url.endsWith('?tipo=MI_EXCEL'))).toBe(false);
  });
});

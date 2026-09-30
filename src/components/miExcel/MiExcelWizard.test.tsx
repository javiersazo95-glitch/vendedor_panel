import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as XLSX from 'xlsx';

vi.mock('../../utils/session', async (original) => ({
  ...(await original<typeof import('../../utils/session')>()),
  getStoredSession: () => ({ sellerId: '1', token: 'token-de-prueba', email: 'a@b.cl', role: 'PROVEEDOR' }),
}));

import { MiExcelWizard } from './MiExcelWizard';

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

const montar = (extra: Partial<React.ComponentProps<typeof MiExcelWizard>> = {}) => {
  const props = {
    onVolver: vi.fn(), onClose: vi.fn(), onUploadSuccess: vi.fn(), onAnchoCompletoChange: vi.fn(), ...extra,
  };
  render(<MiExcelWizard {...props} />);
  return props;
};

const subirCsv = async () => {
  const archivo = new File([CSV], 'mi-inventario.csv', { type: 'text/csv' });
  fireEvent.change(await screen.findByTestId('mx-input-excel'), { target: { files: [archivo] } });
  await screen.findByText('mi-inventario.csv');
};

describe('Mi propio Excel: etapas 1 y 2', () => {
  beforeEach(() => {
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
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'PUT' && l.url.endsWith('/borrador-carga'))).toBe(true));
    const put = llamadas.find((l) => l.metodo === 'PUT' && l.url.endsWith('/borrador-carga'));
    const cuerpo = JSON.parse(String(put?.body));
    expect(JSON.parse(cuerpo.estadoJson).archivo.nombre).toBe('mi-inventario.csv');
    expect(cuerpo.versionEsperada).toBeNull();
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'PUT' && l.url.endsWith('/borrador-carga/archivo'))).toBe(true));
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
    rutas.push({ incluye: 'borrador-carga', metodo: 'GET', respuesta: () => respuestaJson(borrador) });
    rutas.push({ incluye: 'borrador-carga', metodo: 'DELETE', respuesta: () => ({ ok: true, status: 204, json: async () => ({}) }) });
    rutas.push({ incluye: 'excel/mapeos', respuesta: () => respuestaJson([]) });
  });

  it('avisa que hay un progreso guardado, con su fecha y hora', async () => {
    montar();
    expect(await screen.findByText(/Hemos notado que tienes un progreso guardado el/)).toBeInTheDocument();
    const fecha = new Date(borrador.updatedAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    expect(screen.getByText(fecha)).toBeInTheDocument();
    expect(screen.getByText('Paso 3 de 4: Completa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retomar desde el punto guardado/ })).toBeInTheDocument();
  });

  it('retomar vuelve a la etapa donde iba y explica por qué hay que volver a elegir las fotos', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Retomar desde el punto guardado/ }));
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

  it('"Retomar desde el punto guardado" en la pregunta retoma sin volver a preguntar', async () => {
    montar({ retomarDirecto: true });
    expect(await screen.findByText('Vuelve a elegir tus fotos')).toBeInTheDocument();
    expect(screen.queryByText(/Hemos notado que tienes un progreso guardado/)).not.toBeInTheDocument();
  });

  it('descartar pide confirmación, borra lo guardado y empieza de cero', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Descartar y empezar de cero/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, descartar y empezar de cero/ }));
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'DELETE' && l.url.endsWith('/borrador-carga'))).toBe(true));
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
    montar({ retomarDirecto: true });
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

    // "Corregir en la tabla" lleva a la fila, la explica arriba y abre la celda del dato con problema.
    fireEvent.click(screen.getByRole('button', { name: 'Corregir Disco freno' }));
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
    montar({ retomarDirecto: true });
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

  it('revisa con el servidor, muestra lista y cuadrícula, publica, sube las fotos y borra lo guardado', async () => {
    const props = montar({ retomarDirecto: true });
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
    expect(llamadas.some((l) => l.metodo === 'DELETE' && l.url.endsWith('/borrador-carga'))).toBe(true);
    expect(props.onUploadSuccess).toHaveBeenCalled();
  });
});

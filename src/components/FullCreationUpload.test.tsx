import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as XLSX from 'xlsx';

vi.mock('../utils/session', async (original) => ({
  ...(await original<typeof import('../utils/session')>()),
  getStoredSession: () => ({ sellerId: '1', token: 'token-de-prueba' }),
}));

import { FullCreationUpload } from './FullCreationUpload';

/**
 * Fase 8 del plan de auditoría de carga: con la plantilla oficial, el camino feliz es archivo →
 * un modal "¿Publicar?" → listo. Antes eran "Analizar Carga", "Iniciar Carga" y un modal de fotos.
 */
const filasOk = [
  { fila: 2, sku: 'PF-1', estado: 'OK', mensajes: [] },
  { fila: 3, sku: 'PF-2', estado: 'ADVERTENCIA', mensajes: ['Subcategoría no encontrada'] },
];
const respuesta = (extra: Record<string, unknown> = {}) => ({
  totalFilas: 2,
  productosCargados: 2,
  productosConError: 0,
  productosConAdvertencia: 1,
  errores: [],
  advertencias: [],
  filas: filasOk,
  ...extra,
});

let respuestaCarga: Record<string, unknown> = respuesta({ estado: 'COMPLETADA', jobId: 9 });

const llamadas = (ruta: string) => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes(ruta));

beforeEach(() => {
  try {
    // El aviso "no seleccionaste fotos" tiene su propio test; aquí se salta como lo haría
    // un vendedor que marcó "No volver a preguntar".
    localStorage.setItem('repuestop_no_preguntar_fotos', '1');
  } catch {
    // sin almacenamiento
  }
  respuestaCarga = respuesta({ estado: 'COMPLETADA', jobId: 9 });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const texto = String(url);
    if (texto.includes('/excel/validar')) return { ok: true, status: 200, json: async () => respuesta() };
    if (texto.includes('/excel/cargar')) return { ok: true, status: 200, json: async () => respuestaCarga };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  try {
    localStorage.removeItem('repuestop_no_preguntar_fotos');
  } catch {
    // sin almacenamiento
  }
});

function plantilla(): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['sku_proveedor'], ['PF-1'], ['PF-2']]), 'inventario');
  return new File([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], 'inventario.xlsx');
}

async function subirYRevisar(onBusyChange = vi.fn()) {
  render(<FullCreationUpload isOpen embedded onClose={() => {}} onUploadSuccess={() => {}} onVolver={() => {}} onBusyChange={onBusyChange} />);
  const input = document.querySelector('input[type="file"][accept=".xlsx,.xls"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [plantilla()] } });
  const revisar = screen.getByRole('button', { name: /Revisar mi archivo/ });
  await waitFor(() => expect(revisar).not.toBeDisabled());
  fireEvent.click(revisar);
}

describe('Publicar con la plantilla de RepuesTop', () => {
  it('sin errores pregunta una sola vez "¿Publicar?" y publica con una llamada', async () => {
    const onBusyChange = vi.fn();
    await subirYRevisar(onBusyChange);

    expect(await screen.findByText('Se van a publicar 2 repuestos')).toBeInTheDocument();
    expect(screen.getByText(/1 tiene un aviso/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, publicar' }));

    expect(await screen.findByText('¡Listo! Publicamos 2 repuestos')).toBeInTheDocument();
    expect(llamadas('/excel/cargar')).toHaveLength(1);
    // Mientras revisaba y publicaba avisó que estaba ocupado (el menú no deja salir), y al
    // terminar lo liberó.
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('un doble clic en publicar no carga dos veces', async () => {
    await subirYRevisar();
    await screen.findByText('Se van a publicar 2 repuestos');
    fireEvent.click(screen.getByRole('button', { name: 'Todavía no' }));

    const publicar = screen.getByRole('button', { name: 'Publicar 2 repuestos' });
    fireEvent.click(publicar);
    fireEvent.click(publicar);

    await screen.findByText('¡Listo! Publicamos 2 repuestos');
    expect(llamadas('/excel/cargar')).toHaveLength(1);
  });

  it('si el archivo ya se había cargado, lo dice en vez de mostrarlo como nuevo', async () => {
    respuestaCarga = respuesta({ estado: 'COMPLETADA', jobId: 9, archivoRepetido: true, archivoYaCargadoEl: '2026-09-28T15:00:00Z' });
    await subirYRevisar();
    await screen.findByText('Se van a publicar 2 repuestos');
    fireEvent.click(screen.getByRole('button', { name: 'Sí, publicar' }));

    expect(await screen.findByText(/Este archivo ya se había cargado el/)).toBeInTheDocument();
    expect(screen.getByText(/No lo volvimos a publicar/)).toBeInTheDocument();
  });

  it('con filas con error no pregunta: ofrece publicar las que están bien y el Excel de errores va por botón', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      const texto = String(url);
      if (texto.includes('/excel/validar')) {
        return {
          ok: true,
          status: 200,
          json: async () => respuesta({
            productosCargados: 1,
            productosConError: 1,
            productosConAdvertencia: 0,
            filas: [filasOk[0], { fila: 3, sku: 'PF-2', estado: 'ERROR', mensajes: ['Falta la categoría'] }],
          }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    const crearUrl = vi.spyOn(URL, 'createObjectURL');

    await subirYRevisar();

    expect(await screen.findByRole('button', { name: 'Publicar el que está bien' })).toBeInTheDocument();
    expect(screen.queryByText(/Se van a publicar/)).not.toBeInTheDocument();
    expect(crearUrl).not.toHaveBeenCalled();
  });
});

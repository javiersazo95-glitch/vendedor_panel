import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConversacionSoporte, type ConversacionSoporteProps } from './ConversacionSoporte';
import type { ChatVendedor, MensajeSoporte } from '../../utils/soporteCargaApi';

vi.mock('../../utils/useImagenPrivada', () => ({
  useImagenPrivada: () => ({ url: 'blob:foto', cargando: false, error: false }),
}));

const CHAT: ChatVendedor = {
  id: 5,
  motivo: 'AYUDA_CARGA',
  motivoDetalle: 'hola',
  estado: 'ESPERANDO_SOPORTE',
  contexto: null,
  ultimoMensajeAutor: 'VENDEDOR',
  ultimoMensajeAt: '2026-09-30T10:00:00-03:00',
  noLeidos: 0,
  createdAt: '2026-09-30T10:00:00-03:00',
  cerradoAt: null,
  cierreAutomaticoAt: null,
};

const MENSAJES: MensajeSoporte[] = [
  { id: 1, autor: 'SISTEMA', autorNombre: null, texto: 'Conversación iniciada: Ayuda para cargar mi inventario', imagenUrl: null, createdAt: '2026-09-30T10:00:00-03:00' },
  { id: 2, autor: 'VENDEDOR', autorNombre: null, texto: 'No sé qué columna elegir', imagenUrl: null, createdAt: '2026-09-30T10:00:00-03:00' },
];

function renderizar(props: Partial<ConversacionSoporteProps> = {}) {
  const base: ConversacionSoporteProps = {
    chat: CHAT,
    mensajes: MENSAJES,
    onEnviarTexto: vi.fn().mockResolvedValue(undefined),
    onEnviarImagen: vi.fn().mockResolvedValue(undefined),
    onCerrar: vi.fn().mockResolvedValue(undefined),
    onMarcarLeido: vi.fn(),
    onNuevaConversacion: vi.fn(),
  };
  const todas = { ...base, ...props };
  return { ...render(<ConversacionSoporte {...todas} />), props: todas };
}

describe('ConversacionSoporte', () => {
  afterEach(() => vi.clearAllMocks());

  it('muestra el estado en palabras simples y los mensajes', () => {
    renderizar();
    expect(screen.getByText('Esperando respuesta de soporte')).toBeInTheDocument();
    expect(screen.getByText('No sé qué columna elegir')).toBeInTheDocument();
    expect(screen.getByText('Conversación iniciada: Ayuda para cargar mi inventario')).toBeInTheDocument();
  });

  it.each([
    ['EN_ATENCION', 'Soporte está revisando tu caso'],
    ['ESPERANDO_VENDEDOR', 'Soporte te respondió'],
  ] as const)('estado %s', (estado, texto) => {
    renderizar({ chat: { ...CHAT, estado } });
    expect(screen.getByText(texto)).toBeInTheDocument();
  });

  it('muestra el nombre de quien responde de soporte y avisa el cierre automatico', () => {
    renderizar({
      chat: { ...CHAT, estado: 'ESPERANDO_VENDEDOR', cierreAutomaticoAt: '2026-10-01T14:05:00-03:00' },
      mensajes: [...MENSAJES, { id: 3, autor: 'SOPORTE', autorNombre: 'Camila', texto: 'Hola, te ayudo', imagenUrl: null, createdAt: '2026-09-30T10:05:00-03:00' }],
    });
    expect(screen.getByText('Camila')).toBeInTheDocument();
    expect(screen.getByText(/si no respondes, esta conversación se cerrará sola el/i)).toBeInTheDocument();
  });

  it('marca como leido al ver mensajes de soporte', () => {
    const { props } = renderizar({
      chat: { ...CHAT, noLeidos: 1 },
      mensajes: [...MENSAJES, { id: 3, autor: 'SOPORTE', autorNombre: null, texto: 'Hola', imagenUrl: null, createdAt: '2026-09-30T10:05:00-03:00' }],
    });
    expect(props.onMarcarLeido).toHaveBeenCalled();
    expect(screen.getByText('Soporte RepuesTop')).toBeInTheDocument();
  });

  it('envia con Enter y limpia el cuadro; Shift+Enter no envia', async () => {
    const { props } = renderizar();
    const cuadro = screen.getByLabelText('Escribe tu mensaje');

    fireEvent.change(cuadro, { target: { value: 'Gracias' } });
    fireEvent.keyDown(cuadro, { key: 'Enter', shiftKey: true });
    expect(props.onEnviarTexto).not.toHaveBeenCalled();

    fireEvent.keyDown(cuadro, { key: 'Enter' });
    await waitFor(() => expect(props.onEnviarTexto).toHaveBeenCalledWith('Gracias'));
    await waitFor(() => expect(cuadro).toHaveValue(''));
  });

  it('muestra un error si no se pudo enviar y conserva el texto', async () => {
    const { props } = renderizar({ onEnviarTexto: vi.fn().mockRejectedValue(new Error('Failed to fetch')) });
    fireEvent.change(screen.getByLabelText('Escribe tu mensaje'), { target: { value: 'hola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos enviar tu mensaje/i);
    expect(props.onEnviarTexto).toHaveBeenCalled();
    expect(screen.getByLabelText('Escribe tu mensaje')).toHaveValue('hola');
  });

  it('adjunta una imagen con vista previa y la envia', async () => {
    // jsdom no implementa createObjectURL: se agrega solo para esta prueba.
    const originales = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn(() => 'blob:previa');
    URL.revokeObjectURL = vi.fn();
    try {
      const { props } = renderizar();
      const archivo = new File(['abc'], 'captura.png', { type: 'image/png' });
      fireEvent.change(screen.getByTestId('soporte-input-imagen'), { target: { files: [archivo] } });

      expect(screen.getByAltText('Imagen que vas a enviar')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await waitFor(() => expect(props.onEnviarImagen).toHaveBeenCalledWith(archivo, undefined));
      await waitFor(() => expect(screen.queryByAltText('Imagen que vas a enviar')).not.toBeInTheDocument());
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:previa');
    } finally {
      URL.createObjectURL = originales.crear;
      URL.revokeObjectURL = originales.revocar;
    }
  });

  it('cierra la conversacion solo despues de confirmar', async () => {
    const { props } = renderizar();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar conversación' }));

    const dialogo = screen.getByRole('alertdialog');
    expect(dialogo).toHaveTextContent('¿Ya resolviste tu duda?');

    fireEvent.click(screen.getByRole('button', { name: 'No, seguir conversando' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(props.onCerrar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar conversación' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cerrar conversación' }));
    await waitFor(() => expect(props.onCerrar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('cerrada: no deja escribir y ofrece abrir una nueva', () => {
    const { props } = renderizar({ chat: { ...CHAT, estado: 'CERRADO_POR_INACTIVIDAD', cerradoAt: '2026-10-01T10:00:00-03:00' } });

    expect(screen.getByText('Conversación cerrada')).toBeInTheDocument();
    expect(screen.getByText(/no hubo respuesta en 24 horas/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Escribe tu mensaje')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar conversación' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir una nueva conversación' }));
    expect(props.onNuevaConversacion).toHaveBeenCalled();
  });

  it('abre la imagen de un mensaje en grande', () => {
    renderizar({
      mensajes: [{ id: 9, autor: 'SOPORTE', autorNombre: null, texto: null, imagenUrl: '/api/v1/uploads/r2/Soporte_carga/x.jpg', createdAt: '2026-09-30T10:05:00-03:00' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ver imagen en grande' }));
    expect(screen.getByRole('dialog', { name: 'Imagen en grande' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar imagen' }));
    expect(screen.queryByRole('dialog', { name: 'Imagen en grande' })).not.toBeInTheDocument();
  });
});

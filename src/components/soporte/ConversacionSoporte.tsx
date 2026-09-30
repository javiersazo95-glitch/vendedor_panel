import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import {
  esChatCerrado,
  esTipoImagenPermitido,
  TEXTO_MAX,
  type ChatVendedor,
  type MensajeSoporte as Mensaje,
} from '../../utils/soporteCargaApi';
import { MensajeSoporte } from './MensajeSoporte';
import { formatearFechaHora, mensajeDeError, textoEstado, textoMotivo, textoMotivoCierre } from './textosSoporte';

export interface ConversacionSoporteProps {
  chat: ChatVendedor;
  mensajes: Mensaje[];
  onEnviarTexto: (texto: string) => Promise<void>;
  onEnviarImagen: (archivo: File, texto?: string) => Promise<void>;
  onCerrar: () => Promise<void>;
  onMarcarLeido: () => void | Promise<void>;
  onNuevaConversacion: () => void;
}

const ERROR_ENVIO = 'No pudimos enviar tu mensaje. Revisa tu conexión e intenta de nuevo.';

function Estado({ chat }: { chat: ChatVendedor }) {
  const cerrado = esChatCerrado(chat.estado);
  return (
    <div className={`soporte-estado soporte-estado-${chat.estado.toLowerCase().replace(/_/g, '-')}`} role="status">
      <span className="soporte-estado-punto" aria-hidden="true" />
      <div>
        <strong>{textoEstado(chat.estado)}</strong>
        {cerrado ? (
          <span className="soporte-estado-detalle">{textoMotivoCierre(chat.estado)}</span>
        ) : (
          <span className="soporte-estado-detalle">Motivo: {textoMotivo(chat.motivo)}</span>
        )}
      </div>
    </div>
  );
}

export function ConversacionSoporte({
  chat,
  mensajes,
  onEnviarTexto,
  onEnviarImagen,
  onCerrar,
  onMarcarLeido,
  onNuevaConversacion,
}: ConversacionSoporteProps) {
  const cerrado = esChatCerrado(chat.estado);
  const [texto, setTexto] = useState('');
  const [imagen, setImagen] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);

  const listaRef = useRef<HTMLOListElement>(null);
  const inputArchivoRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pegadoAbajoRef = useRef(true);

  const vistaPrevia = useMemo(() => (imagen ? URL.createObjectURL(imagen) : null), [imagen]);
  useEffect(() => {
    return () => {
      if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
    };
  }, [vistaPrevia]);

  // Bajar al ultimo mensaje cuando llega uno nuevo, salvo que el vendedor este leyendo mas arriba.
  const ultimoId = mensajes.length > 0 ? mensajes[mensajes.length - 1].id : 0;
  const ultimoEsMio = mensajes.length > 0 && mensajes[mensajes.length - 1].autor === 'VENDEDOR';
  useLayoutEffect(() => {
    const lista = listaRef.current;
    if (!lista) return;
    if (pegadoAbajoRef.current || ultimoEsMio) lista.scrollTop = lista.scrollHeight;
  }, [ultimoId, ultimoEsMio, chat.id]);

  // Con el panel abierto, lo que responde soporte ya se esta viendo: marcarlo como leido.
  const ultimoDeSoporte = mensajes.reduce((max, m) => (m.autor === 'SOPORTE' && m.id > max ? m.id : max), 0);
  const hayNoLeidos = chat.noLeidos > 0;
  useEffect(() => {
    if (hayNoLeidos || ultimoDeSoporte > 0) void onMarcarLeido();
    // Solo cuando llega algo nuevo de soporte o cambia la conversacion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, ultimoDeSoporte, hayNoLeidos]);

  const alHacerScroll = () => {
    const lista = listaRef.current;
    if (!lista) return;
    pegadoAbajoRef.current = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 80;
  };

  const puedeEnviar = !enviando && (imagen !== null || texto.trim().length > 0);

  const enviar = async () => {
    if (!puedeEnviar || cerrado) return;
    setEnviando(true);
    setError(null);
    try {
      if (imagen) await onEnviarImagen(imagen, texto.trim() || undefined);
      else await onEnviarTexto(texto);
      setTexto('');
      setImagen(null);
      pegadoAbajoRef.current = true;
    } catch (err) {
      setError(mensajeDeError(err, ERROR_ENVIO));
    } finally {
      setEnviando(false);
      textareaRef.current?.focus();
    }
  };

  const alEnviarFormulario = (e: FormEvent) => {
    e.preventDefault();
    void enviar();
  };

  const alPresionarTecla = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void enviar();
    }
  };

  const alElegirImagen = (archivo: File | undefined) => {
    if (inputArchivoRef.current) inputArchivoRef.current.value = '';
    if (!archivo) return;
    if (!esTipoImagenPermitido(archivo.type)) {
      setError('Solo puedes adjuntar fotos JPG, PNG o WEBP.');
      return;
    }
    setError(null);
    setImagen(archivo);
  };

  const confirmarCierre = async () => {
    setCerrando(true);
    setErrorCierre(null);
    try {
      await onCerrar();
      setConfirmandoCierre(false);
    } catch (err) {
      setErrorCierre(mensajeDeError(err, 'No pudimos cerrar la conversación. Intenta de nuevo.'));
    } finally {
      setCerrando(false);
    }
  };

  const escapeEnDialogo = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!cerrando) setConfirmandoCierre(false);
    }
  };

  const cierreAutomatico = !cerrado && chat.cierreAutomaticoAt ? formatearFechaHora(chat.cierreAutomaticoAt) : '';

  return (
    <div className="soporte-conversacion">
      <div className="soporte-conversacion-barra">
        <Estado chat={chat} />
        {!cerrado && (
          <button type="button" className="soporte-enlace" onClick={() => setConfirmandoCierre(true)}>
            Cerrar conversación
          </button>
        )}
      </div>

      <ol className="soporte-mensajes" ref={listaRef} onScroll={alHacerScroll} aria-label="Mensajes" aria-live="polite">
        {mensajes.map((m) => (
          <MensajeSoporte key={m.id} mensaje={m} />
        ))}
        {mensajes.length === 0 && <li className="soporte-mensajes-vacio">Cargando mensajes…</li>}
      </ol>

      {cierreAutomatico && (
        <p className="soporte-nota">Si no respondes, esta conversación se cerrará sola el {cierreAutomatico}.</p>
      )}

      {cerrado ? (
        <div className="soporte-cerrada">
          <p>Esta conversación está cerrada y ya no puedes escribir en ella.</p>
          <button type="button" className="btn btn-primary" onClick={onNuevaConversacion}>
            Abrir una nueva conversación
          </button>
        </div>
      ) : (
        <form className="soporte-composer" onSubmit={alEnviarFormulario}>
          {vistaPrevia && (
            <div className="soporte-adjunto">
              <img src={vistaPrevia} alt="Imagen que vas a enviar" />
              <span className="soporte-adjunto-nombre">{imagen?.name}</span>
              <button
                type="button"
                className="soporte-icono-boton"
                onClick={() => setImagen(null)}
                aria-label="Quitar imagen"
                disabled={enviando}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {error && (
            <p className="soporte-error" role="alert">
              {error}
            </p>
          )}
          <div className="soporte-composer-fila">
            <input
              ref={inputArchivoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="soporte-oculto"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => alElegirImagen(e.target.files?.[0])}
              data-testid="soporte-input-imagen"
            />
            <button
              type="button"
              className="soporte-icono-boton"
              onClick={() => inputArchivoRef.current?.click()}
              disabled={enviando}
              aria-label="Adjuntar una imagen"
              title="Adjuntar una imagen (JPG, PNG o WEBP)"
            >
              <ImagePlus size={20} aria-hidden="true" />
            </button>
            <textarea
              ref={textareaRef}
              className="soporte-textarea"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={alPresionarTecla}
              placeholder={imagen ? 'Agrega un comentario (opcional)' : 'Escribe tu mensaje'}
              aria-label="Escribe tu mensaje"
              maxLength={TEXTO_MAX}
              rows={2}
              readOnly={enviando}
            />
            <button
              type="submit"
              className="soporte-enviar"
              disabled={!puedeEnviar}
              aria-label={enviando ? 'Enviando' : 'Enviar'}
              title="Enviar (Enter). Usa Shift + Enter para bajar de línea."
            >
              {enviando ? <Loader2 size={18} className="soporte-girando" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
            </button>
          </div>
        </form>
      )}

      {confirmandoCierre && (
        <div className="soporte-dialogo-fondo" onKeyDown={escapeEnDialogo}>
          <div
            className="soporte-dialogo"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="soporte-cerrar-titulo"
            aria-describedby="soporte-cerrar-texto"
          >
            <h3 id="soporte-cerrar-titulo">¿Cerrar la conversación?</h3>
            <p id="soporte-cerrar-texto">
              ¿Ya resolviste tu duda? Al cerrar la conversación ya no podrás escribir en ella; si necesitas más ayuda
              podrás abrir una nueva.
            </p>
            {errorCierre && (
              <p className="soporte-error" role="alert">
                {errorCierre}
              </p>
            )}
            <div className="soporte-dialogo-acciones">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmandoCierre(false)}
                disabled={cerrando}
                autoFocus
              >
                No, seguir conversando
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void confirmarCierre()} disabled={cerrando}>
                {cerrando ? 'Cerrando…' : 'Sí, cerrar conversación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

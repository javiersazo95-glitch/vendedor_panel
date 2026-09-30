import { useEffect, type KeyboardEvent } from 'react';
import { History, Loader2, WifiOff, X } from 'lucide-react';
import type { ChatSoporte } from '../../utils/useChatSoporte';
import { useFocusTrap } from '../../utils/useFocusTrap';
import { ConversacionSoporte } from './ConversacionSoporte';
import { NuevaConversacion } from './NuevaConversacion';
import { formatearFechaHora } from './textosSoporte';

export interface PanelSoporteProps {
  soporte: ChatSoporte;
  onCerrar: () => void;
}

/** Ventana del chat: abajo a la derecha en escritorio, pantalla completa en el celular. */
export function PanelSoporte({ soporte, onCerrar }: PanelSoporteProps) {
  const contenedorRef = useFocusTrap(true);

  // useFocusTrap no mueve el foco al abrir: se lleva al panel para que el teclado y los lectores
  // de pantalla empiecen aqui (y al cerrar vuelve solo al boton de soporte).
  useEffect(() => {
    contenedorRef.current?.focus();
  }, [contenedorRef]);

  const alPresionarTecla = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCerrar();
    }
  };

  const { chat, chatCargado, ultimoChatCerrado } = soporte;

  let contenido;
  if (!chatCargado) {
    contenido = (
      <div className="soporte-cargando" role="status">
        <Loader2 size={22} className="soporte-girando" aria-hidden="true" /> Cargando…
      </div>
    );
  } else if (chat) {
    contenido = (
      <ConversacionSoporte
        chat={chat}
        mensajes={soporte.mensajes}
        onEnviarTexto={soporte.enviarTexto}
        onEnviarImagen={soporte.enviarImagen}
        onCerrar={soporte.cerrar}
        onMarcarLeido={soporte.marcarLeido}
        onNuevaConversacion={soporte.nuevaConversacion}
      />
    );
  } else {
    contenido = (
      <div className="soporte-scroll">
        <NuevaConversacion onCrear={soporte.crear} />
        {ultimoChatCerrado && (
          <button type="button" className="soporte-enlace soporte-historial" onClick={() => void soporte.verChat(ultimoChatCerrado)}>
            <History size={16} aria-hidden="true" />
            Ver tu última conversación
            {ultimoChatCerrado.cerradoAt ? ` (cerrada el ${formatearFechaHora(ultimoChatCerrado.cerradoAt)})` : ''}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={contenedorRef}
      className="soporte-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="soporte-panel-titulo"
      tabIndex={-1}
      onKeyDown={alPresionarTecla}
    >
      <header className="soporte-panel-cabecera">
        <div>
          <h2 id="soporte-panel-titulo">Soporte RepuesTop</h2>
          <p>Te ayudamos a cargar tu inventario</p>
        </div>
        <button type="button" className="soporte-icono-boton soporte-panel-cerrar" onClick={onCerrar} aria-label="Cerrar ventana de soporte">
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      {soporte.sinConexion && (
        <p className="soporte-aviso soporte-aviso-conexion" role="status">
          <WifiOff size={16} aria-hidden="true" /> Sin conexión. Seguimos intentando…
        </p>
      )}
      {soporte.aviso && (
        <p className="soporte-aviso" role="status">
          <span>{soporte.aviso}</span>
          <button type="button" className="soporte-icono-boton" onClick={soporte.descartarAviso} aria-label="Ocultar aviso">
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      )}

      <div className="soporte-panel-cuerpo">{contenido}</div>
    </div>
  );
}

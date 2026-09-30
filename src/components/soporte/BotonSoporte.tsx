import { useState } from 'react';
import { Headset, X } from 'lucide-react';
import { useChatSoporte } from '../../utils/useChatSoporte';
import { PanelSoporte } from './PanelSoporte';
import './soporte.css';

const AYUDA = '¿Necesitas ayuda? Habla con soporte';

/**
 * Boton flotante de soporte (abajo a la derecha, en todo el panel) con el numero de mensajes
 * de soporte sin leer. Abre y cierra la ventana del chat.
 */
export function BotonSoporte() {
  const [abierto, setAbierto] = useState(false);
  const soporte = useChatSoporte({ abierto });
  const noLeidos = soporte.resumen?.noLeidos ?? 0;

  const etiqueta = abierto
    ? 'Cerrar ventana de soporte'
    : noLeidos > 0
      ? `${AYUDA}. Tienes ${noLeidos} ${noLeidos === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}`
      : AYUDA;

  return (
    <>
      <div className={`soporte-flotante${abierto ? ' soporte-flotante-abierto' : ''}`}>
        {!abierto && (
          <span className="soporte-tooltip" aria-hidden="true">
            {AYUDA}
          </span>
        )}
        <button
          type="button"
          className="soporte-boton"
          onClick={() => setAbierto((v) => !v)}
          aria-label={etiqueta}
          aria-expanded={abierto}
          aria-haspopup="dialog"
        >
          {abierto ? <X size={26} aria-hidden="true" /> : <Headset size={26} aria-hidden="true" />}
          {!abierto && noLeidos > 0 && (
            <span className="soporte-badge" data-testid="soporte-badge" aria-hidden="true">
              {noLeidos > 9 ? '9+' : noLeidos}
            </span>
          )}
        </button>
      </div>
      {abierto && <PanelSoporte soporte={soporte} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

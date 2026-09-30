/**
 * Piezas chicas que comparten las etapas del asistente "Mi propio Excel": la ventana de aviso y
 * la miniatura de una foto (en memoria o guardada en el servidor).
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageOff, X } from 'lucide-react';
import { useFocusTrap } from '../../utils/useFocusTrap';
import { useImagenPrivada } from '../../utils/useImagenPrivada';
import { rutaImagenBorrador } from '../../utils/miExcelBorrador';

interface ModalProps {
  titulo: string;
  children: React.ReactNode;
  acciones?: React.ReactNode;
  onCerrar?: () => void;
  /** Ancho máximo en px. */
  ancho?: number;
  icono?: React.ReactNode;
  tono?: 'normal' | 'aviso' | 'peligro';
}

/** Ventana centrada con fondo oscuro. Escape la cierra cuando se puede cerrar. */
export function Modal({ titulo, children, acciones, onCerrar, ancho = 520, icono, tono = 'normal' }: ModalProps) {
  const ref = useFocusTrap(true);
  useEffect(() => {
    if (!onCerrar) return undefined;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  return createPortal(
    <div className="mx-modal-fondo" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar?.(); }}>
      <div
        ref={ref}
        className={`mx-modal mx-modal-${tono}`}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        style={{ maxWidth: ancho }}
      >
        <header className="mx-modal-cabecera">
          {icono && <span className="mx-modal-icono">{icono}</span>}
          <h3>{titulo}</h3>
          {onCerrar && (
            <button type="button" className="mx-icono-btn" onClick={onCerrar} aria-label="Cerrar">
              <X size={18} />
            </button>
          )}
        </header>
        <div className="mx-modal-cuerpo">{children}</div>
        {acciones && <footer className="mx-modal-acciones">{acciones}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** URL temporal de un archivo en memoria, que se libera al dejar de mostrarse. */
function useUrlDeBlob(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== 'function') return undefined;
    const creada = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(creada);
    return () => {
      URL.revokeObjectURL(creada);
      setUrl(null);
    };
  }, [blob]);
  return url;
}

interface MiniaturaProps {
  nombre: string;
  /** La foto en memoria (carpeta o ZIP), si está. */
  blob?: Blob | null;
  /** Si no está en memoria, la copia guardada en el borrador. */
  imagenId?: number;
  tamano?: number;
}

/** Una foto chica. Si no hay de dónde sacarla, un recuadro que lo dice. */
export function Miniatura({ nombre, blob, imagenId, tamano = 44 }: MiniaturaProps) {
  const local = useUrlDeBlob(blob);
  const remota = useImagenPrivada(!blob && imagenId !== undefined ? rutaImagenBorrador(imagenId) : null);
  const url = local ?? remota.url;
  return (
    <span className="mx-miniatura" style={{ width: tamano, height: tamano }} title={nombre}>
      {url ? <img src={url} alt={nombre} loading="lazy" /> : <ImageOff size={Math.round(tamano / 2.4)} aria-label="Foto no disponible" />}
    </span>
  );
}

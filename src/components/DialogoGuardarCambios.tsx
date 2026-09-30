/**
 * "Tienes cambios sin guardar": el aviso que aparece al intentar salir de la carga de inventario
 * con trabajo pendiente. Tres salidas claras: guardar y salir, salir sin guardar, o quedarse.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Save } from 'lucide-react';
import { useFocusTrap } from '../utils/useFocusTrap';
import './miExcel/miExcel.css';

interface Props {
  onGuardarYSalir: () => Promise<boolean>;
  onSalirSinGuardar: () => void;
  onQuedarse: () => void;
}

export function DialogoGuardarCambios({ onGuardarYSalir, onSalirSinGuardar, onQuedarse }: Props) {
  const ref = useFocusTrap(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(false);

  const guardarYSalir = async () => {
    setGuardando(true);
    setError(false);
    const ok = await onGuardarYSalir();
    setGuardando(false);
    if (!ok) setError(true);
  };

  return createPortal(
    <div className="mx-modal-fondo" role="presentation">
      <div ref={ref} className="mx-modal mx-modal-aviso" role="alertdialog" aria-modal="true" aria-labelledby="dialogo-guardar-titulo" style={{ maxWidth: 480 }}>
        <header className="mx-modal-cabecera">
          <span className="mx-modal-icono"><Save size={18} /></span>
          <h3 id="dialogo-guardar-titulo">¿Quieres guardar tus cambios?</h3>
        </header>
        <div className="mx-modal-cuerpo">
          <p>
            Tienes cambios en tu carga de inventario que todavía no se guardaron. Si los guardas, la próxima vez que
            entres a <b>Mi propio Excel</b> podrás retomar desde este punto.
          </p>
          {error && <p className="mx-error-texto" role="alert">No pudimos guardar. Revisa tu conexión e inténtalo de nuevo, o sal sin guardar.</p>}
        </div>
        <footer className="mx-modal-acciones">
          <button type="button" className="btn btn-secondary mx-btn" onClick={onQuedarse} disabled={guardando}>Seguir aquí</button>
          <button type="button" className="btn btn-secondary mx-btn mx-btn-peligro" onClick={onSalirSinGuardar} disabled={guardando}>Salir sin guardar</button>
          <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={guardarYSalir} disabled={guardando} autoFocus>
            {guardando ? 'Guardando…' : 'Guardar y salir'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

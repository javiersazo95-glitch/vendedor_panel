import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileCheck, RotateCcw, X } from 'lucide-react';
import { useFocusTrap } from '../utils/useFocusTrap';

/**
 * Visor de un PDF servido por un enlace privado del backend.
 *
 * Es el port de `PrivateDocumentViewerModal` del market web, y las tres decisiones que trae de
 * allá siguen valiendo acá:
 *
 *  1. **Se baja a un blob**, no se manda el navegador a la URL del backend. El enlace dura 5
 *     minutos y, apenas se abre, un minuto más: con el blob un solo enlace sirve para ver Y para
 *     guardar, sin pedirle el archivo al backend una vez por cada cosa que el vendedor haga.
 *  2. **No se usa `window.open` después de un `await`**: queda fuera del gesto del usuario y los
 *     bloqueadores de popup lo matan sin aviso. Abrir un modal, no.
 *  3. La previsualización va en un `<object>` y no en un `<iframe>`: cuando el navegador no sabe
 *     dibujar un PDF embebido, el iframe queda en blanco y el `<object>` pinta su contenido de
 *     respaldo, que son los mismos botones de descargar y abrir en pestaña.
 */
interface DocumentViewerModalProps {
  loadUrl: () => Promise<string>;
  title: string;
  subtitle?: string;
  fileName: string;
  onClose: () => void;
}

type ViewerState = { status: 'loading' | 'ready' | 'error'; url: string | null; error: string };

export function DocumentViewerModal({ loadUrl, title, subtitle = '', fileName, onClose }: DocumentViewerModalProps) {
  const [state, setState] = useState<ViewerState>({ status: 'loading', url: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const dialogRef = useFocusTrap(true);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const url = await loadUrl();
        const response = await fetch(url);
        if (!response.ok) throw new Error('El enlace del documento expiró. Vuelve a intentarlo.');
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', url: objectUrl, error: '' });
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'error', url: null, error: err instanceof Error ? err.message : 'No pudimos abrir el documento.' });
      }
    })();

    return () => {
      cancelled = true;
      // Sin esto el PDF queda retenido en memoria mientras viva la pestaña.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `attempt` fuerza un enlace nuevo al reintentar: el anterior ya venció.
  }, [loadUrl, attempt]);

  return <div className="modal-overlay document-viewer-overlay" onMouseDown={onClose}>
    <section ref={dialogRef} className="modal-content document-viewer" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="document-viewer-icon"><FileCheck size={20} /></span><div><h2>{title}</h2>{subtitle && <small>{subtitle}</small>}</div></div><button className="icon-close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></div>
      <div className="document-viewer-frame">
        {state.status === 'loading' && <div className="document-viewer-state"><span className="document-viewer-spinner" /> Abriendo el documento…</div>}
        {/* El reintento vuelve a "cargando" desde el gesto del usuario, no desde el efecto: el
            efecto solo pide el documento. */}
        {state.status === 'error' && <div className="document-viewer-state"><p className="top-error">{state.error}</p><button className="btn btn-secondary" onClick={() => { setState({ status: 'loading', url: null, error: '' }); setAttempt((n) => n + 1); }}><RotateCcw size={15} /> Reintentar</button></div>}
        {state.status === 'ready' && state.url && <object data={state.url} type="application/pdf" aria-label={title}>
          <div className="document-viewer-state">Tu navegador no puede mostrar el PDF aquí. Descárgalo o ábrelo en una pestaña nueva.</div>
        </object>}
      </div>
      <div className="modal-footer top-modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        {state.status === 'ready' && state.url && <>
          {/* Va sobre el blob: abrir la pestaña es el gesto del usuario y no gasta otro enlace. */}
          <button className="btn btn-secondary" onClick={() => window.open(state.url as string, '_blank', 'noopener,noreferrer')}><ExternalLink size={15} /> Abrir en pestaña</button>
          <a className="btn top-confirm document-viewer-download" href={state.url} download={fileName}><Download size={15} /> Descargar</a>
        </>}
      </div>
    </section>
  </div>;
}

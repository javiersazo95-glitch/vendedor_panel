import { useEffect, useState } from 'react';
import { FileSignature } from 'lucide-react';
import { acceptAdhesionContract, getAdhesionContractPdf, isAdhesionContractPending } from '../db';
import { useFocusTrap } from '../utils/useFocusTrap';

/**
 * Contrato de Adhesión del vendedor: aparece al entrar si la tienda está aprobada y no lo firmó.
 *
 * Es el port de `SellerAdhesionModal` del market web (y del modal de la app). Hasta el 2026-09-23
 * el panel no lo mostraba y el backend no lo exigía, así que se podía publicar, vender y cobrar
 * sin haberlo aceptado nunca (O14). Ahora el backend rechaza publicar sin él; este modal es la
 * forma de firmarlo sin salir del panel.
 *
 * Sin botón de cerrar, igual que en el market y la app: la salida es cerrar sesión. El documento
 * es el PDF real que emite el backend, así que lo que se lee es exactamente lo que queda firmado.
 */
export function AdhesionContractModal({ onLogout }: { onLogout: () => void }) {
  const [pending, setPending] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useFocusTrap(pending);

  useEffect(() => {
    let cancelled = false;
    void isAdhesionContractPending().then((value) => { if (!cancelled) setPending(value); });
    return () => { cancelled = true; };
  }, []);

  // El PDF se pide con el token, así que se trae como blob y se muestra por objectURL.
  useEffect(() => {
    if (!pending) return undefined;
    let cancelled = false;
    let objectUrl = '';
    getAdhesionContractPdf()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No pudimos abrir el contrato. Recarga la página.');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pending]);

  if (!pending) return null;

  const sign = async () => {
    setSending(true);
    setError('');
    try {
      await acceptAdhesionContract();
      setPending(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos registrar tu aceptación. Intenta nuevamente.');
      setSending(false);
    }
  };

  return <div className="modal-overlay document-viewer-overlay">
    <section ref={dialogRef} className="modal-content document-viewer adhesion-modal" role="dialog" aria-modal="true" aria-labelledby="adhesion-modal-title">
      <div className="modal-header"><div><span className="document-viewer-icon"><FileSignature size={20} /></span><div><h2 id="adhesion-modal-title">Contrato de Adhesión</h2><small>Tu tienda quedó aprobada. Acepta el contrato para publicar y vender en RepuesTop.</small></div></div></div>
      <div className="document-viewer-frame">
        {pdfUrl
          ? <object data={pdfUrl} type="application/pdf" aria-label="Contrato de adhesión">
            <div className="document-viewer-state">Tu navegador no puede mostrar el PDF aquí. <a href={pdfUrl} target="_blank" rel="noopener noreferrer">Ábrelo en una pestaña nueva</a>.</div>
          </object>
          : !error && <div className="document-viewer-state"><span className="document-viewer-spinner" /> Cargando el contrato…</div>}
      </div>
      {error && <p className="top-error" role="alert">{error}</p>}
      <label className="adhesion-checkbox">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        <span>Acepto firmar electrónicamente el Contrato de Adhesión del Vendedor.</span>
      </label>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onLogout} disabled={sending}>Cerrar sesión</button>
        <button className="btn btn-primary" onClick={() => void sign()} disabled={!accepted || sending || !pdfUrl}>
          {sending ? 'Registrando…' : 'Aceptar y continuar'}
        </button>
      </div>
    </section>
  </div>;
}

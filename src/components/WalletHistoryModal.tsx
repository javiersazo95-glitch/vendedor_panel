import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ChevronRight, Coins, FileText, History, X } from 'lucide-react';
import { getRechargeDocumentUrl, getWalletHistory, type WalletMovement } from '../db';
import { useFocusTrap } from '../utils/useFocusTrap';
import { DocumentViewerModal } from './DocumentViewerModal';

/**
 * Historial de movimientos del monedero, con la boleta o factura de cada recarga.
 *
 * Lo sirve `GET /fichas/movimientos`, la misma fuente que da el saldo: se lee al abrir y no se
 * cachea, porque el resumen del encabezado tiene que cuadrar con las filas que se muestran.
 *
 * El detalle de una recarga es además donde el vendedor ve y descarga su documento tributario
 * (el #3: lo emite RepuesTop, que en la compra de monedas es vendedor directo). Va acá y no en
 * una pantalla aparte porque este es el lugar al que vuelve a buscarlo.
 *
 * QUÉ NO SE MUESTRA, Y POR QUÉ: no hay una fila "monto pagado" en pesos. `MovimientoFichaDTO` no
 * trae el monto, así que ponerla mostraría $0 siempre.
 */

const MOTIVO_LABELS: Record<string, string> = {
  COMPRA: 'Recarga de monedas',
  BONO_BIENVENIDA: 'Bono de bienvenida del Monedero RepuesTop',
  PRODUCTO_TOP: 'Producto Top por 30 días',
  PUBLICACION: 'Publicación de anuncio',
  UPGRADE: 'Mejora de plan del anuncio',
};

function etiqueta(movimiento: WalletMovement): string {
  return movimiento.descripcion || MOTIVO_LABELS[movimiento.motivo || ''] || 'Movimiento de monedas';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Fecha no informada';
  return date.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Fecha no informada';
  return date.toLocaleString('es-CL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface WalletHistoryModalProps {
  onClose: () => void;
  /** El historial trae el saldo autoritativo; el monedero lo aprovecha para no quedar desfasado. */
  onBalance?: (saldo: number) => void;
}

export function WalletHistoryModal({ onClose, onBalance }: WalletHistoryModalProps) {
  const [movimientos, setMovimientos] = useState<WalletMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<WalletMovement | null>(null);
  const dialogRef = useFocusTrap(true);

  useEffect(() => {
    let cancelled = false;
    getWalletHistory()
      .then((data) => {
        if (cancelled) return;
        setMovimientos(data.movimientos);
        setError('');
        onBalance?.(data.saldo);
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'No pudimos cargar tu historial.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // `onBalance` no entra en las dependencias a propósito: el historial se lee una vez al abrir.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totales = useMemo(() => {
    const creditos = movimientos.filter((item) => item.tipo === 'CREDITO');
    return {
      recargas: creditos.filter((item) => item.motivo === 'COMPRA').length,
      cargadas: creditos.reduce((acc, item) => acc + item.cantidad, 0),
      usadas: movimientos.filter((item) => item.tipo === 'DEBITO').reduce((acc, item) => acc + item.cantidad, 0),
    };
  }, [movimientos]);

  return <>
    <div className="modal-overlay" onMouseDown={onClose}>
      <section ref={dialogRef} className="modal-content wallet-modal" role="dialog" aria-modal="true" aria-label="Historial de monedas" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><span className="wallet-history-icon"><History size={20} /></span><div><h2>Historial de monedas</h2><small className="recharge-subtitle">Cada recarga y cada cobro, del más reciente al más antiguo</small></div></div><button className="icon-close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></div>
        <div className="modal-body wallet-modal-body">
          {!loading && !error && movimientos.length > 0 && <div className="wallet-history-summary">
            <div><b>{totales.recargas}</b><span>Recargas</span></div>
            <div><b>{totales.cargadas.toLocaleString('es-CL')}</b><span>Monedas cargadas</span></div>
            <div><b>{totales.usadas.toLocaleString('es-CL')}</b><span>Monedas usadas</span></div>
          </div>}
          {loading && <p className="wallet-note">Cargando tus movimientos…</p>}
          {!loading && error && <p className="top-error"><AlertTriangle size={16} /> {error}</p>}
          {!loading && !error && movimientos.length === 0 && <div className="wallet-history-empty"><Coins size={22} /><p>Todavía no hay movimientos en tu monedero.</p></div>}
          {!loading && !error && movimientos.length > 0 && <div className="wallet-history-list">
            {movimientos.map((movimiento) => {
              const credito = movimiento.tipo === 'CREDITO';
              return <button type="button" key={movimiento.id} className={`wallet-history-item ${credito ? 'is-credit' : 'is-debit'}`} onClick={() => setSelected(movimiento)} aria-label={`Ver el detalle de ${etiqueta(movimiento)}`}>
                <span className="wallet-history-item-icon">{credito ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span>
                <span className="wallet-history-body"><strong>{etiqueta(movimiento)}</strong><span>{formatDate(movimiento.fecha)}</span></span>
                <span className="wallet-history-amount">{credito ? '+' : '−'}{movimiento.cantidad.toLocaleString('es-CL')}</span>
                <ChevronRight size={17} />
              </button>;
            })}
          </div>}
        </div>
        <div className="modal-footer top-modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cerrar</button></div>
      </section>
    </div>
    {selected && <MovementDetail movimiento={selected} onClose={() => setSelected(null)} />}
  </>;
}

/**
 * Detalle de un movimiento, en su propia hoja: en la fila la descripción y la fecha se recortan
 * a una línea, y acá se muestran completas junto con el resto de los datos del registro.
 */
function MovementDetail({ movimiento, onClose }: { movimiento: WalletMovement; onClose: () => void }) {
  /** Guarda la compra y no el movimiento: el visor sobrevive a que se cierre el detalle. */
  const [documentoDe, setDocumentoDe] = useState<{ compraId: string; label: string } | null>(null);
  const dialogRef = useFocusTrap(true);

  const cargarUrl = useCallback(() => getRechargeDocumentUrl(documentoDe?.compraId ?? ''), [documentoDe]);

  const credito = movimiento.tipo === 'CREDITO';
  // Sin `compraId` no hay a qué pedirle el documento, por más que el backend lo marque.
  const puedeVerDocumento = movimiento.documentoDisponible && Boolean(movimiento.compraId);
  const label = movimiento.documentoTipo === 'FACTURA' ? 'factura' : 'boleta';

  return <>
    <div className="modal-overlay wallet-detail-overlay" onMouseDown={onClose}>
      <section ref={dialogRef} className="modal-content wallet-detail" role="dialog" aria-modal="true" aria-label="Detalle del movimiento" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><span className={`wallet-history-item-icon ${credito ? 'is-credit' : 'is-debit'}`}>{credito ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span><div><h2>{credito ? 'Ingreso de monedas' : 'Uso de monedas'}</h2><small className="recharge-subtitle">{formatDateTime(movimiento.fecha)}</small></div></div><button className="icon-close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></div>
        <div className="modal-body wallet-modal-body">
          <div className={`wallet-detail-amount ${credito ? 'is-credit' : 'is-debit'}`}>
            <strong>{credito ? '+' : '−'}{movimiento.cantidad.toLocaleString('es-CL')}</strong>
            <span>{movimiento.cantidad === 1 ? 'Moneda RepuesTop' : 'Monedas RepuesTop'}</span>
          </div>
          <dl className="wallet-detail-rows">
            <div><dt>Descripción</dt><dd>{etiqueta(movimiento)}</dd></div>
            <div><dt>Fecha y hora</dt><dd>{formatDateTime(movimiento.fecha)}</dd></div>
            <div><dt>Movimiento</dt><dd>{credito ? 'Ingreso al monedero' : 'Descuento del monedero'}</dd></div>
            {movimiento.anuncioId && <div><dt>Aviso asociado</dt><dd>#{movimiento.anuncioId}</dd></div>}
            <div><dt>N.º de registro</dt><dd>{movimiento.id}</dd></div>
            {movimiento.documentoDisponible && <>
              <div><dt>Documento tributario</dt><dd>{movimiento.documentoTipo === 'FACTURA' ? 'Factura' : 'Boleta'}{movimiento.documentoFolio ? ` N.º ${movimiento.documentoFolio}` : ''}</dd></div>
              {movimiento.documentoFecha && <div><dt>Emitido el</dt><dd>{formatDate(movimiento.documentoFecha)}</dd></div>}
            </>}
          </dl>
          {/* Una recarga sin documento todavía no es un error: RepuesTop lo emite a mano en el
              Portal MIPYME, así que puede tardar. Decirlo evita que el vendedor crea que se
              perdió. */}
          {credito && movimiento.motivo === 'COMPRA' && !puedeVerDocumento && <p className="wallet-note">Tu boleta o factura todavía no está emitida. Cuando lo esté, la verás acá y te llegará por correo.</p>}
        </div>
        <div className="modal-footer top-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          {puedeVerDocumento && <button className="btn top-confirm" onClick={() => setDocumentoDe({ compraId: movimiento.compraId as string, label })}><FileText size={15} /> Ver mi {label}</button>}
        </div>
      </section>
    </div>
    {documentoDe && <DocumentViewerModal
      loadUrl={cargarUrl}
      title={documentoDe.label === 'factura' ? 'Factura de tu recarga' : 'Boleta de tu recarga'}
      subtitle="Compra de Monedas RepuesTop"
      fileName={`${documentoDe.label}-recarga-${documentoDe.compraId}.pdf`}
      onClose={() => setDocumentoDe(null)}
    />}
  </>;
}

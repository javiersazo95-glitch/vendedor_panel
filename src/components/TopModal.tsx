import { AlertCircle, Coins, X } from 'lucide-react';
import type { Product, ProductTopSummary } from '../db';
import { getProductTopStatus } from '../utils/productTop';
import topVentasBadge from '../assets/top-ventas-badge-transparent.png';

interface TopModalProps {
  visible?: boolean;
  product: Product | null;
  summary: ProductTopSummary | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (renew: boolean) => void;
  onRecharge: () => void;
}

export function TopModal({ product, visible = true, summary, loading, saving, error, onClose, onConfirm, onRecharge }: TopModalProps) {
  if (!product || !visible) return null;
  const status = getProductTopStatus(product);
  const wasTop = status.state !== 'none' || Boolean(product.topHasta);
  // El resumen conserva el historial de cupos gratis del backend; el conteo de
  // activos añade una protección para datos históricos donde ese contador quedó
  // desfasado. Con 2 o más Top activos, cualquier nuevo producto se cobra.
  const freeLimit = summary?.cuposGratuitos ?? 2;
  const free = !wasTop && (summary?.gratuitosDisponibles ?? 0) > 0 && (summary?.activos ?? 0) < freeLimit;
  const effectiveFreeSlots = Math.max(0, Math.min(summary?.gratuitosDisponibles ?? 0, freeLimit - (summary?.activos ?? 0)));
  const cost = summary?.costoMonedas ?? 200;
  const balance = summary?.saldoMonedas ?? 0;
  const missing = free ? 0 : Math.max(0, cost - balance);
  const reachedMaximum = status.state !== 'active' && summary ? summary.activos >= summary.maximo : false;
  const title = status.state === 'active' ? 'Renovar producto Top' : status.state === 'expired' ? 'Tu producto Top venció' : 'Marcar como producto Top';
  const action = status.state === 'active' ? 'Sumar 30 días' : status.state === 'expired' ? 'Renovar por 30 días' : 'Activar por 30 días';

  return <div className="modal-overlay" onMouseDown={onClose}>
    <section className="modal-content top-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><img className="top-modal-badge" src={topVentasBadge} alt="Insignia Top Ventas" /><h2>{title}</h2></div><button className="icon-close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></div>
      <div className="modal-body top-modal-body">
        <div className="top-product-hero"><div><span>REPUSTO SELECCIONADO</span><strong>{product.name}</strong><p>Prioridad en resultados y visibilidad con la insignia Top Ventas.</p></div><img src={topVentasBadge} alt="Insignia Top Ventas" /></div>
        {status.state !== 'none' && <div className={`top-status ${status.state === 'expired' ? 'expired' : ''}`}>
          <img className="top-status-badge" src={topVentasBadge} alt="" /> {status.state === 'active' ? (status.expiresAt ? `Vigente: quedan ${status.daysLeft} ${status.daysLeft === 1 ? 'día' : 'días'}.` : 'Insignia Top activa.') : 'La insignia ya venció; puedes renovarla.'}
        </div>}
        <div className="top-summary-grid">
          <div><span>Productos Top activos</span><strong>{loading ? '…' : `${summary?.activos ?? 0} de ${summary?.maximo ?? 10}`}</strong><small>Espacios disponibles: {Math.max(0, (summary?.maximo ?? 10) - (summary?.activos ?? 0))}</small></div>
          <div className="top-cost-card"><span>Costo de esta acción</span><strong>{free ? 'Gratis' : `${cost.toLocaleString('es-CL')} monedas`}</strong><small>{free ? 'Beneficio de primera activación' : '$10.000 CLP por 30 días'}</small></div>
          <div><span>Saldo disponible</span><strong>{balance.toLocaleString('es-CL')} monedas</strong><small>{missing > 0 ? `Te faltan ${missing.toLocaleString('es-CL')}` : 'Saldo suficiente para continuar'}</small></div>
          <div className={effectiveFreeSlots === 0 ? 'top-free-exhausted' : ''}><span>{status.state === 'none' ? 'Activaciones gratis disponibles' : 'Beneficio de primera activación'}</span><strong>{status.state === 'none' ? `${effectiveFreeSlots} de ${freeLimit}` : 'No aplica'}</strong><small>{status.state === 'none' ? (effectiveFreeSlots === 0 ? 'Los 2 cupos gratuitos ya fueron utilizados.' : 'Solo aplica a un producto nuevo.') : 'Las renovaciones siempre usan monedas.'}</small></div>
        </div>
        <div className="top-rules"><strong>Cómo funciona Producto Top</strong><ul><li>Las primeras 2 activaciones de la cuenta son gratuitas.</li><li>Desde el tercer producto y en cada renovación: 200 monedas por 30 días.</li><li>Si renuevas antes de vencer, los 30 días se suman a los restantes.</li></ul></div>
        {error && <p className="top-error"><AlertCircle size={17} /> {error}</p>}
        {missing > 0 && !loading && <button className="top-insufficient" onClick={onRecharge}><Coins size={18} /> Te faltan {missing.toLocaleString('es-CL')} monedas. Recargar ahora.</button>}
      </div>
      <div className="modal-footer top-modal-footer"><button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button><button className="btn top-confirm" onClick={() => onConfirm(status.state === 'active')} disabled={loading || saving || missing > 0 || reachedMaximum}>{saving ? 'Procesando…' : reachedMaximum ? `Máximo de ${summary?.maximo ?? 10} Top alcanzado` : `${action} · ${free ? 'gratis' : `${cost} monedas`}`}</button></div>
    </section>
  </div>;
}

import { useState } from 'react';
import { AlertCircle, ChevronRight, History, Info, X } from 'lucide-react';
import type { ProductTopSummary } from '../db';
import { useFocusTrap } from '../utils/useFocusTrap';
import { RepuestopCoin } from './RepuestopCoin';
import { RechargeModal } from './RechargeModal';
import { WalletHistoryModal } from './WalletHistoryModal';
import { CoinDropAnimation, prefiereMenosMovimiento } from './CoinDropAnimation';

/**
 * Monedero de Monedas RepuesTop del panel, homologado con el de la app y el market web.
 *
 * Hace tres cosas y ninguna más: **recargar**, **ver en qué se fueron las monedas** y **ver las
 * boletas**. Los productos Top se gestionan en el Inventario General, que es donde está el
 * repuesto; llegó a haber acá una lista para renovarlos desde el monedero y se sacó a propósito,
 * porque partía en dos la misma gestión y dejaba al vendedor sin saber cuál de los dos lugares
 * era el bueno.
 */
interface WalletModalProps {
  balance: number;
  loading: boolean;
  summary: ProductTopSummary | null;
  /** Vino de vuelta de Flow con la recarga acreditada: se celebra una vez y no más. */
  celebrar?: boolean;
  /**
   * Volvió de Flow y el pago todavía no está confirmado. Se dice, no se adivina: el vendedor
   * acaba de pagar y ver el saldo viejo sin explicación es exactamente el momento en que cree
   * que perdió la plata y vuelve a pagar.
   */
  pendiente?: boolean;
  onCelebracionLista?: () => void;
  onBalance: (saldo: number) => void;
  onClose: () => void;
}

export function WalletModal({ balance, loading, summary, celebrar = false, pendiente = false, onCelebracionLista, onBalance, onClose }: WalletModalProps) {
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // La lluvia solo corre si se llegó acá volviendo de un pago, y nunca para quien pidió menos
  // movimiento: a ese se le muestra el saldo ya actualizado y nada más.
  const [lloviendo, setLloviendo] = useState(celebrar && !prefiereMenosMovimiento());
  const dialogRef = useFocusTrap(true);

  const costo = summary?.costoMonedas ?? 200;

  return <>
    <div className="modal-overlay" onMouseDown={onClose}>
      <section ref={dialogRef} className="modal-content wallet-modal" role="dialog" aria-modal="true" aria-label="Monedero RepuesTop" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><RepuestopCoin size={42} /><div><h2>Monedas RepuesTop</h2><small className="recharge-subtitle">Recarga monedas y revisa tus recargas y canjes</small></div></div><button className="icon-close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></div>
        <div className="modal-body wallet-modal-body">
          {pendiente && <p className="wallet-pending"><AlertCircle size={18} /> <span><strong>Estamos confirmando tu recarga.</strong> Flow todavía no nos avisó el resultado. En unos minutos tus monedas aparecen acá solas: <b>no vuelvas a pagar</b>. Si en una hora no aparecen, escríbenos.</span></p>}
          <div className="wallet-card">
            <RepuestopCoin size={72} />
            <div className="wallet-card-copy">
              <span>Monedero de Monedas RepuesTop</span>
              <strong>{loading ? 'Consultando…' : balance.toLocaleString('es-CL')}</strong>
              <small>monedas disponibles · 1 moneda = $50 CLP</small>
            </div>
            <div className="wallet-card-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setHistoryOpen(true)}><History size={15} /> Historial</button>
              <button type="button" className="btn top-confirm" onClick={() => setRechargeOpen(true)}><RepuestopCoin size={22} /> Recargar monedas <ChevronRight size={16} /></button>
            </div>
          </div>

          <div className="wallet-explainer">
            <span className="wallet-explainer-icon"><Info size={18} /></span>
            <div>
              <strong>¿Para qué sirven tus monedas?</strong>
              <p>Posicionan tus repuestos como Productos Top: prioridad en las búsquedas durante 30 días, con la insignia Top Ventas. <b>Nunca se descuentan sin tu confirmación.</b></p>
            </div>
          </div>

          <h3>Cómo destacar un repuesto</h3>
          <ol className="wallet-steps">
            <li>En Inventario General, busca el repuesto que quieres destacar.</li>
            <li>Presiona la estrella dorada en la columna Acciones.</li>
            <li>Revisa el costo, tus cupos y tus monedas disponibles.</li>
            <li>Confirma la activación. Si faltan monedas, recarga acá y vuelve a intentarlo.</li>
          </ol>
          <p className="wallet-note">Las primeras {summary?.cuposGratuitos ?? 2} activaciones son gratis. Luego cada período Top cuesta {costo.toLocaleString('es-CL')} monedas (${(costo * 50).toLocaleString('es-CL')} CLP).</p>
        </div>
        <div className="modal-footer top-modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cerrar</button></div>
      </section>

      {/* La lluvia toma la pantalla entera por encima del monedero: es un momento propio, no un
          adorno del saldo. Al terminar cede el paso al monedero con el saldo ya acreditado. */}
      {lloviendo && <div className="coin-rain-layer">
        <CoinDropAnimation active onFinish={() => { setLloviendo(false); onCelebracionLista?.(); }} />
        <h3>¡Listo!</h3>
        <p>Tus Monedas RepuesTop ya están acreditadas.</p>
      </div>}
    </div>

    {rechargeOpen && <RechargeModal onClose={() => setRechargeOpen(false)} />}
    {historyOpen && <WalletHistoryModal onClose={() => setHistoryOpen(false)} onBalance={onBalance} />}
  </>;
}

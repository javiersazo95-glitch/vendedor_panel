import { useState } from 'react';
import { CheckCircle2, CreditCard, X } from 'lucide-react';
import { RepuestopCoin } from './RepuestopCoin';
import topVentasBadge from '../assets/top-ventas-badge-transparent.png';

const PACKS = [
  { name: 'Pack Básico', coins: 100, amount: 5000 },
  { name: 'Pack Medio', coins: 200, amount: 10000 },
  { name: 'Pack Avanzado', coins: 400, amount: 20000 },
  { name: 'Pack Extra Pro', coins: 800, amount: 40000 },
];

const clp = (value: number) => `$${value.toLocaleString('es-CL')} CLP`;

interface WalletModalProps {
  balance: number;
  loading: boolean;
  onClose: () => void;
  onRecharge: (pack: typeof PACKS[number], method: string) => Promise<void>;
}

export function WalletModal({ balance, loading, onClose, onRecharge }: WalletModalProps) {
  const [recharge, setRecharge] = useState(false);
  const [selected, setSelected] = useState(PACKS[1]);
  const [method, setMethod] = useState('Webpay Plus / Débito');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => { setSaving(true); setError(null); try { await onRecharge(selected, method); onClose(); } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar la recarga.'); } finally { setSaving(false); } };
  return <div className="modal-overlay" onMouseDown={onClose}>
    <section className="modal-content wallet-modal" role="dialog" aria-modal="true" aria-label="Monedero RepuesTop" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><RepuestopCoin size={42} /><h2>{recharge ? 'Recargar Monedas RepuesTop' : 'Monedero RepuesTop'}</h2></div><button className="icon-close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></div>
      <div className="modal-body wallet-modal-body">
        {!recharge ? <>
          <div className="wallet-balance"><RepuestopCoin size={48} /><div><span>Tu saldo disponible</span><strong>{loading ? 'Consultando…' : `${balance.toLocaleString('es-CL')} monedas`}</strong></div></div>
          <div className="wallet-explainer"><img className="wallet-top-badge" src={topVentasBadge} alt="Insignia Top Ventas" /><div><strong>¿Para qué sirven?</strong><p>Usa monedas para posicionar tus repuestos como Productos Top: reciben prioridad en búsquedas durante 30 días.</p></div></div>
          <h3>Cómo impulsar un repuesto</h3><ol className="wallet-steps"><li>En Inventario General, busca el repuesto que quieres destacar.</li><li>Presiona la estrella dorada en la columna Acciones.</li><li>Revisa el costo, tus cupos y monedas disponibles.</li><li>Confirma la activación. Si faltan monedas, recarga aquí y vuelve a intentarlo.</li></ol>
          <p className="wallet-note">Las primeras 2 activaciones son gratis. Luego cada período Top cuesta 200 monedas ($10.000 CLP).</p>
        </> : <>
          <p className="top-intro">1 moneda = $50 CLP. Elige un pack para usar en tus productos Top.</p>
          <div className="wallet-packs">{PACKS.map((pack) => <button type="button" key={pack.name} className={`wallet-pack ${selected.name === pack.name ? 'selected' : ''}`} onClick={() => setSelected(pack)}><strong>{pack.name}</strong><span>{pack.coins} monedas</span><em>{clp(pack.amount)}</em>{selected.name === pack.name && <CheckCircle2 size={17} />}</button>)}</div>
          <label className="wallet-method">2. Método de pago<select value={method} onChange={(event) => setMethod(event.target.value)}><option>Webpay Plus / Débito</option><option>Tarjeta de Crédito</option><option>Transferencia Bancaria</option></select></label>
          <div className="wallet-payment-summary"><CreditCard size={18} /><span>{selected.name}: {selected.coins} monedas</span><strong>{clp(selected.amount)}</strong></div>
          {error && <p className="top-error">{error}</p>}
        </>}
      </div>
      <div className="modal-footer top-modal-footer">{recharge ? <><button className="btn btn-secondary" onClick={() => setRecharge(false)} disabled={saving}>Volver</button><button className="btn top-confirm" onClick={submit} disabled={saving}>{saving ? 'Procesando…' : `Registrar pago de ${clp(selected.amount)}`}</button></> : <><button className="btn btn-secondary" onClick={onClose}>Cerrar</button><button className="btn top-confirm" onClick={() => setRecharge(true)}>Recargar monedas</button></>}</div>
    </section>
  </div>;
}

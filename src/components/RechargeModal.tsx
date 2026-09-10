import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ShieldCheck, X } from 'lucide-react';
import { getCoinPacks, getRechargeDocumentData, startRecharge, type CoinPack, type DocumentoRecarga, type TipoDocumentoTributario } from '../db';
import { formatRut, isValidRut } from '../utils/rut';
import { useFocusTrap } from '../utils/useFocusTrap';
import { RepuestopCoin } from './RepuestopCoin';

const clp = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')} CLP`;

/**
 * Recarga de Monedas RepuesTop, homologada con la app y el market web.
 *
 * Lo que había antes en el panel registraba la compra con `POST /fichas/compras` y acreditaba las
 * monedas en el acto: el vendedor apretaba "Registrar pago" y quedaba con saldo sin que hubiera
 * entrado un peso, con un selector de método de pago que no cobraba nada. Ahora se crea una
 * intención de pago, el vendedor va a Flow, y las monedas entran cuando el webhook confirma.
 *
 * El método de pago ya no se pregunta acá: se elige DENTRO de Flow. Ofrecerlo antes era pura
 * decoración.
 */
interface RechargeModalProps {
  onClose: () => void;
}

export function RechargeModal({ onClose }: RechargeModalProps) {
  const [packs, setPacks] = useState<CoinPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [packsError, setPacksError] = useState('');
  const [selected, setSelected] = useState<CoinPack | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  /**
   * Qué documento tributario pide el vendedor. Arranca en FACTURA cuando su tienda tiene RUT
   * registrado: quien recarga monedas casi siempre necesita el crédito fiscal del IVA, y dejarlo
   * en boleta por descuido le cuesta plata.
   */
  const [documento, setDocumento] = useState<DocumentoRecarga>({ tipo: 'BOLETA', rut: '', razonSocial: '', giro: '' });
  const [rutTocado, setRutTocado] = useState(false);
  const dialogRef = useFocusTrap(true);

  useEffect(() => {
    let cancelled = false;
    getCoinPacks()
      .then((lista) => {
        if (cancelled) return;
        setPacks(lista);
        // Se preselecciona el pack destacado; si ninguno lo está, el primero.
        setSelected(lista.find((pack) => pack.destacado) || lista[0] || null);
        setPacksError('');
      })
      .catch((err: unknown) => { if (!cancelled) setPacksError(err instanceof Error ? err.message : 'No pudimos cargar los packs.'); })
      .finally(() => { if (!cancelled) setPacksLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getRechargeDocumentData()
      .then((datos) => { if (!cancelled) setDocumento({ tipo: datos.tipoSugerido, rut: datos.rut ? formatRut(datos.rut) : '', razonSocial: datos.razonSocial, giro: datos.giro }); })
      // Que no se pueda prellenar no debe impedir recargar: queda en boleta y el vendedor elige.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const pideFactura = documento.tipo === 'FACTURA';
  const rutValido = !pideFactura || isValidRut(documento.rut);
  const faltaRazonSocial = pideFactura && !documento.razonSocial.trim();

  const pagar = async () => {
    if (!selected) return;
    if (pideFactura && !isValidRut(documento.rut)) {
      setRutTocado(true);
      setError('Revisa el RUT: no es válido.');
      return;
    }
    setProcessing(true);
    setError('');
    try {
      const { url } = await startRecharge(selected.id, documento);
      // Redirección dura, no window.open: es la misma pestaña la que va a Flow y vuelve al panel.
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos iniciar el pago. Intenta nuevamente.');
      setProcessing(false);
    }
  };

  return <div className="modal-overlay" onMouseDown={onClose}>
    <section ref={dialogRef} className="modal-content wallet-modal" role="dialog" aria-modal="true" aria-label="Recargar Monedas RepuesTop" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><RepuestopCoin size={42} /><div><h2>Recargar Monedas RepuesTop</h2><small className="recharge-subtitle">1 moneda = $50 CLP</small></div></div><button className="icon-close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></div>
      <div className="modal-body wallet-modal-body">
        <div className="recharge-step"><span>1</span><div><strong>Elige un pack</strong><small>El valor siempre es $50 CLP por moneda</small></div></div>
        {packsLoading && <p className="wallet-note">Cargando packs…</p>}
        {packsError && <p className="top-error"><AlertCircle size={16} /> {packsError}</p>}
        <div className="wallet-packs" role="radiogroup" aria-label="Packs de monedas">
          {packs.map((pack) => {
            const elegido = selected?.id === pack.id;
            return <button type="button" key={pack.id} role="radio" aria-checked={elegido} className={`wallet-pack ${elegido ? 'selected' : ''}`} onClick={() => setSelected(pack)}>
              {pack.etiqueta && <span className={`wallet-pack-tag ${pack.destacado ? 'is-featured' : ''}`}>{pack.etiqueta}</span>}
              <strong>{pack.nombre}</strong>
              <span>{pack.totalMonedas.toLocaleString('es-CL')} monedas</span>
              {pack.bonus > 0 && <span className="wallet-pack-bonus">+{pack.bonus.toLocaleString('es-CL')} de regalo</span>}
              <em>{clp(pack.precioClp)}</em>
              {elegido && <CheckCircle2 size={17} />}
            </button>;
          })}
        </div>

        {/* El documento se pregunta ANTES de cobrar: una factura mal pedida obliga a anular y
            re-emitir, y si el RUT no sirve hay que devolver la plata. */}
        <div className="recharge-step"><span>2</span><div><strong>Documento tributario</strong><small>Con factura puedes usar el IVA como crédito fiscal</small></div></div>
        <div className="recharge-doc-choice" role="radiogroup" aria-label="Tipo de documento">
          {(['BOLETA', 'FACTURA'] as TipoDocumentoTributario[]).map((tipo) => <button type="button" key={tipo} role="radio" aria-checked={documento.tipo === tipo} className={`recharge-doc-option ${documento.tipo === tipo ? 'selected' : ''}`} onClick={() => setDocumento((prev) => ({ ...prev, tipo }))}>
            <strong>{tipo === 'BOLETA' ? 'Boleta' : 'Factura'}</strong>
            <small>{tipo === 'BOLETA' ? 'Para consumidor final' : 'Necesita tu RUT de empresa'}</small>
          </button>)}
        </div>

        {pideFactura && <div className="recharge-doc-fields">
          <label>RUT *
            <input type="text" value={documento.rut} maxLength={12} placeholder="12.345.678-9" aria-invalid={rutTocado && !rutValido}
              className={rutTocado && !rutValido ? 'is-invalid' : ''}
              onChange={(event) => setDocumento((prev) => ({ ...prev, rut: formatRut(event.target.value) }))}
              onBlur={() => setRutTocado(true)} />
            {rutTocado && !rutValido && <small className="recharge-doc-error">{documento.rut.trim() ? 'Ese RUT no es válido: revisa el dígito verificador.' : 'El RUT es obligatorio para emitir una factura.'}</small>}
          </label>
          <label>Razón social *
            <input type="text" value={documento.razonSocial} maxLength={180} placeholder="Repuestos SpA" onChange={(event) => setDocumento((prev) => ({ ...prev, razonSocial: event.target.value }))} />
          </label>
          <label>Giro
            <input type="text" value={documento.giro} maxLength={150} placeholder="Venta de repuestos automotrices" onChange={(event) => setDocumento((prev) => ({ ...prev, giro: event.target.value }))} />
          </label>
        </div>}

        <div className="recharge-step"><span>3</span><div><strong>Pago seguro con Flow</strong><small>Te llevamos a Flow para pagar con Webpay, tarjeta o transferencia</small></div></div>
        <div className="wallet-payment-summary">
          <div><span>Pack seleccionado</span><strong>{selected ? `${selected.nombre} · ${selected.totalMonedas.toLocaleString('es-CL')} monedas` : '—'}</strong></div>
          <div className="wallet-payment-total"><span>Total a pagar</span><strong>{selected ? clp(selected.precioClp) : '—'}</strong></div>
        </div>
        <p className="wallet-secure-note"><ShieldCheck size={15} /> Tus monedas se acreditan cuando Flow confirma el pago. Al volver verás tu saldo actualizado acá mismo.</p>
        {error && <p className="top-error"><AlertCircle size={16} /> {error}</p>}
      </div>
      <div className="modal-footer top-modal-footer">
        <button className="btn btn-secondary" onClick={onClose} disabled={processing}>Cancelar</button>
        {/* Con una factura incompleta el backend cortaría igual, pero recién al apretar: es mejor
            que el botón diga que falta algo antes de intentarlo. */}
        <button className="btn top-confirm" onClick={() => void pagar()} disabled={processing || !selected || !rutValido || faltaRazonSocial}>
          {processing ? 'Llevándote a Flow…' : `Pagar ${selected ? clp(selected.precioClp) : ''}`}
        </button>
      </div>
    </section>
  </div>;
}

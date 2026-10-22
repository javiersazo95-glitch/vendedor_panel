import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import {
  calculateSellerEarnings, calculateSuggestedPrice, flowRateLabel, pricingFeeBreakdown, serviceFeeAmount, standardRateLabel,
} from '../../utils/pricing';
import { useRemoteConfig } from '../../remoteConfig/hooks';

const formatCLP = (n: number) => Math.round(n).toLocaleString('es-CL');

/**
 * La misma calculadora de la carga uno a uno (ManualUpload): cuánto recibe el vendedor por ese
 * precio, el detalle de comisión y Flow, y el precio sugerido para recibir ese monto líquido.
 * Usa las mismas funciones de `utils/pricing`, así que la carga con Excel y la manual nunca dan
 * números distintos.
 */
export function CalculadoraPrecio({ precio, fundador, onAplicarSugerido }: {
  precio: number;
  fundador: boolean;
  /** Si viene, el precio sugerido se puede aplicar con un botón. */
  onAplicarSugerido?: (precio: number) => void;
}) {
  const [conDetalle, setConDetalle] = useState(false);
  // Las tasas vienen del Mantenedor común: al llegar el bootstrap la calculadora se recalcula.
  useRemoteConfig();
  if (!(precio > 0)) return null;
  const desglose = pricingFeeBreakdown(precio, fundador);
  const costos = serviceFeeAmount(precio, fundador);
  const liquido = calculateSellerEarnings(precio, fundador);
  const sugerido = calculateSuggestedPrice(precio, fundador);

  return (
    <div className="manual-pricing-helper mx-calculadora" aria-label="Cuánto recibes por este precio">
      {fundador && <div className="manual-pricing-row"><strong>Marcha blanca Fundador: 0% de tarifa de servicio RepuesTop; solo pagas Flow. Después: {standardRateLabel()} + IVA.</strong></div>}
      <button
        type="button"
        onClick={() => setConDetalle((v) => !v)}
        className="manual-pricing-row mx-calculadora-detalle"
        aria-expanded={conDetalle}
      >
        <span>Costos totales de la venta:</span>
        <span className="mx-calculadora-total">
          <strong className="manual-pricing-fee">-${formatCLP(costos)}</strong>
          {conDetalle ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      <div className="manual-pricing-row">
        <strong>Recibirás en tu cuenta (Líquido):</strong>
        <strong className="manual-pricing-earnings">${formatCLP(liquido)}</strong>
      </div>
      <div className="manual-pricing-row mx-calculadora-nota">
        <span>Abono estimado:</span>
        <span>11 días tras entrega (sin reclamos)</span>
      </div>
      {conDetalle && (
        <div className="mx-calculadora-desglose">
          {/* Con 0 % (marcha blanca Fundador) la fila dice por que es $0 y no se desglosa un IVA de $0. */}
          {desglose.rate === 0 ? (
            <div className="manual-pricing-row">
              <span>Tarifa de servicio RepuesTop (0% · marcha blanca):</span>
              <strong className="manual-pricing-fee">$0</strong>
            </div>
          ) : (
            <>
              <div className="manual-pricing-row">
                <span>Tarifa de servicio RepuesTop ({Math.round(desglose.rate * 100)}% + IVA):</span>
                <strong className="manual-pricing-fee">-${formatCLP(desglose.repuestopWithIva)}</strong>
              </div>
              <div className="manual-pricing-row mx-calculadora-sub">
                <span>↳ Neto tarifa: ${formatCLP(desglose.repuestopNet)} | IVA (19%): ${formatCLP(desglose.repuestopIva)}</span>
              </div>
            </>
          )}
          <div className="manual-pricing-row">
            <span>Procesamiento Flow ({flowRateLabel()} + IVA):</span>
            <strong className="manual-pricing-fee">-${formatCLP(desglose.flowWithIva)}</strong>
          </div>
        </div>
      )}
      {sugerido > precio && (
        <div className="manual-suggested-price">
          <div>
            <span>Para recibir exactamente ${formatCLP(precio)} líquido, te sugerimos publicar a:</span>
            <strong>${formatCLP(sugerido)}</strong>
          </div>
          {onAplicarSugerido && (
            <button type="button" onClick={() => onAplicarSugerido(sugerido)}>Aplicar</button>
          )}
        </div>
      )}
    </div>
  );
}

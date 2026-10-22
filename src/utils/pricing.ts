/**
 * Simulador de precio del vendedor: cuánto recibe por un precio y qué precio poner para recibir
 * un monto. Son los mismos números del backend (`PedidoResponseMapper`), así que todo lo que
 * cambie allá tiene que cambiar acá.
 *
 * Desde el Mantenedor común (2026-10-20) las tasas se leen de los parámetros públicos del
 * bootstrap (`comision.*`, `pasarela.*`) con `remoteConfig.get()`; sin bootstrap valen las
 * constantes `*_FALLBACK`, que son las de siempre. Las funciones leen las tasas en cada llamada,
 * así que un componente que las use se actualiza al re-renderizar (los que no usan otro hook
 * remoto llaman `useRemoteConfig()` para eso).
 */
import { remoteConfig } from '../remoteConfig/remoteConfig';

export const FLOW_RATE_BASE_FALLBACK = 0.0289;
const FLOW_IVA_FALLBACK = 0.19;
// Vendedor Fundador (2026-10-18): tarifa de servicio RepuesTop 0 % durante la marcha blanca de
// 2 meses desde la aprobacion (primeras 100 tiendas). Solo paga la pasarela Flow.
const FOUNDER_APP_RATE_FALLBACK = 0;
// La duración de la marcha blanca no es un parámetro del contrato del Mantenedor: sigue fija.
export const FOUNDER_FREE_MONTHS = 2;
// Comision estandar parejo para tiendas verificadas (7 % + IVA; 2026-10-18, antes 8 %). Es la
// que rige al terminar la marcha blanca. El backend la define por tramos de subtotal
// (`comision.tasa.alta|media|baja` con `comision.limite.media|baja`); hoy los tres tramos valen
// lo mismo, y acá se replican para que el simulador siga al backend si algún día difieren.
const STANDARD_APP_RATE_FALLBACK = 0.07;
const LIMITE_MEDIA_FALLBACK = 100_000;
const LIMITE_BAJA_FALLBACK = 250_000;
const COMMISSION_IVA_FALLBACK = 0.19;
// Si es false, el porcentaje es neto y el IVA (19%) se cobra adicional al vendedor (% + IVA)
const COMMISSION_IVA_INCLUDED_FALLBACK = false;

/** Tasas vigentes, leídas una vez por cálculo para que un desglose sea coherente consigo mismo. */
export interface TarifasVigentes {
  tasaAlta: number;
  tasaMedia: number;
  tasaBaja: number;
  limiteMedia: number;
  limiteBaja: number;
  tasaFundador: number;
  comisionIva: number;
  comisionIvaIncluida: boolean;
  pasarelaPorcentaje: number;
  pasarelaIva: number;
}

export function tarifasVigentes(): TarifasVigentes {
  const p = remoteConfig.parametro;
  return {
    tasaAlta: p('comision.tasa.alta', STANDARD_APP_RATE_FALLBACK),
    tasaMedia: p('comision.tasa.media', STANDARD_APP_RATE_FALLBACK),
    tasaBaja: p('comision.tasa.baja', STANDARD_APP_RATE_FALLBACK),
    limiteMedia: p('comision.limite.media', LIMITE_MEDIA_FALLBACK),
    limiteBaja: p('comision.limite.baja', LIMITE_BAJA_FALLBACK),
    tasaFundador: p('comision.fundador.porcentaje', FOUNDER_APP_RATE_FALLBACK),
    comisionIva: p('comision.iva', COMMISSION_IVA_FALLBACK),
    comisionIvaIncluida: p('comision.iva.incluido', COMMISSION_IVA_INCLUDED_FALLBACK),
    pasarelaPorcentaje: p('pasarela.porcentaje', FLOW_RATE_BASE_FALLBACK),
    pasarelaIva: p('pasarela.iva', FLOW_IVA_FALLBACK),
  };
}

/** Misma regla que `PedidoResponseMapper.tasaEstandar(subtotal)`. */
function tasaEstandar(precio: number, t: TarifasVigentes): number {
  if (precio > t.limiteMedia && precio <= t.limiteBaja) return t.tasaMedia;
  if (precio > t.limiteBaja) return t.tasaBaja;
  return t.tasaAlta;
}

/** Porcentaje en formato chileno: 0.07 → "7%", 0.0289 → "2,89%". */
function etiquetaPorcentaje(tasa: number): string {
  const porcentaje = Math.round(tasa * 10_000) / 100;
  return `${porcentaje.toLocaleString('es-CL', { maximumFractionDigits: 2 })}%`;
}

/** Tasa de Flow vigente (sin IVA), para mostrarla. */
export function flowRateBase(): number {
  return tarifasVigentes().pasarelaPorcentaje;
}

/** "2,89%": la tasa de Flow para el desglose. */
export function flowRateLabel(): string {
  return etiquetaPorcentaje(flowRateBase());
}

/** "7%": la tarifa estándar que rige al terminar la marcha blanca (tramo alto, el de la mayoría). */
export function standardRateLabel(): string {
  return etiquetaPorcentaje(tarifasVigentes().tasaAlta);
}

export function pricingFeeBreakdown(basePrice: number, founder: boolean = false) {
  const t = tarifasVigentes();
  const flowRateWithIva = t.pasarelaPorcentaje * (1 + t.pasarelaIva);
  if (basePrice <= 0 || !Number.isFinite(basePrice)) {
    return { rate: founder ? t.tasaFundador : t.tasaAlta, repuestopNet: 0, repuestopIva: 0, repuestopWithIva: 0, flowWithIva: 0 };
  }
  const safeBase = Math.min(999_999_999, basePrice);
  const appRate = founder ? t.tasaFundador : tasaEstandar(safeBase, t);

  if (t.comisionIvaIncluida) {
    const repuestopWithIva = Math.round(safeBase * appRate);
    const repuestopNet = Math.round(repuestopWithIva / (1 + t.comisionIva));
    const repuestopIva = repuestopWithIva - repuestopNet;
    return {
      rate: appRate,
      repuestopNet,
      repuestopIva,
      repuestopWithIva,
      flowWithIva: Math.round(safeBase * flowRateWithIva),
    };
  } else {
    const repuestopNet = Math.round(safeBase * appRate);
    const repuestopWithIva = Math.round(repuestopNet * (1 + t.comisionIva));
    return {
      rate: appRate,
      repuestopNet,
      repuestopIva: repuestopWithIva - repuestopNet,
      repuestopWithIva,
      flowWithIva: Math.round(safeBase * flowRateWithIva),
    };
  }
}

export function serviceFeeAmount(basePrice: number, founder: boolean = false) {
  const breakdown = pricingFeeBreakdown(basePrice, founder);
  return breakdown.repuestopWithIva + breakdown.flowWithIva;
}

export function calculateSellerEarnings(basePrice: number, founder: boolean = false) {
  if (basePrice <= 0) return 0;
  return Math.max(0, Math.round(basePrice - serviceFeeAmount(basePrice, founder)));
}

export function calculateSuggestedPrice(desiredAmount: number, founder: boolean = false) {
  if (desiredAmount <= 0 || !Number.isFinite(desiredAmount)) return 0;
  const safeDesired = Math.min(999_999_999, desiredAmount);
  let low = safeDesired;
  let high = Math.min(999_999_999, Math.ceil(safeDesired / 0.8));
  let iterations = 0;
  while (calculateSellerEarnings(high, founder) < safeDesired && high < 999_999_999 && iterations < 50) {
    high = Math.min(999_999_999, high * 2);
    iterations++;
  }
  iterations = 0;
  while (low < high && iterations < 50) {
    const middle = Math.floor((low + high) / 2);
    if (calculateSellerEarnings(middle, founder) >= safeDesired) high = middle;
    else low = middle + 1;
    iterations++;
  }
  return low;
}

/** "Recibes $X" de la vista previa de la carga con Excel: el líquido de ese precio; null sin precio. */
export function liquidoDe(precio: number | null, founder: boolean = false): string | null {
  if (precio === null || !(precio > 0)) return null;
  return `$${calculateSellerEarnings(precio, founder).toLocaleString('es-CL')}`;
}

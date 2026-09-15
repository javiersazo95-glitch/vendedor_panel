export const FLOW_RATE_BASE = 0.0289;
const FLOW_IVA = 0.19;
const FLOW_RATE_WITH_IVA = FLOW_RATE_BASE * (1 + FLOW_IVA);
const FOUNDER_APP_RATE = 0.05;
// Si es false, el porcentaje es neto y el IVA (19%) se cobra adicional al vendedor (% + IVA)
const COMMISSION_IVA_INCLUDED = false;

export function pricingFeeBreakdown(basePrice: number, founder: boolean = false) {
  if (basePrice <= 0 || !Number.isFinite(basePrice)) {
    return { rate: founder ? FOUNDER_APP_RATE : 0.10, repuestopNet: 0, repuestopIva: 0, repuestopWithIva: 0, flowWithIva: 0 };
  }
  const safeBase = Math.min(999_999_999, basePrice);
  let appRate = 0.10;
  if (founder) {
    appRate = FOUNDER_APP_RATE;
  } else if (safeBase > 100_000 && safeBase <= 250_000) {
    appRate = 0.07;
  } else if (safeBase > 250_000) {
    appRate = 0.05;
  }

  if (COMMISSION_IVA_INCLUDED) {
    const repuestopWithIva = Math.round(safeBase * appRate);
    const repuestopNet = Math.round(repuestopWithIva / (1 + FLOW_IVA));
    const repuestopIva = repuestopWithIva - repuestopNet;
    return {
      rate: appRate,
      repuestopNet,
      repuestopIva,
      repuestopWithIva,
      flowWithIva: Math.round(safeBase * FLOW_RATE_WITH_IVA),
    };
  } else {
    const repuestopNet = Math.round(safeBase * appRate);
    const repuestopWithIva = Math.round(repuestopNet * (1 + FLOW_IVA));
    return {
      rate: appRate,
      repuestopNet,
      repuestopIva: repuestopWithIva - repuestopNet,
      repuestopWithIva,
      flowWithIva: Math.round(safeBase * FLOW_RATE_WITH_IVA),
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

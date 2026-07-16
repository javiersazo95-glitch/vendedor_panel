const FLOW_RATE_WITH_IVA = 0.0289 * 1.19;

export function pricingFeeBreakdown(basePrice: number, founder: boolean) {
  if (basePrice <= 0) return { rate: founder ? 0.05 : 0.10, repuestopNet: 0, repuestopIva: 0, repuestopWithIva: 0, flowWithIva: 0 };
  let rate = founder ? 0.05 : 0.10;
  if (!founder && basePrice > 100_000 && basePrice <= 250_000) rate = 0.07;
  if (!founder && basePrice > 250_000) rate = 0.05;
  const repuestopNet = Math.round(basePrice * rate);
  const repuestopWithIva = Math.round(repuestopNet * 1.19);
  return {
    rate,
    repuestopNet,
    repuestopIva: repuestopWithIva - repuestopNet,
    repuestopWithIva,
    flowWithIva: Math.round(basePrice * FLOW_RATE_WITH_IVA),
  };
}

export function serviceFeeAmount(basePrice: number, founder: boolean) {
  const breakdown = pricingFeeBreakdown(basePrice, founder);
  return breakdown.repuestopWithIva + breakdown.flowWithIva;
}

export function calculateSellerEarnings(basePrice: number, founder: boolean) {
  if (basePrice <= 0) return 0;
  return Math.max(0, Math.round(basePrice - serviceFeeAmount(basePrice, founder)));
}

export function calculateSuggestedPrice(desiredAmount: number, founder: boolean) {
  if (desiredAmount <= 0) return 0;
  let low = desiredAmount;
  let high = Math.ceil(desiredAmount / 0.8);
  while (calculateSellerEarnings(high, founder) < desiredAmount) high *= 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calculateSellerEarnings(middle, founder) >= desiredAmount) high = middle;
    else low = middle + 1;
  }
  return low;
}

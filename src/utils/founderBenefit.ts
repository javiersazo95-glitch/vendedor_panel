import { FOUNDER_FREE_MONTHS, STANDARD_RATE_LABEL } from './pricing';

export interface FounderDaysLeft {
  /** Dias enteros que quedan de marcha blanca (ceil); 0 si vencio o no hay fecha. */
  daysLeft: number;
  /** true solo cuando hay fecha y ya paso. Sin fecha no se da por vencida. */
  isExpired: boolean;
  /** Fin de la marcha blanca, o null si no vino o no se pudo leer. */
  endsAt: Date | null;
}

/**
 * Cuanto queda de la marcha blanca Fundador (mismo criterio que `getProductTopStatus`: dias por
 * arriba, asi "quedan 1 dias" nunca aparece como 0 mientras todavia corre).
 */
export function founderDaysLeft(founderUntil: string | null | undefined, now: Date = new Date()): FounderDaysLeft {
  const endsAt = founderUntil ? new Date(founderUntil) : null;
  if (!endsAt || Number.isNaN(endsAt.getTime())) return { daysLeft: 0, isExpired: false, endsAt: null };
  const remaining = endsAt.getTime() - now.getTime();
  if (remaining <= 0) return { daysLeft: 0, isExpired: true, endsAt };
  return { daysLeft: Math.ceil(remaining / 86_400_000), isExpired: false, endsAt };
}

/** Texto corto del badge: "Servicio gratis · quedan N días" / "último día" / "Servicio gratis". */
export function founderBenefitLabel(founderUntil: string | null | undefined, now: Date = new Date()): string {
  const { daysLeft, endsAt, isExpired } = founderDaysLeft(founderUntil, now);
  if (!endsAt || isExpired) return 'Servicio gratis';
  if (daysLeft === 1) return 'Servicio gratis · último día';
  return `Servicio gratis · quedan ${daysLeft} días`;
}

/** Lo que viene despues de la marcha blanca, para decirlo siempre junto al beneficio. */
export function founderAfterLabel(): string {
  return `Después: ${STANDARD_RATE_LABEL} + IVA por venta. El costo de Flow se mantiene.`;
}

/** Fecha de termino en formato chileno (DD/MM/AAAA), o null si no hay. */
export function founderEndsAtLabel(founderUntil: string | null | undefined): string | null {
  const { endsAt } = founderDaysLeft(founderUntil);
  if (!endsAt) return null;
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(endsAt);
}

/** Tooltip del badge Fundador: que recibe, hasta cuando, que paga igual y que viene despues. */
export function founderTooltip(founderUntil: string | null | undefined): string {
  const hasta = founderEndsAtLabel(founderUntil);
  const plazo = `marcha blanca de ${FOUNDER_FREE_MONTHS} meses${hasta ? ` (hasta ${hasta})` : ''}`;
  return `0% de tarifa de servicio RepuesTop durante tu ${plazo}. Solo pagas Flow 2,89% + IVA. ${founderAfterLabel()}`;
}

import { useEffect, useMemo, useRef } from 'react';
import { RepuestopCoin } from './RepuestopCoin';

/**
 * Lluvia de Monedas RepuesTop al volver de Flow con la recarga acreditada.
 *
 * Port de la que ya tienen la app y el market web: el vendedor que recarga desde el panel tiene
 * que ver lo mismo que vería recargando desde su teléfono.
 *
 * La caída es CSS y no JS: el navegador la corre en el compositor, así que no compite con el
 * render de React mientras el monedero se está acomodando. Lo único en JS es el temporizador que
 * avisa cuando terminó, porque de eso depende la fase siguiente.
 *
 * Es puramente decorativa (`aria-hidden`, sin clics).
 */

const DEFAULT_DURATION = 3000;

/**
 * Pseudo-aleatorio estable por índice: sin esto cada re-render repartiría las monedas de nuevo
 * y la lluvia saltaría a mitad de camino.
 */
function aleatorio(indice: number, semilla: number): number {
  const x = Math.sin((indice + 1) * semilla) * 10000;
  return x - Math.floor(x);
}

interface CoinDropAnimationProps {
  active: boolean;
  count?: number;
  minSize?: number;
  maxSize?: number;
  totalDuration?: number;
  onFinish?: () => void;
}

export function CoinDropAnimation({
  active,
  count = 9,
  minSize = 56,
  maxSize = 104,
  totalDuration = DEFAULT_DURATION,
  onFinish,
}: CoinDropAnimationProps) {
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const monedas = useMemo(
    () => Array.from({ length: count }, (_, i) => ({
      key: `moneda-${i}`,
      // Se reparten en carriles para que no se amontonen en una franja.
      left: ((i + aleatorio(i, 12.9898) * 0.8) / count) * 100,
      size: minSize + aleatorio(i, 78.233) * (maxSize - minSize),
      delay: aleatorio(i, 43.512) * totalDuration * 0.35,
      duration: totalDuration * (0.5 + aleatorio(i, 93.717) * 0.3),
      giros: 2 + Math.floor(aleatorio(i, 27.611) * 3),
      deriva: (aleatorio(i, 55.301) - 0.5) * 90,
    })),
    [count, maxSize, minSize, totalDuration],
  );

  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => onFinishRef.current?.(), totalDuration);
    return () => clearTimeout(id);
  }, [active, totalDuration]);

  if (!active) return null;

  return <div className="coin-rain" aria-hidden="true">
    {monedas.map((moneda) => <span key={moneda.key} className="coin-rain-item" style={{
      left: `${moneda.left}%`,
      '--coin-size': `${moneda.size}px`,
      '--coin-delay': `${moneda.delay}ms`,
      '--coin-dur': `${moneda.duration}ms`,
      '--coin-giro': `${moneda.giros * 360}deg`,
      '--coin-deriva': `${moneda.deriva}px`,
    } as React.CSSProperties}>
      <RepuestopCoin size={moneda.size} />
    </span>)}
  </div>;
}

/** Quien pidió menos movimiento en su sistema se salta la lluvia. */
export function prefiereMenosMovimiento(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

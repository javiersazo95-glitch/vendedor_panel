/**
 * Quien pidió menos movimiento en su sistema se salta la lluvia de monedas.
 *
 * Vive aparte de CoinDropAnimation.tsx porque un archivo de componentes solo puede exportar
 * componentes (react-refresh/only-export-components): el CI de `main` fallaba por eso.
 */
export function prefiereMenosMovimiento(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

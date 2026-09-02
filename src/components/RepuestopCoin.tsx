import type { CSSProperties } from 'react';
import coinLogo from '../assets/repuestop-coin-logo.png';

/** Versión web de la moneda oficial que usa el monorepo móvil. */
export function RepuestopCoin({ size = 36, style }: { size?: number; style?: CSSProperties }) {
  // El componente móvil oculta el wordmark bajo 64px y deja el emblema oficial
  // al centro. El encabezado usa precisamente ese tamaño compacto.
  const showWordmark = size >= 64;
  return <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Moneda RepuesTop" style={style}>
    <defs>
      <linearGradient id="rt-coin-rim" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffffff"/><stop offset=".3" stopColor="#b7c2d0"/><stop offset=".55" stopColor="#f2f5f9"/><stop offset=".78" stopColor="#8f9dae"/><stop offset="1" stopColor="#6f7d8d"/></linearGradient>
      <linearGradient id="rt-coin-blue" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#3f83e0"/><stop offset=".45" stopColor="#0f4aa8"/><stop offset=".75" stopColor="#0a3a88"/><stop offset="1" stopColor="#2c6fd0"/></linearGradient>
      <radialGradient id="rt-coin-face" cx=".36" cy=".26" r=".95"><stop stopColor="#ffffff"/><stop offset=".5" stopColor="#f4f7fb"/><stop offset=".82" stopColor="#dbe3ee"/><stop offset="1" stopColor="#c2cddb"/></radialGradient>
      <linearGradient id="rt-coin-shine" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ffffff" stopOpacity=".9"/><stop offset=".6" stopColor="#ffffff" stopOpacity="0"/></linearGradient>
      <path id="rt-coin-top" d="M 20 100 A 80 80 0 0 1 180 100" fill="none" />
      <path id="rt-coin-bottom" d="M 16 100 A 84 84 0 0 0 184 100" fill="none" />
    </defs>
    <circle cx="100" cy="103" r="97" fill="#0f1b2d" opacity=".18"/>
    <circle cx="100" cy="100" r="99" fill="#6f7d8d"/>
    <circle cx="100" cy="100" r="95" fill="url(#rt-coin-rim)"/>
    <circle cx="100" cy="100" r="91" fill="url(#rt-coin-blue)"/>
    <circle cx="100" cy="100" r="91" fill="none" stroke="#0a3372" strokeWidth="1.5" opacity=".6"/>
    <circle cx="100" cy="100" r="73" fill="#9fb0c4"/>
    <circle cx="100" cy="100" r="72" fill="url(#rt-coin-face)" stroke="#ffffff" strokeWidth="2"/>
    <text fill="#ffffff" fontSize="16" fontWeight="800" letterSpacing="3.5" textAnchor="middle"><textPath href="#rt-coin-top" startOffset="50%">REPUESTOP</textPath></text>
    <text fill="#cfe0f4" fontSize="14" fontWeight="800" letterSpacing="4.5" textAnchor="middle"><textPath href="#rt-coin-bottom" startOffset="50%">FICHA</textPath></text>
    <g fill="#f3f7fc"><path d="M27 90l2 6 6 .1-4.8 3.6 1.8 6-5.2-3.4-5.1 3.4 1.7-6-4.8-3.6 6-.1z"/><path d="M173 90l2 6 6 .1-4.8 3.6 1.8 6-5.2-3.4-5.1 3.4 1.7-6-4.8-3.6 6-.1z"/></g>
    <image href={coinLogo} x="60" y={showWordmark ? "66" : "80"} width="80" height="47" preserveAspectRatio="xMidYMid meet" />
    {showWordmark && <text x="100" y="128" fill="#243442" fontSize="16" fontWeight="800" textAnchor="middle">Repues<tspan fill="#0056bf">Top</tspan></text>}
    <path d="M100 9a91 91 0 0 1 64.3 26.7A91 91 0 0 0 35.7 35.7 90.7 90.7 0 0 1 100 9z" fill="url(#rt-coin-shine)"/>
    <circle cx="100" cy="100" r="95" fill="none" stroke="#ffffff" strokeWidth="1" opacity=".5"/>
  </svg>;
}

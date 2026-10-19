import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Video tutorial del sistema para las tiendas (19-oct, decision del usuario): "Manual de uso
 * RepuesTop", del canal de RepuesTop en YouTube. Mismo video que en Mi cuenta del Market.
 *
 * Va con youtube-nocookie.com (modo de privacidad mejorada de YouTube): no guarda cookies hasta que
 * la persona le da play, y el iframe solo existe con la ventana abierta. La CSP (vercel.json,
 * frame-src) lo permite.
 */
export const VIDEO_TUTORIAL_ID = 'QGvfVGSFOAA';
const VIDEO_TUTORIAL_URL = `https://www.youtube.com/watch?v=${VIDEO_TUTORIAL_ID}`;

type Props = { isOpen: boolean; onClose: () => void };

export function VideoTutorialModal({ isOpen, onClose }: Props) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2400, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 16, background: 'rgba(15, 23, 42, 0.6)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-tutorial-titulo"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(960px, 100%)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
          background: 'hsl(var(--surface, 0 0% 100%))', borderRadius: 16, padding: 20,
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.35)',
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <h2 id="video-tutorial-titulo" style={{ margin: 0, fontSize: '1.15rem' }}>Aprende a usar RepuesTop</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.9rem', opacity: 0.75 }}>
              Manual de uso para tiendas: publicar, vender, cotizar y retirar tu dinero.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar video"
            style={{
              width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 10, border: '1px solid rgba(148, 163, 184, 0.5)', background: 'transparent', cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </header>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden', background: '#0f172a' }}>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_TUTORIAL_ID}?rel=0&modestbranding=1`}
            title="Manual de uso RepuesTop"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        </div>
        <a href={VIDEO_TUTORIAL_URL} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 12, fontSize: '0.85rem' }}>
          Ver en YouTube
        </a>
      </div>
    </div>,
    document.body,
  );
}

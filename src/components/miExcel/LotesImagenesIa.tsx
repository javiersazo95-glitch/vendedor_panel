/** Las tandas de imágenes referenciales de los últimos 30 días, dentro del historial de cargas. */
import { useEffect, useState } from 'react';
import { Images, Sparkles } from 'lucide-react';
import { useFlag } from '../../remoteConfig/hooks';
import { getStoredSession } from '../../utils/session';
import { FLAG_IMAGENES_IA, listarLotesImagenesIa, type LoteImagenesIa } from '../../utils/imagenesIaApi';
import { Modal } from './comunes';
import { GaleriaImagenesIa } from './GaleriaImagenesIa';
import { plural } from './textos';

export function LotesImagenesIa() {
  const encendido = useFlag(FLAG_IMAGENES_IA, false);
  const [lotes, setLotes] = useState<LoteImagenesIa[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    const sesion = getStoredSession();
    if (!encendido || !sesion) return undefined;
    let cancelado = false;
    // Si no responde, el historial de cargas se ve igual: esta sección simplemente no aparece.
    listarLotesImagenesIa(sesion).then((l) => { if (!cancelado) setLotes(l); }).catch(() => undefined);
    return () => { cancelado = true; };
  }, [encendido, abierto]);

  if (!encendido || lotes.length === 0) return null;
  return (
    <section aria-label="Imágenes referenciales" className="mx-lotes-ia">
      <h3><Sparkles size={17} /> Imágenes referenciales</h3>
      <ul>
        {lotes.map((l) => (
          <li key={l.lote}>
            <span>
              {new Date(l.creadoEn).toLocaleDateString('es-CL')} · <b>{plural(l.listas, 'lista', 'listas')}</b> de {l.total.toLocaleString('es-CL')}
              {l.enProceso > 0 && ` · ${l.enProceso.toLocaleString('es-CL')} por crear`}
            </span>
            <button type="button" className="btn btn-secondary mx-btn" onClick={() => setAbierto(l.lote)}><Images size={15} /> Ver imágenes</button>
          </li>
        ))}
      </ul>
      {abierto && (
        <Modal titulo="Imágenes referenciales" icono={<Sparkles size={18} />} ancho={980} onCerrar={() => setAbierto(null)}>
          <GaleriaImagenesIa lote={abierto} />
        </Modal>
      )}
    </section>
  );
}

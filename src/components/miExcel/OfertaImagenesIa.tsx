/** "Crear una imagen referencial para cada uno": la oferta que se ve justo antes de publicar. */
import { Sparkles } from 'lucide-react';
import { plazoEstimado, type CupoImagenesIa } from '../../utils/imagenesIaApi';
import { plural } from './textos';

interface Props {
  cupo: CupoImagenesIa;
  /** Repuestos nuevos que se publicarán sin foto. */
  candidatos: number;
  /** Sin foto, pero usados o reacondicionados. */
  usados: number;
  marcada: boolean;
  onMarcar: (marcada: boolean) => void;
}

export function OfertaImagenesIa({ cupo, candidatos, usados, marcada, onMarcar }: Props) {
  const entran = Math.min(candidatos, cupo.restantes);
  return (
    <section className="mx-oferta-ia" aria-label="Imágenes referenciales">
      <label>
        <input type="checkbox" checked={marcada && entran > 0} disabled={entran === 0} onChange={(e) => onMarcar(e.target.checked)} />
        <span>
          <b><Sparkles size={16} /> {candidatos === 1 ? 'Crear una imagen referencial para el repuesto sin foto' : `Crear una imagen referencial para los ${candidatos.toLocaleString('es-CL')} repuestos sin foto`}</b>
          <small>
            Se crea con inteligencia artificial según los datos de cada repuesto y lleva impreso «Imagen referencial creada con IA».
            Cuando subas una foto real, la reemplaza.
          </small>
        </span>
      </label>
      <ul>
        {entran === 0 && <li>Ya se usaron las {cupo.cupoDiario.toLocaleString('es-CL')} imágenes de hoy: puedes pedir más mañana.</li>}
        {entran > 0 && entran < candidatos && (
          <li>Hoy se {entran === 1 ? 'creará' : 'crearán'} {plural(entran, 'imagen', 'imágenes')}, por el cupo del día. Los demás se publican sin foto.</li>
        )}
        {entran > 0 && <li>Se publican de inmediato y las imágenes van llegando solas: {plazoEstimado(entran, cupo)}.</li>}
        {usados > 0 && <li>{plural(usados, 'repuesto usado o reacondicionado queda', 'repuestos usados o reacondicionados quedan')} fuera: necesitan fotos propias.</li>}
      </ul>
    </section>
  );
}

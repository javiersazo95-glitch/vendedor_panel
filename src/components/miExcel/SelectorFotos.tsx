/**
 * Galería para elegir las fotos de un repuesto (máximo 4), entre las de la carpeta o ZIP que subió
 * el vendedor y las que ya estaban guardadas en su progreso.
 */
import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { MAX_IMAGES_PER_PRODUCT } from '../../utils/fotosCarga';
import { Miniatura, Modal } from './comunes';
import { plural } from './textos';

const POR_PAGINA = 60;

interface Props {
  titulo: string;
  imagenes: Record<string, Blob>;
  guardadas: Record<string, number>;
  seleccion: string[];
  onListo: (seleccion: string[]) => void;
  onCerrar: () => void;
}

export function SelectorFotos({ titulo, imagenes, guardadas, seleccion, onListo, onCerrar }: Props) {
  const [elegidas, setElegidas] = useState<string[]>(seleccion);
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);

  const nombres = useMemo(
    () => [...new Set([...Object.keys(imagenes), ...Object.keys(guardadas)])].sort(),
    [imagenes, guardadas],
  );
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q ? nombres.filter((n) => n.includes(q)) : nombres;
    // Las elegidas van primero: así se ven aunque estén en otra página.
    return [...elegidas.filter((n) => base.includes(n)), ...base.filter((n) => !elegidas.includes(n))];
  }, [nombres, busqueda, elegidas]);
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const actual = Math.min(pagina, paginas);
  const visibles = filtradas.slice((actual - 1) * POR_PAGINA, actual * POR_PAGINA);

  const alternar = (nombre: string) => {
    setElegidas((prev) => {
      if (prev.includes(nombre)) return prev.filter((n) => n !== nombre);
      if (prev.length >= MAX_IMAGES_PER_PRODUCT) return prev;
      return [...prev, nombre];
    });
  };

  return (
    <Modal
      titulo={titulo}
      ancho={860}
      onCerrar={onCerrar}
      acciones={(
        <>
          <span className="mx-nota">{elegidas.length}/{MAX_IMAGES_PER_PRODUCT} fotos elegidas · la primera es la principal</span>
          <button type="button" className="btn btn-secondary mx-btn" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={() => onListo(elegidas)}>Listo</button>
        </>
      )}
    >
      {nombres.length === 0 ? (
        <p className="mx-ayuda">No tienes fotos cargadas. Vuelve al paso 1 o usa "Agregar fotos" arriba de la tabla para elegir tu carpeta.</p>
      ) : (
        <>
          <label className="mx-buscador">
            <Search size={16} />
            <input
              type="search"
              placeholder="Buscar por nombre de archivo"
              value={busqueda}
              onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }}
              aria-label="Buscar foto por nombre"
            />
          </label>
          <p className="mx-nota">{plural(filtradas.length, 'foto', 'fotos')}. Haz clic para elegir o quitar.</p>
          <div className="mx-galeria">
            {visibles.map((nombre) => {
              const orden = elegidas.indexOf(nombre);
              const lleno = orden < 0 && elegidas.length >= MAX_IMAGES_PER_PRODUCT;
              return (
                <button
                  type="button"
                  key={nombre}
                  className={`mx-galeria-item ${orden >= 0 ? 'elegida' : ''}`}
                  onClick={() => alternar(nombre)}
                  disabled={lleno}
                  aria-pressed={orden >= 0}
                  title={nombre}
                >
                  <Miniatura nombre={nombre} blob={imagenes[nombre]} imagenId={guardadas[nombre]} tamano={104} />
                  {orden >= 0 && <span className="mx-galeria-orden">{orden === 0 ? <Check size={14} /> : orden + 1}</span>}
                  <span className="mx-galeria-nombre">{nombre}</span>
                </button>
              );
            })}
          </div>
          {paginas > 1 && (
            <div className="mx-paginado">
              <button type="button" className="btn btn-secondary mx-btn" disabled={actual <= 1} onClick={() => setPagina(actual - 1)}>Anteriores</button>
              <span>Página {actual} de {paginas}</span>
              <button type="button" className="btn btn-secondary mx-btn" disabled={actual >= paginas} onClick={() => setPagina(actual + 1)}>Siguientes</button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

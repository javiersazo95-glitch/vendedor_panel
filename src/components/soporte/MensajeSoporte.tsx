import { useState, type KeyboardEvent } from 'react';
import { ImageOff, X } from 'lucide-react';
import type { MensajeSoporte as Mensaje } from '../../utils/soporteCargaApi';
import { useImagenPrivada } from '../../utils/useImagenPrivada';
import { formatearMomento } from './textosSoporte';

function ImagenDelMensaje({ ruta }: { ruta: string }) {
  const { url, cargando, error } = useImagenPrivada(ruta);
  const [ampliada, setAmpliada] = useState(false);

  if (error) {
    return (
      <div className="soporte-imagen-estado">
        <ImageOff size={18} aria-hidden="true" /> No se pudo cargar la imagen
      </div>
    );
  }
  if (cargando || !url) {
    return <div className="soporte-imagen-estado soporte-imagen-cargando">Cargando imagen…</div>;
  }

  const cerrarConEscape = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Que el Escape cierre solo la foto y no todo el panel de soporte.
      e.stopPropagation();
      setAmpliada(false);
    }
  };

  return (
    <>
      <button type="button" className="soporte-imagen-boton" onClick={() => setAmpliada(true)} aria-label="Ver imagen en grande">
        <img src={url} alt="Imagen adjunta" className="soporte-imagen" />
      </button>
      {ampliada && (
        <div
          className="soporte-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Imagen en grande"
          onClick={() => setAmpliada(false)}
          onKeyDown={cerrarConEscape}
        >
          <button
            type="button"
            className="soporte-lightbox-cerrar"
            onClick={() => setAmpliada(false)}
            aria-label="Cerrar imagen"
            autoFocus
          >
            <X size={22} aria-hidden="true" />
          </button>
          <img src={url} alt="Imagen adjunta en grande" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

/** Un mensaje del chat: el vendedor a la derecha, soporte a la izquierda y avisos del sistema al centro. */
export function MensajeSoporte({ mensaje }: { mensaje: Mensaje }) {
  const momento = formatearMomento(mensaje.createdAt);

  if (mensaje.autor === 'SISTEMA') {
    return (
      <li className="soporte-mensaje soporte-mensaje-sistema">
        <span>{mensaje.texto}</span>
        {momento && <time dateTime={mensaje.createdAt}> · {momento}</time>}
      </li>
    );
  }

  const esVendedor = mensaje.autor === 'VENDEDOR';
  const autor = esVendedor ? 'Tú' : mensaje.autorNombre?.trim() || 'Soporte RepuesTop';

  return (
    <li className={`soporte-mensaje ${esVendedor ? 'soporte-mensaje-vendedor' : 'soporte-mensaje-soporte'}`}>
      <div className="soporte-burbuja">
        {!esVendedor && <span className="soporte-burbuja-autor">{autor}</span>}
        {mensaje.imagenUrl && <ImagenDelMensaje ruta={mensaje.imagenUrl} />}
        {mensaje.texto && <p className="soporte-burbuja-texto">{mensaje.texto}</p>}
        {momento && (
          <time className="soporte-burbuja-hora" dateTime={mensaje.createdAt}>
            {momento}
          </time>
        )}
      </div>
    </li>
  );
}

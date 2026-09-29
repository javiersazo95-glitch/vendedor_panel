import React, { useState } from 'react';
import { FileSpreadsheet, PackagePlus, Tag, Wand2 } from 'lucide-react';
import { FullCreationUpload } from './FullCreationUpload';
import { ExpressUpload } from './ExpressUpload';
import { HistorialCargas } from './HistorialCargas';

/**
 * "Cargar inventario": una sola entrada con una pregunta, "¿Qué tienes?" (Fase 8 del plan de
 * auditoría de carga). Antes había cuatro caminos con nombres que cambiaban ("Carga Manual 1:1",
 * "Carga Masiva", "Publicación Completa", "Actualización Rápida", "Adaptar mi plantilla") y había
 * que descubrir pestañas dentro de otras pantallas. Ahora el vendedor dice qué tiene y llega
 * directo a la pantalla que le sirve.
 */

type Camino = 'uno' | 'mi-excel' | 'plantilla' | 'precios';

interface CargaInventarioProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
  onExpressSuccess?: (cargados: number) => void;
  /** "Un repuesto" abre el formulario 1 a 1, que vive en el Dashboard. */
  onAbrirUnoAUno: () => void;
  /** "historial" muestra el historial de cargas en vez de la pregunta. */
  vista?: 'elegir' | 'historial';
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

const OPCIONES: { camino: Camino; titulo: string; detalle: string; icono: React.ReactNode }[] = [
  {
    camino: 'uno',
    titulo: 'Un repuesto',
    detalle: 'Lo publicas llenando un formulario, con sus fotos.',
    icono: <PackagePlus size={28} />,
  },
  {
    camino: 'mi-excel',
    titulo: 'Mi propio Excel',
    detalle: 'La lista que ya usas, con tus columnas. Te ayudamos a leerla.',
    icono: <Wand2 size={28} />,
  },
  {
    camino: 'plantilla',
    titulo: 'La plantilla de RepuesTop',
    detalle: 'El Excel que descargas de aquí, con listas para elegir.',
    icono: <FileSpreadsheet size={28} />,
  },
  {
    camino: 'precios',
    titulo: 'Sólo cambiar precios y stock',
    detalle: 'De repuestos que ya publicaste. No crea productos nuevos.',
    icono: <Tag size={28} />,
  },
];

export const CargaInventario: React.FC<CargaInventarioProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
  onExpressSuccess,
  onAbrirUnoAUno,
  vista = 'elegir',
  embedded = false,
  onBusyChange,
}) => {
  const [camino, setCamino] = useState<Camino | null>(null);

  if (!isOpen) return null;

  if (vista === 'historial') {
    return (
      <div className="bulk-upload-page">
        <div className="bulk-upload-page-content carga-inventario">
          <HistorialCargas />
        </div>
      </div>
    );
  }

  const volver = () => setCamino(null);

  if (camino === 'mi-excel' || camino === 'plantilla') {
    return (
      <FullCreationUpload
        key={camino}
        isOpen={isOpen}
        onClose={onClose}
        onUploadSuccess={onUploadSuccess}
        embedded={embedded}
        inicio={camino === 'mi-excel' ? 'mapper' : 'plantilla'}
        onVolver={volver}
        onBusyChange={onBusyChange}
      />
    );
  }

  if (camino === 'precios') {
    return (
      <ExpressUpload
        isOpen={isOpen}
        onClose={onClose}
        onUploadSuccess={onUploadSuccess}
        onExpressSuccess={onExpressSuccess}
        onVolver={volver}
        embedded={embedded}
      />
    );
  }

  return (
    <div className="bulk-upload-page">
      <div className="bulk-upload-page-content carga-inventario">
        <h3 className="carga-inventario-titulo">¿Qué tienes?</h3>
        <p className="carga-inventario-sub">Elige lo que más se parece a lo que traes. Siempre puedes volver a esta pregunta.</p>
        <div className="carga-inventario-opciones">
          {OPCIONES.map((opcion) => (
            <button
              key={opcion.camino}
              type="button"
              className="carga-inventario-opcion"
              onClick={() => (opcion.camino === 'uno' ? onAbrirUnoAUno() : setCamino(opcion.camino))}
            >
              <span className="carga-inventario-icono">{opcion.icono}</span>
              <span className="carga-inventario-texto">
                <strong>{opcion.titulo}</strong>
                <span>{opcion.detalle}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

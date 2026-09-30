import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, History, PackagePlus, Tag, Wand2 } from 'lucide-react';
import { FullCreationUpload } from './FullCreationUpload';
import { MiExcelWizard } from './miExcel/MiExcelWizard';
import { PASOS_MI_EXCEL } from './miExcel/textos';
import { deserializarBorrador, fechaYHora, obtenerBorrador, type EstadoBorrador } from '../utils/miExcelBorrador';
import type { RegistrarGuardia } from '../utils/guardiaSalida';
import { ExpressUpload } from './ExpressUpload';
import { HistorialCargas } from './HistorialCargas';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../utils/imageHelper';
import { getStoredSession } from '../utils/session';
import { encId } from '../utils/url';
import { NOMBRE_EXPRESS } from '../utils/expressPreciosStock';

/**
 * "Cargar inventario": una sola entrada con una pregunta, "¿Qué tienes?" (Fase 8 del plan de
 * auditoría de carga). Antes había cuatro caminos con nombres que cambiaban ("Carga Manual 1:1",
 * "Carga Masiva", "Publicación Completa", "Actualización Rápida", "Adaptar mi plantilla") y había
 * que descubrir pestañas dentro de otras pantallas. Ahora el vendedor dice qué tiene y llega
 * directo a la pantalla que le sirve.
 */

type Camino = 'uno' | 'mi-excel' | 'plantilla' | 'precios';

/**
 * El asistente nuevo de "Mi propio Excel" (4 etapas, progreso guardado). Con
 * VITE_MI_EXCEL_V2=false se vuelve al adaptador anterior, por si hubiera que retroceder.
 */
const MI_EXCEL_V2 = import.meta.env.VITE_MI_EXCEL_V2 !== 'false';

interface CargaInventarioProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
  onExpressSuccess?: (cargados: number) => void;
  /** "Un repuesto" abre el formulario 1 a 1, que vive en el Dashboard. */
  onAbrirUnoAUno: () => void;
  /** "historial" muestra el historial de cargas en vez de la pregunta. */
  vista?: 'elegir' | 'historial';
  /** "Ver todo el historial" de "Tus últimas cargas". */
  onVerHistorial?: () => void;
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** Para que el Dashboard pregunte antes de salir con cambios sin guardar. */
  onRegistrarGuardia?: RegistrarGuardia;
  /** La etapa 3 de "Mi propio Excel" usa todo el ancho: el menú lateral se oculta. */
  onAnchoCompletoChange?: (activo: boolean) => void;
}

interface CargaReciente {
  id: number;
  modo: string | null;
  estado: string;
  productosCargados: number;
  productosConError: number;
  createdAt: string;
}

/**
 * Las tres cargas más recientes, bajo la pregunta: lo primero que un vendedor quiere saber al
 * volver es cómo terminó lo último que subió. Si falla o no hay nada, no se muestra.
 */
function UltimasCargas({ onVerHistorial }: { onVerHistorial?: () => void }) {
  const [cargas, setCargas] = useState<CargaReciente[] | null>(null);

  useEffect(() => {
    const session = getStoredSession();
    if (!session?.sellerId || !session?.token) return;
    let cancelado = false;
    apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/excel/cargas?page=0&size=3`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelado) setCargas(Array.isArray(data?.content) ? data.content : []);
      })
      .catch(() => {
        // Es un resumen de cortesía: sin conexión simplemente no aparece.
      });
    return () => { cancelado = true; };
  }, []);

  if (!cargas || cargas.length === 0) return null;

  return (
    <section className="carga-recientes" aria-labelledby="carga-recientes-titulo">
      <div className="carga-recientes-head">
        <h4 id="carga-recientes-titulo">Tus últimas cargas</h4>
        {onVerHistorial && (
          <button type="button" className="carga-recientes-link" onClick={onVerHistorial}>
            <History size={16} /> Ver todo el historial
          </button>
        )}
      </div>
      <ul>
        {cargas.map((carga) => (
          <li key={carga.id}>
            <span className="carga-recientes-fecha">{new Date(carga.createdAt).toLocaleDateString('es-CL')}</span>
            <span className="carga-recientes-tipo">{carga.modo === 'EXPRESS' ? NOMBRE_EXPRESS : 'Publicar repuestos'}</span>
            <span className="carga-recientes-resultado">
              {carga.estado === 'PROCESANDO' || carga.estado === 'PENDIENTE'
                ? 'Procesando…'
                : `${carga.productosCargados} ${carga.productosCargados === 1 ? 'listo' : 'listos'}`}
              {carga.productosConError > 0 && (
                <strong>{` · ${carga.productosConError} por corregir`}</strong>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "Tienes una carga guardada": si el vendedor dejó a medias "Mi propio Excel", se le ofrece
 * retomarla desde la misma pregunta, sin tener que recordar por dónde entrar.
 */
function CargaGuardada({ onRetomar }: { onRetomar: () => void }) {
  const [guardada, setGuardada] = useState<{ updatedAt: string; estado: EstadoBorrador } | null>(null);
  useEffect(() => {
    let vivo = true;
    obtenerBorrador()
      .then((b) => {
        const estado = b?.estadoJson ? deserializarBorrador(b.estadoJson) : null;
        if (vivo && b && estado?.archivo) setGuardada({ updatedAt: b.updatedAt, estado });
      })
      .catch(() => { /* Sin conexión no se ofrece; el asistente lo vuelve a buscar al entrar. */ });
    return () => { vivo = false; };
  }, []);
  if (!guardada) return null;
  const { fecha, hora } = fechaYHora(guardada.updatedAt);
  const paso = PASOS_MI_EXCEL[guardada.estado.paso - 1];
  return (
    <section className="carga-guardada" aria-label="Carga guardada">
      <History size={22} />
      <div>
        <strong>Tienes una carga de "Mi propio Excel" guardada</strong>
        <span>
          {guardada.estado.archivo?.nombre} · guardada el {fecha} a las {hora} · ibas en el paso {paso.n}: {paso.titulo}
        </span>
      </div>
      <button type="button" className="btn btn-primary btn-primary-blue" onClick={onRetomar}>
        <History size={16} /> Retomar desde el punto guardado
      </button>
    </section>
  );
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
  onVerHistorial,
  embedded = false,
  onBusyChange,
  onRegistrarGuardia,
  onAnchoCompletoChange,
}) => {
  const [camino, setCamino] = useState<Camino | null>(null);
  const [retomarDirecto, setRetomarDirecto] = useState(false);

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

  const volver = () => { setCamino(null); setRetomarDirecto(false); };

  if (camino === 'mi-excel' && MI_EXCEL_V2) {
    return (
      <MiExcelWizard
        onVolver={volver}
        onClose={onClose}
        onUploadSuccess={onUploadSuccess}
        onBusyChange={onBusyChange}
        onRegistrarGuardia={onRegistrarGuardia}
        onAnchoCompletoChange={onAnchoCompletoChange}
        retomarDirecto={retomarDirecto}
      />
    );
  }

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
        {MI_EXCEL_V2 && <CargaGuardada onRetomar={() => { setRetomarDirecto(true); setCamino('mi-excel'); }} />}
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
        <UltimasCargas onVerHistorial={onVerHistorial} />
      </div>
    </div>
  );
};

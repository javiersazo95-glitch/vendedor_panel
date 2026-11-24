/**
 * El avance de una tanda de imágenes referenciales: se actualiza sola mientras queden por crear, y deja pedir
 * otra o quitar cada una. La usan el final de la carga y el historial.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { resolveImageUri } from '../../utils/imageHelper';
import { getStoredSession } from '../../utils/session';
import {
  descartarImagenIa, detalleLoteImagenesIa, regenerarImagenIa, type DetalleLoteImagenesIa, type EstadoImagenIa, type ItemImagenIa,
} from '../../utils/imagenesIaApi';
import { plural } from './textos';
import './miExcel.css';

const CADA_MS = 10_000;

const TEXTO_ESTADO: Record<EstadoImagenIa, string> = {
  PENDIENTE: 'En espera',
  PROCESANDO: 'Creando…',
  LISTA: 'Lista',
  FALLIDA: 'No se pudo crear',
  OMITIDA: 'Sin imagen',
  CANCELADA: 'Cancelada',
  DESCARTADA: 'La quitaste',
};

const enProceso = (item: ItemImagenIa) => item.estado === 'PENDIENTE' || item.estado === 'PROCESANDO';
/** Lo que ya no se puede volver a pedir: el repuesto no existe, no es nuevo o ya tiene su foto. */
const sinAcciones = (item: ItemImagenIa) => item.estado === 'OMITIDA' || item.nombre === null;

export function GaleriaImagenesIa({ lote }: { lote: string }) {
  const [detalle, setDetalle] = useState<DetalleLoteImagenesIa | null>(null);
  const [pagina, setPagina] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const vigente = useRef(0);

  const cargar = useCallback(async () => {
    const sesion = getStoredSession();
    if (!sesion) return;
    const turno = ++vigente.current;
    try {
      const datos = await detalleLoteImagenesIa(sesion, lote, pagina);
      if (turno === vigente.current) { setDetalle(datos); setError(null); }
    } catch (err) {
      if (turno === vigente.current) setError(err instanceof Error ? err.message : 'No pudimos cargar las imágenes referenciales.');
    }
  }, [lote, pagina]);

  useEffect(() => {
    // El detalle es un pedido al servidor: cargarlo al entrar es sincronizarse con él.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
    return () => { vigente.current += 1; };
  }, [cargar]);

  const quedan = (detalle?.resumen.enProceso ?? 0) > 0;
  useEffect(() => {
    if (!quedan) return undefined;
    const id = setInterval(() => void cargar(), CADA_MS);
    return () => clearInterval(id);
  }, [quedan, cargar]);

  const accion = async (item: ItemImagenIa, hacer: typeof regenerarImagenIa | typeof descartarImagenIa) => {
    const sesion = getStoredSession();
    if (!sesion) return;
    setOcupado(item.productoId);
    setError(null);
    try {
      await hacer(sesion, item.productoId);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo hacer el cambio.');
    } finally {
      setOcupado(null);
    }
  };

  if (!detalle) {
    return error
      ? <div className="mx-alerta error" role="alert">{error} <button type="button" className="mx-link" onClick={() => void cargar()}>Reintentar</button></div>
      : <p className="mx-nota"><Loader2 size={15} className="mx-girando" /> Cargando las imágenes…</p>;
  }

  const { resumen, items, paginas } = detalle;
  const pct = resumen.total > 0 ? Math.round((100 * (resumen.total - resumen.enProceso)) / resumen.total) : 100;
  return (
    <div className="mx-galeria-ia">
      <p role="status">
        <b>{plural(resumen.listas, 'imagen lista', 'imágenes listas')}</b> de {resumen.total.toLocaleString('es-CL')}
        {resumen.enProceso > 0 && ` · ${plural(resumen.enProceso, 'por crear', 'por crear')}`}
        {resumen.fallidas > 0 && ` · ${plural(resumen.fallidas, 'no se pudo crear', 'no se pudieron crear')}`}
      </p>
      <div className="mx-barra"><span style={{ width: `${pct}%` }} /></div>
      {quedan && <p className="mx-nota">Puedes cerrar esta ventana: siguen creándose solas y las encuentras en «Historial de cargas».</p>}
      {error && <div className="mx-alerta error" role="alert">{error}</div>}
      <div className="mx-galeria-ia-grilla">
        {items.map((item) => (
          <article key={item.productoId}>
            {item.imagenUrl
              ? <img src={resolveImageUri(item.imagenUrl)} alt={`Imagen referencial de ${item.nombre ?? 'un repuesto'}`} loading="lazy" />
              : <span className="mx-galeria-ia-vacia">{enProceso(item) ? <Loader2 size={24} className="mx-girando" /> : <ImageOff size={24} />}</span>}
            <b title={item.nombre ?? undefined}>{item.nombre ?? 'Repuesto eliminado'}</b>
            <small>{item.sku ?? '—'} · {TEXTO_ESTADO[item.estado] ?? item.estado}</small>
            {item.mensaje && item.estado !== 'LISTA' && <small>{item.mensaje}</small>}
            {!sinAcciones(item) && (
              <div className="mx-galeria-ia-acciones">
                {!enProceso(item) && (
                  <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" disabled={ocupado !== null} onClick={() => void accion(item, regenerarImagenIa)} aria-label={`Crear otra imagen de ${item.nombre}`}>
                    <RefreshCw size={14} /> Crear otra
                  </button>
                )}
                {(item.imagenUrl || enProceso(item)) && (
                  <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" disabled={ocupado !== null} onClick={() => void accion(item, descartarImagenIa)} aria-label={`Quitar la imagen de ${item.nombre}`}>
                    <Trash2 size={14} /> Quitar
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {paginas > 1 && (
        <div className="mx-paginado">
          <button type="button" className="btn btn-secondary mx-btn" disabled={pagina <= 0} onClick={() => setPagina(pagina - 1)}>Anteriores</button>
          <span>Página {pagina + 1} de {paginas}</span>
          <button type="button" className="btn btn-secondary mx-btn" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguientes</button>
        </div>
      )}
    </div>
  );
}

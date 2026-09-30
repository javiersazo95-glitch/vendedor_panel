import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Download, Eye, FileText, Search, XCircle } from 'lucide-react';
import { getAllProducts, type Product } from '../db';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../utils/imageHelper';
import { getStoredSession } from '../utils/session';
import { encId } from '../utils/url';
import { sanitizeRowsForExport } from '../utils/xlsxSafety';
import { NOMBRE_EXPRESS } from '../utils/expressPreciosStock';

/**
 * "Historial de cargas": todas las cargas del vendedor en un solo lugar (Fase 8 del plan de
 * auditoría de carga). Antes cada modo tenía su pestaña de historial escondida dentro de su
 * propia pantalla, y el "Ver detalle" del aviso de Express no llevaba a ninguna de las dos.
 * Lee `/excel/cargas`, que el backend guarda para las cargas hechas desde cualquier equipo.
 */

interface CargaResumen {
  id: number;
  archivoNombre: string | null;
  estado: string;
  modo: string | null;
  totalFilas: number;
  productosCargados: number;
  productosConError: number;
  productosConAdvertencia: number;
  createdAt: string;
}

interface HistorialResponse {
  content: CargaResumen[];
  totalPages: number;
  currentPage: number;
}

interface FilaDetalle {
  fila: number;
  sku: string;
  estado: 'OK' | 'ADVERTENCIA' | 'ERROR';
  mensajes: string[];
  /** El repuesto que creó o actualizó esta fila (no viene si la fila no se cargó). */
  productoId?: number | null;
}

type FiltroDetalle = 'todas' | 'OK' | 'ADVERTENCIA' | 'ERROR';

const ETIQUETA_FILA: Record<FilaDetalle['estado'], string> = {
  OK: 'Cargado',
  ADVERTENCIA: 'Cargado con aviso',
  ERROR: 'No se cargó',
};

const FILAS_POR_PAGINA = 50;

const clp = (valor: number) => valor.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

interface CargaDetalle {
  totalFilas: number;
  productosCargados: number;
  productosConError: number;
  productosConAdvertencia: number;
  /** Motivos de un error de todo el archivo (vienen con `filas` vacío). */
  errores?: string[];
  filas: FilaDetalle[];
}

const TEXTO = { fontSize: '0.95rem' } as const;
const CELDA = { padding: '0.6rem 0.75rem', fontSize: '0.95rem' } as const;

const ESTADOS: Record<string, string> = {
  COMPLETADA: 'Terminada',
  CON_ERRORES: 'Con filas por corregir',
  ERROR: 'No se pudo cargar',
  PROCESANDO: 'Procesando…',
  PENDIENTE: 'En espera…',
};

const tipoDeCarga = (modo: string | null) => (modo === 'EXPRESS' ? NOMBRE_EXPRESS : 'Publicar repuestos');

/** El repuesto de cada fila, tal como está hoy en el inventario: por su id y, si no, por su código. */
function repuestoDeFila(f: FilaDetalle, porId: Map<string, Product>, porSku: Map<string, Product>): Product | undefined {
  if (f.estado === 'ERROR') return undefined;
  return (f.productoId != null ? porId.get(String(f.productoId)) : undefined) ?? porSku.get(f.sku.trim().toUpperCase());
}

async function descargarResumen(id: number, filas: FilaDetalle[], repuesto: (f: FilaDetalle) => Product | undefined) {
  const XLSX = await import('xlsx');
  const hoja = XLSX.utils.json_to_sheet(sanitizeRowsForExport(filas.map((f) => {
    const p = repuesto(f);
    return {
      Fila: f.fila,
      Código: f.sku,
      Repuesto: p?.name ?? '',
      Categoría: p?.category ?? '',
      Marca: p?.partBrand ?? '',
      Precio: p ? (p.pricingMode === 'quote_only' ? 'A cotizar' : p.price) : '',
      Stock: p?.stock ?? '',
      Resultado: ETIQUETA_FILA[f.estado],
      Detalle: f.mensajes.join(' | '),
    };
  })));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Resumen de la carga');
  const salida = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
  const url = URL.createObjectURL(new Blob([salida], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `carga-${id}-resumen.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function descargarFilasConProblema(id: number, detalle: CargaDetalle) {
  const filas = detalle.filas.filter((f) => f.estado !== 'OK');
  if (filas.length === 0) return;
  const XLSX = await import('xlsx');
  const hoja = XLSX.utils.json_to_sheet(sanitizeRowsForExport(filas.map((f) => ({
    Fila: f.fila,
    Código: f.sku,
    Estado: f.estado === 'ERROR' ? 'No se cargó' : 'Con aviso',
    Motivo: f.mensajes.join(' | '),
  }))));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Filas por revisar');
  const salida = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
  const url = URL.createObjectURL(new Blob([salida], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `carga-${id}-filas-por-revisar.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const HistorialCargas: React.FC = () => {
  const [historial, setHistorial] = useState<HistorialResponse | null>(null);
  const [pagina, setPagina] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [detalleId, setDetalleId] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<CargaDetalle | null>(null);
  /** El inventario actual: de ahí salen el nombre, la categoría, el precio y el stock de cada fila. */
  const [inventario, setInventario] = useState<Product[] | null>(null);
  const [filtroDetalle, setFiltroDetalle] = useState<FiltroDetalle>('todas');
  const [busquedaDetalle, setBusquedaDetalle] = useState('');
  const [paginaDetalle, setPaginaDetalle] = useState(1);

  useEffect(() => {
    const session = getStoredSession();
    if (!session?.sellerId || !session?.token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('No encontramos tu sesión. Vuelve a iniciar sesión.');
      return;
    }
    let cancelado = false;
    setCargando(true);
    setError(null);
    apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/excel/cargas?page=${pagina}&size=20`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('No se pudo cargar el historial.');
        const data: HistorialResponse = await response.json();
        if (!cancelado) setHistorial(data);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof Error ? err.message : 'No se pudo cargar el historial.');
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => { cancelado = true; };
  }, [pagina]);

  const verDetalle = async (id: number) => {
    const session = getStoredSession();
    if (!session?.sellerId || !session?.token) return;
    setDetalleId(id);
    setDetalle(null);
    setFiltroDetalle('todas');
    setBusquedaDetalle('');
    setPaginaDetalle(1);
    // El inventario se pide una vez y en paralelo: si no responde, la tabla igual muestra código y resultado.
    if (inventario === null) getAllProducts().then(setInventario).catch(() => setInventario([]));
    try {
      const response = await apiFetch(
        `${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/excel/cargas/${encId(id)}`,
        { headers: { Authorization: `Bearer ${session.token}` } },
      );
      if (!response.ok) throw new Error('No se pudo abrir el detalle.');
      setDetalle(await response.json());
    } catch (err) {
      setDetalleId(null);
      setError(err instanceof Error ? err.message : 'No se pudo abrir el detalle.');
    }
  };

  const conProblema = detalle ? detalle.filas.filter((f) => f.estado !== 'OK') : [];

  const { porId, porSku } = useMemo(() => ({
    porId: new Map((inventario ?? []).map((p) => [p.id, p])),
    porSku: new Map((inventario ?? []).map((p) => [p.sku.trim().toUpperCase(), p])),
  }), [inventario]);
  const repuesto = (f: FilaDetalle) => repuestoDeFila(f, porId, porSku);

  const filasDetalle = useMemo(() => {
    if (!detalle) return [];
    const q = busquedaDetalle.trim().toLowerCase();
    return [...detalle.filas]
      .sort((a, b) => a.fila - b.fila)
      // "Cargadas" incluye las que se cargaron con aviso: igual que el conteo del backend.
      .filter((f) => filtroDetalle === 'todas' || f.estado === filtroDetalle || (filtroDetalle === 'OK' && f.estado === 'ADVERTENCIA'))
      .filter((f) => !q || f.sku.toLowerCase().includes(q)
        || (repuestoDeFila(f, porId, porSku)?.name ?? '').toLowerCase().includes(q));
  }, [detalle, filtroDetalle, busquedaDetalle, porId, porSku]);
  const paginasDetalle = Math.max(1, Math.ceil(filasDetalle.length / FILAS_POR_PAGINA));
  const paginaActualDetalle = Math.min(paginaDetalle, paginasDetalle);
  const filasPaginaDetalle = filasDetalle.slice((paginaActualDetalle - 1) * FILAS_POR_PAGINA, paginaActualDetalle * FILAS_POR_PAGINA);
  const cuenta = (estado: FilaDetalle['estado']) => detalle?.filas.filter((f) => f.estado === estado).length ?? 0;
  const cargadas = cuenta('OK') + cuenta('ADVERTENCIA');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Historial de cargas</h3>
        <p style={{ ...TEXTO, color: 'var(--text-secondary)', margin: '0.3rem 0 0' }}>
          Todo lo que cargaste con un archivo, desde cualquier computador o desde la app.
        </p>
      </div>

      {error && (
        <p role="alert" style={{ ...TEXTO, color: 'hsl(var(--danger))', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <AlertTriangle size={16} /> {error}
        </p>
      )}
      {cargando && !historial && <p style={{ ...TEXTO, color: 'var(--text-secondary)' }}>Cargando…</p>}

      {historial && historial.content.length === 0 && (
        <div style={{ border: '1px dashed var(--border-color)', borderRadius: '14px', padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <FileText size={30} style={{ opacity: 0.6 }} />
          <p style={{ ...TEXTO, margin: '0.5rem 0 0' }}>Todavía no has cargado ningún archivo.</p>
        </div>
      )}

      {historial && historial.content.length > 0 && (
        // Sin el tope de 250 px de .log-table-container: aquí la tabla es la pantalla entera.
        <div className="log-table-container" style={{ marginTop: 0, maxHeight: 'none', overflowX: 'auto' }}>
          <table className="log-table">
            <thead>
              <tr>
                <th style={CELDA}>Fecha</th>
                <th style={CELDA}>Qué se hizo</th>
                <th style={CELDA}>Repuestos</th>
                <th style={CELDA}>Listos</th>
                <th style={CELDA}>Por corregir</th>
                <th style={CELDA}>Estado</th>
                <th style={CELDA}></th>
              </tr>
            </thead>
            <tbody>
              {historial.content.map((item) => (
                <tr key={item.id}>
                  <td style={{ ...CELDA, whiteSpace: 'nowrap' }}>
                    {new Date(item.createdAt).toLocaleDateString('es-CL')}
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {new Date(item.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>
                  <td style={CELDA}>
                    {tipoDeCarga(item.modo)}
                    {item.archivoNombre && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{item.archivoNombre}</div>}
                  </td>
                  <td style={CELDA}>{item.totalFilas}</td>
                  <td style={{ ...CELDA, color: 'hsl(var(--success))', fontWeight: 700 }}>{item.productosCargados}</td>
                  <td style={{ ...CELDA, color: item.productosConError > 0 ? 'hsl(var(--danger))' : undefined, fontWeight: 700 }}>{item.productosConError}</td>
                  <td style={CELDA}>{ESTADOS[item.estado] ?? item.estado}</td>
                  <td style={CELDA}>
                    <button type="button" className="btn btn-secondary" style={{ ...TEXTO, minHeight: '44px', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }} onClick={() => verDetalle(item.id)}>
                      <Eye size={15} /> Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {historial && historial.totalPages > 1 && (
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'center' }}>
          <button type="button" className="btn btn-secondary" style={TEXTO} onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0 || cargando}>Anterior</button>
          <span style={{ ...TEXTO, color: 'var(--text-secondary)' }}>Página {historial.currentPage + 1} de {historial.totalPages}</span>
          <button type="button" className="btn btn-secondary" style={TEXTO} onClick={() => setPagina((p) => Math.min(historial.totalPages - 1, p + 1))} disabled={pagina >= historial.totalPages - 1 || cargando}>Siguiente</button>
        </div>
      )}

      {/* A nivel de página: dentro del contenido principal la barra lateral le quedaba encima. */}
      {detalleId !== null && createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Detalle de la carga">
          <div className="modal-content historial-detalle" style={{ maxWidth: '1180px', width: '96%', maxHeight: '90vh' }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem' }}>Detalle de la carga</h3>
              <button className="btn-icon" onClick={() => setDetalleId(null)} aria-label="Cerrar detalle"><XCircle size={20} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {!detalle && <p style={{ ...TEXTO, color: 'var(--text-secondary)' }}>Cargando…</p>}
              {detalle && (
                <>
                  <p style={{ ...TEXTO, margin: 0 }}>
                    {detalle.productosCargados === 1 ? '1 repuesto quedó listo' : `${detalle.productosCargados} repuestos quedaron listos`}
                    {detalle.productosConError > 0 && (detalle.productosConError === 1 ? '; 1 no se cargó' : `; ${detalle.productosConError} no se cargaron`)}
                    {detalle.productosConAdvertencia > 0 && `; ${detalle.productosConAdvertencia} con aviso`}.
                  </p>
                  {detalle.filas.length > 0 && (
                    <div className="historial-resumen" aria-label="Resumen de la carga">
                      <span><b>{detalle.filas.length.toLocaleString('es-CL')}</b> filas en el archivo</span>
                      <span className="ok"><b>{cargadas.toLocaleString('es-CL')}</b> {cargadas === 1 ? 'cargada' : 'cargadas'}</span>
                      {cuenta('ADVERTENCIA') > 0 && <span className="aviso"><b>{cuenta('ADVERTENCIA').toLocaleString('es-CL')}</b> de ellas con aviso</span>}
                      <span className="mal"><b>{cuenta('ERROR').toLocaleString('es-CL')}</b> no se {cuenta('ERROR') === 1 ? 'cargó' : 'cargaron'}</span>
                    </div>
                  )}
                  {detalle.filas.length === 0 && (detalle.errores?.length ?? 0) > 0 && (
                    <div role="alert" style={{ ...TEXTO, color: 'hsl(var(--danger))' }}>
                      <strong>Por qué no se cargó:</strong>
                      <ul style={{ paddingLeft: '1.2rem', margin: '0.3rem 0 0' }}>
                        {detalle.errores!.map((motivo) => <li key={motivo}>{motivo}</li>)}
                      </ul>
                    </div>
                  )}
                  {detalle.filas.length > 0 && (
                    <>
                      <div className="historial-herramientas">
                        <div className="historial-filtros" role="group" aria-label="Filtrar filas de la carga">
                          {([
                            ['todas', `Todas (${detalle.filas.length})`],
                            ['OK', `Cargadas (${cargadas})`],
                            ['ADVERTENCIA', `Con aviso (${cuenta('ADVERTENCIA')})`],
                            ['ERROR', `No se cargaron (${cuenta('ERROR')})`],
                          ] as [FiltroDetalle, string][]).map(([valor, texto]) => (
                            <button
                              key={valor}
                              type="button"
                              className={filtroDetalle === valor ? 'activo' : ''}
                              aria-pressed={filtroDetalle === valor}
                              onClick={() => { setFiltroDetalle(valor); setPaginaDetalle(1); }}
                            >
                              {texto}
                            </button>
                          ))}
                        </div>
                        <label className="historial-buscador">
                          <Search size={15} />
                          <input
                            type="search"
                            placeholder="Buscar por código o nombre"
                            value={busquedaDetalle}
                            aria-label="Buscar en la carga"
                            onChange={(e) => { setBusquedaDetalle(e.target.value); setPaginaDetalle(1); }}
                          />
                        </label>
                        <span style={{ flex: 1 }} />
                        <button type="button" className="btn btn-secondary historial-boton" onClick={() => descargarResumen(detalleId, detalle.filas, repuesto)}>
                          <Download size={15} /> Descargar resumen en Excel
                        </button>
                        {conProblema.length > 0 && (
                          <button type="button" className="btn btn-secondary historial-boton" onClick={() => descargarFilasConProblema(detalleId, detalle)}>
                            <Download size={15} /> Sólo las filas por revisar
                          </button>
                        )}
                      </div>
                      <div className="historial-tabla-wrap">
                        <table className="historial-tabla" aria-label="Lo que se cargó">
                          <thead>
                            <tr>
                              <th>Fila</th>
                              <th>Código</th>
                              <th>Repuesto</th>
                              <th>Categoría</th>
                              <th>Precio</th>
                              <th>Stock</th>
                              <th>Resultado</th>
                              <th>Detalle</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filasPaginaDetalle.map((f) => {
                              const p = repuesto(f);
                              const sinNombre = f.estado === 'ERROR' ? 'No se creó' : inventario === null ? '…' : '—';
                              return (
                                <tr key={`${f.fila}-${f.sku}`} className={f.estado === 'ERROR' ? 'mal' : f.estado === 'ADVERTENCIA' ? 'aviso' : ''}>
                                  <td>{f.fila}</td>
                                  <td className="codigo">{f.sku || '—'}</td>
                                  <td className="nombre">{p?.name ?? <span className="vacio">{sinNombre}</span>}</td>
                                  <td>{p ? [p.category, p.subcategory].filter(Boolean).join(' › ') || '—' : '—'}</td>
                                  <td>{p ? (p.pricingMode === 'quote_only' ? 'A cotizar' : clp(p.price)) : '—'}</td>
                                  <td>{p ? p.stock : '—'}</td>
                                  <td>
                                    <span className={`historial-estado ${f.estado}`}>
                                      {f.estado === 'OK' ? <CheckCircle2 size={13} /> : f.estado === 'ERROR' ? <XCircle size={13} /> : <AlertTriangle size={13} />}
                                      {ETIQUETA_FILA[f.estado]}
                                    </span>
                                  </td>
                                  <td className="detalle">{f.mensajes.length ? f.mensajes.join(' ') : '—'}</td>
                                </tr>
                              );
                            })}
                            {filasPaginaDetalle.length === 0 && (
                              <tr><td colSpan={8} className="vacio historial-sin-filas">No hay filas con este filtro.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <p className="historial-nota">
                        Nombre, categoría, precio y stock son los datos <b>actuales</b> de cada repuesto en tu inventario.
                      </p>
                      {paginasDetalle > 1 && (
                        <div className="historial-paginado">
                          <button type="button" className="btn btn-secondary" onClick={() => setPaginaDetalle(paginaActualDetalle - 1)} disabled={paginaActualDetalle <= 1}>Anteriores</button>
                          <span>Página {paginaActualDetalle} de {paginasDetalle}</span>
                          <button type="button" className="btn btn-secondary" onClick={() => setPaginaDetalle(paginaActualDetalle + 1)} disabled={paginaActualDetalle >= paginasDetalle}>Siguientes</button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

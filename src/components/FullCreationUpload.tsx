import React, { useEffect, useState, useRef } from 'react';
import { UploadCloud, FileSpreadsheet, FileText, XCircle, CheckCircle2, AlertTriangle, SearchCheck, Zap, Package, RefreshCw, Download } from 'lucide-react';
import { apiFetch, SessionExpiredError, RequestTimeoutError } from '../utils/apiFetch';
import { API_BASE_URL } from '../utils/imageHelper';
import { getStoredSession } from '../utils/session';

interface FullCreationUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
  embedded?: boolean;
  onSwitchToExpress: () => void;
}

interface FilaResultado {
  fila: number;
  sku: string;
  estado: 'OK' | 'ADVERTENCIA' | 'ERROR';
  mensajes: string[];
}

interface CargaExcelResponse {
  jobId?: number | null;
  estado?: string | null;
  filasProcesadas?: number | null;
  totalFilas: number;
  productosCargados: number;
  productosConError: number;
  productosConAdvertencia: number;
  errores: string[];
  advertencias: string[];
  filas: FilaResultado[];
}

interface CargaResumen {
  id: number;
  archivoNombre: string | null;
  estado: string;
  totalFilas: number;
  productosCargados: number;
  productosConError: number;
  productosConAdvertencia: number;
  createdAt: string;
}

interface HistorialResponse {
  content: CargaResumen[];
  totalElements: number;
  totalPages: number;
  currentPage: number;
}

const POLL_INTERVAL_MS = 2000;
const JOB_ESTADOS_EN_CURSO = new Set(['PENDIENTE', 'PROCESANDO']);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getIsoTimestampString = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const ESTADO_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  COMPLETADA: { bg: 'var(--success-bg)', color: 'hsl(var(--success))', label: 'Completada' },
  CON_ERRORES: { bg: 'var(--warning-bg)', color: 'hsl(var(--warning))', label: 'Con errores' },
  ERROR: { bg: 'var(--danger-bg)', color: 'hsl(var(--danger))', label: 'Error' },
  PROCESANDO: { bg: 'rgba(99, 102, 241, 0.1)', color: 'hsl(var(--primary))', label: 'Procesando' },
  PENDIENTE: { bg: 'rgba(99, 102, 241, 0.1)', color: 'hsl(var(--primary))', label: 'Pendiente' }
};

export const FullCreationUpload: React.FC<FullCreationUploadProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
  embedded = false,
  onSwitchToExpress
}) => {
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pollingStatus, setPollingStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<CargaExcelResponse | null>(null);
  const [result, setResult] = useState<CargaExcelResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [historial, setHistorial] = useState<HistorialResponse | null>(null);
  const [historialLoading, setHistorialLoading] = useState(false);
  const [historialPage, setHistorialPage] = useState(0);
  const [historialError, setHistorialError] = useState<string | null>(null);
  const [selectedCargaId, setSelectedCargaId] = useState<number | null>(null);
  const [selectedCarga, setSelectedCarga] = useState<CargaExcelResponse | null>(null);
  const [selectedCargaLoading, setSelectedCargaLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || activeTab !== 'history') return;
    const session = getStoredSession();
    if (!session?.sellerId || !session?.token) {
      setHistorialError('Sesión requerida: no encontramos un proveedor activo.');
      return;
    }
    let cancelado = false;
    setHistorialLoading(true);
    setHistorialError(null);
    apiFetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/excel/cargas?page=${historialPage}&size=20`, {
      headers: { 'Authorization': `Bearer ${session.token}` }
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('No se pudo cargar el historial de cargas.');
        }
        const data: HistorialResponse = await response.json();
        if (!cancelado) setHistorial(data);
      })
      .catch((err) => {
        if (cancelado) return;
        setHistorialError(err instanceof Error ? err.message : 'No se pudo cargar el historial de cargas.');
      })
      .finally(() => {
        if (!cancelado) setHistorialLoading(false);
      });
    return () => { cancelado = true; };
  }, [isOpen, activeTab, historialPage]);

  if (!isOpen) return null;

  const requireSession = () => {
    const session = getStoredSession();
    if (!session?.sellerId || !session?.token) {
      setErrorMsg('Sesión requerida: no encontramos un proveedor activo.');
      return null;
    }
    return session;
  };

  const readErrorMessage = async (response: Response, fallback: string) => {
    try {
      const data = await response.json();
      return data.message || data.error || fallback;
    } catch {
      return fallback;
    }
  };

  const resetFileState = () => {
    setDataFile(null);
    setPreview(null);
    setResult(null);
    setErrorMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onFileSelected = (file: File | null) => {
    setDataFile(file);
    setPreview(null);
    setResult(null);
    setErrorMsg(null);
  };

  const downloadTemplate = async () => {
    const session = requireSession();
    if (!session) return;
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/excel/plantilla`, {
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
      if (!response.ok) {
        setErrorMsg(await readErrorMessage(response, 'No se pudo descargar la plantilla desde el servidor.'));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'plantilla-inventario-repuestop.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error al descargar plantilla:', err);
      setErrorMsg('Error al conectar con el servidor para descargar la plantilla.');
    }
  };

  const handleValidar = async () => {
    if (!dataFile) return;
    const session = requireSession();
    if (!session) return;
    setValidating(true);
    setErrorMsg(null);
    setPreview(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', dataFile);
      const response = await apiFetch(
        `${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/excel/validar`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${session.token}` }, body: formData }
      );
      if (!response.ok) {
        setErrorMsg(await readErrorMessage(response, 'No se pudo validar el archivo.'));
        return;
      }
      const data: CargaExcelResponse = await response.json();
      setPreview(data);
    } catch (err) {
      if (err instanceof SessionExpiredError || err instanceof RequestTimeoutError) {
        setErrorMsg(err.message);
      } else {
        console.error('Error al validar Excel:', err);
        setErrorMsg('Error al conectar con el servidor para validar el archivo.');
      }
    } finally {
      setValidating(false);
    }
  };

  const pollCarga = async (sellerId: string, token: string, jobId: number): Promise<CargaExcelResponse> => {
    // El backend procesa en background los archivos que superan el umbral sincrono
    // (Fase 8) y devuelve 202 con el jobId de inmediato; acá se hace polling hasta
    // que el estado deje de ser PENDIENTE/PROCESANDO.
    while (true) {
      const response = await apiFetch(
        `${API_BASE_URL}/api/v1/proveedores/${sellerId}/inventario/excel/cargas/${jobId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'No se pudo consultar el avance de la carga.'));
      }
      const data: CargaExcelResponse = await response.json();
      if (!data.estado || !JOB_ESTADOS_EN_CURSO.has(data.estado)) {
        return data;
      }
      setPollingStatus(`Procesando ${data.filasProcesadas ?? 0} de ${data.totalFilas} filas...`);
      await wait(POLL_INTERVAL_MS);
    }
  };

  const handleCargar = async () => {
    if (!dataFile) return;
    const session = requireSession();
    if (!session) return;
    setUploading(true);
    setErrorMsg(null);
    setResult(null);
    setPollingStatus(null);
    try {
      const formData = new FormData();
      formData.append('file', dataFile);
      const response = await apiFetch(
        `${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/excel/cargar`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${session.token}` }, body: formData }
      );
      if (!response.ok) {
        setErrorMsg(await readErrorMessage(response, 'No se pudo cargar el archivo.'));
        return;
      }
      let data: CargaExcelResponse = await response.json();
      if (data.jobId != null && data.estado && JOB_ESTADOS_EN_CURSO.has(data.estado)) {
        setPollingStatus(`Procesando ${data.filasProcesadas ?? 0} de ${data.totalFilas} filas...`);
        data = await pollCarga(session.sellerId, session.token, data.jobId);
      }
      setResult(data);
      setPreview(null);
      if (data.productosCargados > 0) {
        onUploadSuccess();
      }
    } catch (err) {
      if (err instanceof SessionExpiredError || err instanceof RequestTimeoutError) {
        setErrorMsg(err.message);
      } else {
        console.error('Error al cargar Excel:', err);
        setErrorMsg(err instanceof Error ? err.message : 'Error al conectar con el servidor para cargar el archivo.');
      }
    } finally {
      setUploading(false);
      setPollingStatus(null);
    }
  };

  const busy = validating || uploading;

  const verDetalleCarga = async (cargaId: number) => {
    const session = requireSession();
    if (!session) return;
    setSelectedCargaId(cargaId);
    setSelectedCarga(null);
    setSelectedCargaLoading(true);
    try {
      const response = await apiFetch(
        `${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/excel/cargas/${cargaId}`,
        { headers: { 'Authorization': `Bearer ${session.token}` } }
      );
      if (!response.ok) {
        setHistorialError(await readErrorMessage(response, 'No se pudo cargar el detalle de la carga.'));
        return;
      }
      const data: CargaExcelResponse = await response.json();
      setSelectedCarga(data);
    } catch (err) {
      setHistorialError(err instanceof Error ? err.message : 'No se pudo cargar el detalle de la carga.');
    } finally {
      setSelectedCargaLoading(false);
    }
  };

  const cerrarDetalleCarga = () => {
    setSelectedCargaId(null);
    setSelectedCarga(null);
  };

  const exportarErrores = async (data: CargaExcelResponse) => {
    const filasConError = data.filas.filter((f) => f.estado === 'ERROR');
    if (filasConError.length === 0) return;

    const exportData = filasConError.map((f) => ({
      'Fila': f.fila,
      'SKU': f.sku,
      'Estado': 'FALLIDO',
      'Motivo del Error': f.mensajes.join(' | ')
    }));

    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Errores_Carga');
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Reporte_Errores_Carga_Masiva_${getIsoTimestampString()}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const renderResumen = (data: CargaExcelResponse, titulo: string, permitirExportarErrores = false) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h4 style={{ fontSize: '0.9rem', fontWeight: 700 }}>{titulo}</h4>
        {permitirExportarErrores && data.productosConError > 0 && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            onClick={() => exportarErrores(data)}
          >
            <Download size={13} />
            Exportar errores a Excel
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span className="log-status-badge" style={{ backgroundColor: 'var(--success-bg)', color: 'hsl(var(--success))', padding: '0.3rem 0.6rem' }}>
          <CheckCircle2 size={13} /> {data.productosCargados} OK
        </span>
        {data.productosConAdvertencia > 0 && (
          <span className="log-status-badge" style={{ backgroundColor: 'var(--warning-bg)', color: 'hsl(var(--warning))', padding: '0.3rem 0.6rem' }}>
            <AlertTriangle size={13} /> {data.productosConAdvertencia} con advertencia
          </span>
        )}
        {data.productosConError > 0 && (
          <span className="log-status-badge" style={{ backgroundColor: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.3rem 0.6rem' }}>
            <XCircle size={13} /> {data.productosConError} con error
          </span>
        )}
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', alignSelf: 'center' }}>
          {data.totalFilas} filas totales
        </span>
      </div>

      {data.filas.length > 0 && (
        <div className="log-table-container" style={{ marginTop: 0 }}>
          <table className="log-table">
            <thead>
              <tr>
                <th style={{ padding: '0.5rem 0.65rem', fontSize: '0.7rem' }}>Fila</th>
                <th style={{ padding: '0.5rem 0.65rem', fontSize: '0.7rem' }}>SKU</th>
                <th style={{ padding: '0.5rem 0.65rem', fontSize: '0.7rem' }}>Estado</th>
                <th style={{ padding: '0.5rem 0.65rem', fontSize: '0.7rem' }}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {data.filas.map((fila) => (
                <tr key={fila.fila}>
                  <td style={{ padding: '0.5rem 0.65rem', fontSize: '0.76rem' }}>{fila.fila}</td>
                  <td style={{ padding: '0.5rem 0.65rem', fontSize: '0.76rem', fontWeight: 700 }}>{fila.sku}</td>
                  <td style={{ padding: '0.5rem 0.65rem' }}>
                    {fila.estado === 'OK' && (
                      <span className="log-status-badge" style={{ backgroundColor: 'var(--success-bg)', color: 'hsl(var(--success))', padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}>OK</span>
                    )}
                    {fila.estado === 'ADVERTENCIA' && (
                      <span className="log-status-badge" style={{ backgroundColor: 'var(--warning-bg)', color: 'hsl(var(--warning))', padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}>Advertencia</span>
                    )}
                    {fila.estado === 'ERROR' && (
                      <span className="log-status-badge" style={{ backgroundColor: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}>Error</span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem 0.65rem', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                    {fila.mensajes.join(' — ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderHistorial = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '420px' }}>
      <div>
        <h3 style={{ fontSize: '1.05rem', margin: 0 }}>Historial de cargas</h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
          Cargas de Publicación Completa hechas desde cualquier dispositivo.
        </p>
      </div>

      {historialError && (
        <div style={{ background: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.65rem 0.85rem', borderRadius: '10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={15} />
          {historialError}
        </div>
      )}

      {historialLoading && !historial && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Cargando historial…</p>
      )}

      {historial && historial.content.length === 0 && (
        <div style={{ border: '1px dashed var(--border-color)', borderRadius: '14px', minHeight: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
          <div>
            <FileText size={34} style={{ marginBottom: '0.65rem', opacity: 0.6 }} />
            <p style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Aún no hay cargas registradas</p>
            <p style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Cuando completes una carga masiva, aparecerá aquí.</p>
          </div>
        </div>
      )}

      {historial && historial.content.length > 0 && (
        <>
          <div className="log-table-container" style={{ marginTop: 0 }}>
            <table className="log-table">
              <thead>
                <tr>
                  <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>ID carga</th>
                  <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Archivo</th>
                  <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Fecha</th>
                  <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Registros</th>
                  <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Éxito</th>
                  <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Fallidos</th>
                  <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Estado</th>
                  <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {historial.content.map((item) => {
                  const badge = ESTADO_BADGE[item.estado] ?? { bg: 'var(--border-color)', color: 'var(--text-secondary)', label: item.estado };
                  return (
                    <tr key={item.id}>
                      <td style={{ padding: '0.65rem 0.75rem' }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 700 }}>{item.id}</code>
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{item.archivoNombre ?? '—'}</td>
                      <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {new Date(item.createdAt).toLocaleString('es-CL')}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', fontWeight: 700 }}>{item.totalFilas}</td>
                      <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', color: 'hsl(var(--success))', fontWeight: 800 }}>{item.productosCargados}</td>
                      <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', color: 'hsl(var(--danger))', fontWeight: 800 }}>{item.productosConError}</td>
                      <td style={{ padding: '0.65rem 0.75rem' }}>
                        <span className="log-status-badge" style={{ backgroundColor: badge.bg, color: badge.color, padding: '0.2rem 0.45rem', fontSize: '0.66rem' }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem' }}>
                        <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.55rem', fontSize: '0.72rem' }} onClick={() => verDetalleCarga(item.id)}>
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {historial.totalPages > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                onClick={() => setHistorialPage((p) => Math.max(0, p - 1))}
                disabled={historialPage === 0 || historialLoading}
              >
                Anterior
              </button>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Página {historial.currentPage + 1} de {historial.totalPages}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                onClick={() => setHistorialPage((p) => Math.min(historial.totalPages - 1, p + 1))}
                disabled={historialPage >= historial.totalPages - 1 || historialLoading}
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}

      {selectedCargaId !== null && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Detalle de carga">
          <div className="modal-content" style={{ maxWidth: '900px', width: '95%', maxHeight: '85vh' }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.05rem' }}>Detalle de la carga #{selectedCargaId}</h3>
              <button className="btn-icon" onClick={cerrarDetalleCarga} aria-label="Cerrar detalle de carga"><XCircle size={19} /></button>
            </div>
            <div className="modal-body">
              {selectedCargaLoading && <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Cargando detalle…</p>}
              {!selectedCargaLoading && selectedCarga && renderResumen(selectedCarga, 'Detalle de la carga', true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={embedded ? 'bulk-upload-page' : 'modal-overlay'}>
      <div
        className={embedded ? 'bulk-upload-page-content' : 'modal-content'}
        style={embedded
          ? { width: '100%', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 118px)' }
          : { maxWidth: '1000px', width: '95%', maxHeight: '92vh' }
        }
      >
        <div className="modal-header">
          <div>
            <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UploadCloud size={20} style={{ color: 'hsl(var(--primary))' }} />
              Cargar Inventario Masivo
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Sube un Excel con la plantilla oficial. Los productos se crean con una foto genérica hasta que edites cada uno con su foto real.
            </p>
          </div>
          {!embedded && (
            <button className="btn-icon" onClick={onClose} disabled={busy} aria-label="Cerrar carga masiva">
              <XCircle size={20} />
            </button>
          )}
        </div>

        <div className="bulk-upload-tabs">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            style={{
              border: 'none',
              borderBottom: activeTab === 'upload' ? '3px solid hsl(var(--primary))' : '3px solid transparent',
              background: 'transparent',
              color: activeTab === 'upload' ? 'hsl(var(--primary))' : 'var(--text-secondary)',
              fontWeight: 800,
              fontSize: '0.82rem',
              padding: '0.65rem 0.85rem',
              cursor: 'pointer'
            }}
          >
            Nueva carga
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            style={{
              border: 'none',
              borderBottom: activeTab === 'history' ? '3px solid hsl(var(--primary))' : '3px solid transparent',
              background: 'transparent',
              color: activeTab === 'history' ? 'hsl(var(--primary))' : 'var(--text-secondary)',
              fontWeight: 800,
              fontSize: '0.82rem',
              padding: '0.65rem 0.85rem',
              cursor: 'pointer'
            }}
          >
            Historial de cargas
          </button>
        </div>

        <div className="modal-body">
          {activeTab === 'history' ? (
            renderHistorial()
          ) : (
            <>
              <div className="bulk-mode-selector" style={{ marginBottom: '1rem' }}>
                <button type="button" className="bulk-mode-tab active-full" disabled>
                  <Package size={15} />
                  <span>Publicación Completa</span>
                </button>
                <button type="button" className="bulk-mode-tab" onClick={onSwitchToExpress} disabled={busy}>
                  <Zap size={15} />
                  <span>Actualización Rápida</span>
                </button>
              </div>

              {errorMsg && (
                <div style={{ background: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.65rem 0.85rem', borderRadius: '10px', fontSize: '0.8rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={15} />
                  {errorMsg}
                </div>
              )}

              <div style={{
                background: 'rgba(99, 102, 241, 0.04)',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                marginBottom: '1rem'
              }}>
                <h4 style={{ fontSize: '0.825rem', fontWeight: 700 }}>Plantilla Oficial</h4>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  Plantilla oficial del sistema, con desplegables de categoría, subcategoría, marcas y vehículos.
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.4rem 0.65rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', width: 'fit-content' }}
                  onClick={downloadTemplate}
                  disabled={busy}
                >
                  <FileSpreadsheet size={13} style={{ color: '#107c41' }} />
                  Descargar Excel
                </button>
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className={`dropzone compact ${dataFile ? 'active' : ''}`}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    style={{ display: 'none' }}
                    disabled={busy}
                    onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
                  />
                  <FileSpreadsheet size={24} className="dropzone-icon" />
                  <span className="dropzone-title">{dataFile ? dataFile.name : 'Fila Productos'}</span>
                  <span className="dropzone-desc">{dataFile ? 'Archivo listo' : 'Arrastra o sube tu plantilla'}</span>
                </label>
              </div>

              {dataFile && (
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary" onClick={handleValidar} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <SearchCheck size={15} />
                    {validating ? 'Validando…' : 'Validar sin guardar'}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleCargar} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <UploadCloud size={15} />
                    {uploading ? (pollingStatus ?? 'Cargando…') : 'Cargar inventario'}
                  </button>
                  <button type="button" className="btn-icon" onClick={resetFileState} disabled={busy} aria-label="Quitar archivo" title="Quitar archivo">
                    <RefreshCw size={15} />
                  </button>
                </div>
              )}

              {uploading && pollingStatus && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>{pollingStatus}</p>
              )}

              {preview && renderResumen(preview, 'Vista previa (nada se guardó todavía)')}
              {result && renderResumen(result, result.productosConError > 0 ? 'Carga finalizada con errores' : 'Carga finalizada', true)}

              {!preview && !result && !errorMsg && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <FileText size={13} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />
                  Puedes validar el archivo antes de cargarlo para revisar errores sin crear ningún producto.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

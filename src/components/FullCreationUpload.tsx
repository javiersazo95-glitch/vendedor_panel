import React, { useEffect, useMemo, useState, useRef } from 'react';
import { UploadCloud, FileSpreadsheet, FileText, XCircle, CheckCircle2, AlertTriangle, Zap, Package, RefreshCw, Download, ImageUp, FolderOpen, Play, X, Lock, Eye, Wand2 } from 'lucide-react';
import { apiFetch, SessionExpiredError, RequestTimeoutError } from '../utils/apiFetch';
import { API_BASE_URL } from '../utils/imageHelper';
import { getStoredSession } from '../utils/session';
import { PlantillaMapper } from './PlantillaMapper';
import { useEsquemaPlantilla } from '../utils/plantillaEsquema';
import { descargarFotos, esUrlDeImagen } from '../utils/plantillaFotos';

const MAX_IMAGES_PER_PRODUCT = 4;
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const PHOTO_UPLOAD_BATCH_SIZE = 12;

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
  productoId?: number | null;
}

interface FotoUploadResultado {
  sku: string;
  ok: boolean;
  mensaje?: string;
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

const MENSAJE_SKU_DUPLICADO = 'SKU repetido dentro de la misma plantilla: ya hay otra fila válida con este mismo SKU, así que esta no se cargaría.';

/**
 * El dry-run del backend (`/excel/validar`) no puede detectar SKUs duplicados dentro del
 * mismo archivo: cada fila corre en su propia transaccion que se revierte al terminar
 * (Fase 7/11), asi que una fila nunca ve lo que "creo" otra fila de la misma simulacion.
 * Ese hueco se tapa aca comparando texto plano (no es una regla de negocio, es solo
 * "¿este SKU ya aparecio antes en la lista?") -- la primera aparicion de un SKU se deja
 * como vino del backend, y cualquier aparicion siguiente se fuerza a ERROR, replicando
 * exactamente lo que pasaria en la carga real (la primera fila crea el producto, la
 * segunda choca contra "Ya existe un producto con ese SKU para el proveedor").
 */
function marcarSkuDuplicados(data: CargaExcelResponse): CargaExcelResponse {
  const vistos = new Set<string>();
  const filas = data.filas.map((fila) => {
    if (fila.estado === 'ERROR') return fila;
    const clave = fila.sku.trim().toUpperCase();
    if (clave && vistos.has(clave)) {
      return { ...fila, estado: 'ERROR' as const, mensajes: [MENSAJE_SKU_DUPLICADO] };
    }
    if (clave) vistos.add(clave);
    return fila;
  });
  return recalcularAgregados(data, filas);
}

/** Recalcula los totales (mismo criterio que CargaInventarioExcelResponseDTO.desdeFilas en
 * el backend: las filas con advertencia cuentan como cargadas ademas de contarse aparte). */
function recalcularAgregados(base: CargaExcelResponse, filas: FilaResultado[]): CargaExcelResponse {
  const productosConAdvertencia = filas.filter((f) => f.estado === 'ADVERTENCIA').length;
  const productosConError = filas.filter((f) => f.estado === 'ERROR').length;
  const productosCargados = filas.filter((f) => f.estado === 'OK' || f.estado === 'ADVERTENCIA').length;
  return { ...base, filas, productosCargados, productosConAdvertencia, productosConError };
}

/**
 * Reconstruye el Excel original dejando solo las filas indicadas (las que pasaron el
 * analisis), preservando el orden y el contenido tal cual, mas la hoja opcional
 * "compatibilidades" filtrada a los SKUs que sobreviven. Es el mismo mecanismo que ya usa
 * exportarErrores() para reconstruir un Excel con datos reales, aplicado al revés: en vez
 * de quedarse con los errores, se queda con lo valido para no reenviar filas que ya
 * sabemos que van a fallar.
 */
async function construirExcelSoloValidos(dataFile: File, filasASubir: number[]): Promise<File> {
  const XLSX = await import('xlsx');
  const buffer = await dataFile.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const mainSheetName = workbook.SheetNames[0];
  const mainSheet = workbook.Sheets[mainSheetName];
  const mainRows = XLSX.utils.sheet_to_json<unknown[]>(mainSheet, { header: 1, defval: '' });
  const headerRow = (mainRows[0] as unknown[]) ?? [];
  const filasASubirSet = new Set(filasASubir);
  const filasValidas = mainRows.filter((_, index) => filasASubirSet.has(index + 1));

  const nuevoWorkbook = XLSX.utils.book_new();
  const nuevaHojaPrincipal = XLSX.utils.aoa_to_sheet([headerRow, ...filasValidas]);
  XLSX.utils.book_append_sheet(nuevoWorkbook, nuevaHojaPrincipal, mainSheetName || 'inventario');

  const compatSheet = workbook.Sheets['compatibilidades'];
  if (compatSheet) {
    const skuColIndex = (headerRow as string[]).indexOf('sku_proveedor');
    const skusValidos = new Set(
      filasValidas.map((row) => String((row as unknown[])[skuColIndex] ?? '').trim().toUpperCase())
    );
    const compatRows = XLSX.utils.sheet_to_json<unknown[]>(compatSheet, { header: 1, defval: '' });
    const compatHeader = (compatRows[0] as unknown[]) ?? [];
    const compatSkuIndex = 0; // sku_proveedor es siempre la primera columna de esta hoja
    const compatFiltradas = compatRows
      .slice(1)
      .filter((row) => skusValidos.has(String((row as unknown[])[compatSkuIndex] ?? '').trim().toUpperCase()));
    const nuevaHojaCompat = XLSX.utils.aoa_to_sheet([compatHeader, ...compatFiltradas]);
    XLSX.utils.book_append_sheet(nuevoWorkbook, nuevaHojaCompat, 'compatibilidades');
  }

  const wbout = XLSX.write(nuevoWorkbook, { bookType: 'xlsx', type: 'array' });
  return new File([wbout], dataFile.name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

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
  // Flujo "Adaptar mi plantilla": el vendedor mapea su propio Excel y genera el archivo
  // oficial en memoria, que luego entra al mismo dry-run / carga.
  const [showMapper, setShowMapper] = useState(false);
  const [dataFromMapper, setDataFromMapper] = useState(false);
  const [validating, setValidating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionProgress, setActionProgress] = useState(0);
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

  // ---- Fase 15: fotos masivas (Fase B, despues de que el Excel ya creo los productos) ----
  const [photoZipFile, setPhotoZipFile] = useState<File | null>(null);
  const [photoFolderCount, setPhotoFolderCount] = useState(0);
  const [availableImages, setAvailableImages] = useState<Record<string, File | Blob>>({});
  const [imageAssignments, setImageAssignments] = useState<Record<string, string[]>>({});
  const [gallerySkuOpen, setGallerySkuOpen] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadProgress, setPhotoUploadProgress] = useState<number | null>(null);
  const [photoUploadResults, setPhotoUploadResults] = useState<FotoUploadResultado[] | null>(null);
  const [photoErrorMsg, setPhotoErrorMsg] = useState<string | null>(null);
  const photoFolderInputRef = useRef<HTMLInputElement>(null);
  const photoZipInputRef = useRef<HTMLInputElement>(null);
  const [productInfoBySku, setProductInfoBySku] = useState<Record<string, { nombre: string; categoria: string }>>({});
  // Fotos que el vendedor declaro en su propio Excel (URL o nombre de archivo), por SKU.
  // No viajan en el archivo oficial: son el insumo de esta fase B.
  const [fotosDeclaradas, setFotosDeclaradas] = useState<Record<string, string[]> | null>(null);
  const [descargandoFotos, setDescargandoFotos] = useState<{ hechas: number; total: number } | null>(null);
  const [fotosNoTraidas, setFotosNoTraidas] = useState<{ sku: string; url: string; motivo: string }[]>([]);
  // Evita que la subida automatica de fotos (ver efecto mas abajo) se dispare mas de una
  // vez para el mismo resultado de carga.
  const autoPhotoUploadRef = useRef(false);
  // Distingue "se acaba de calcular el emparejamiento automatico por SKU" (debe subir
  // solo) de "el vendedor toco 'Elegir fotos' y selecciono una imagen a mano" (NO debe
  // subir solo -- puede estar eligiendo varias, subir en el primer clic le corta el paso).
  const pendingAutoUploadRef = useRef(false);
  // Evita volver a disparar la descarga automatica del Excel de errores para el mismo
  // resultado (ver efecto mas abajo, junto a exportarErrores).
  const autoErrorDownloadRef = useRef(false);

  // El contrato de la plantilla (columnas, obligatorias, catalogos y version) se pide al
  // backend al abrir la carga masiva. Si no responde se sigue con el contrato de respaldo
  // del panel: un endpoint caido no puede dejar al vendedor sin poder preparar su archivo.
  const { esquema } = useEsquemaPlantilla(isOpen);



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
    apiFetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/excel/cargas?page=${historialPage}&size=20&modo=FULL_CREATION`, {
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

  // Filas que crearon o actualizaron un producto real (con productoId): son las unicas
  // candidatas a recibir foto. simulacion (preview) nunca trae productoId (Fase 15,
  // backend): la pantalla de fotos solo tiene sentido despues de una carga real.
  const filasConProducto = (result?.filas ?? []).filter(
    (f) => f.estado !== 'ERROR' && f.productoId != null
  );

  const imageObjectUrls = useMemo(() => {
    const urls: Record<string, string> = {};
    Object.entries(availableImages).forEach(([filename, file]) => {
      urls[filename] = URL.createObjectURL(file);
    });
    return urls;
  }, [availableImages]);

  useEffect(() => {
    return () => {
      Object.values(imageObjectUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imageObjectUrls]);

  /**
   * Matching por nombre de archivo = SKU (Fase 15): la plantilla oficial no tiene columna
   * de imagen, asi que en vez de que el vendedor la complete a mano, el nombre del archivo
   * hace de llave. Se permite un sufijo (SKU-123_1.jpg, SKU-123-2.jpg) para declarar mas de
   * una foto por producto sin que el vendedor tenga que inventar un nombre distinto.
   */
  const matchesSku = (filenameLower: string, sku: string) => {
    const base = filenameLower.replace(/\.[^.]+$/, '');
    const skuLower = sku.trim().toLowerCase();
    if (base === skuLower) return true;
    return base.startsWith(skuLower + '_') || base.startsWith(skuLower + '-') || base.startsWith(skuLower + ' ');
  };

  /**
   * Nombres de archivo que el vendedor declaro en su Excel para este SKU, cuando existen
   * de verdad entre las fotos que subio. Manda sobre el emparejamiento por nombre = SKU:
   * si el vendedor se tomo el trabajo de decir cual es la foto, esa es.
   */
  const declaradasParaSku = (sku: string, filenames: string[]): string[] => {
    const declaradas = fotosDeclaradas?.[sku] ?? [];
    return declaradas
      .filter((d) => !esUrlDeImagen(d))
      .map((d) => {
        const nombre = d.split(/[\\/]/).pop()?.trim().toLowerCase() ?? '';
        return filenames.find((f) => f.toLowerCase() === nombre);
      })
      .filter((f): f is string => !!f);
  };

  const computeAutoMatches = (skus: string[]): Record<string, string[]> => {
    const filenames = Object.keys(availableImages);
    const assignments: Record<string, string[]> = {};
    skus.forEach((sku) => {
      const declaradas = declaradasParaSku(sku, filenames);
      const matches = (declaradas.length > 0 ? declaradas : filenames.filter((f) => matchesSku(f, sku)))
        .sort()
        .slice(0, MAX_IMAGES_PER_PRODUCT);
      if (matches.length > 0) {
        assignments[sku] = matches;
      }
    });
    return assignments;
  };

  /**
   * FilaCargaResultadoDTO (lo que devuelve el backend) solo trae fila/sku/estado/mensajes:
   * no hay nombre ni categoria del producto. Para no pegarle al backend de nuevo por cada
   * SKU, se lee el mismo archivo que ya esta en memoria (dataFile) y se arma un diccionario
   * sku -> {nombre, categoria} en el cliente, solo para mostrarlo en la tabla de fotos.
   */
  useEffect(() => {
    if (!result || !dataFile) {
      setProductInfoBySku({});
      return;
    }
    let cancelado = false;
    (async () => {
      try {
        const XLSX = await import('xlsx');
        const buffer = await dataFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
        const headerRow = (rows[0] as string[] | undefined) ?? [];
        const idxNombre = headerRow.indexOf('nombre_publicado');
        const idxCategoria = headerRow.indexOf('categoria');
        const idxSku = headerRow.indexOf('sku_proveedor');
        if (idxSku === -1) return;
        const map: Record<string, { nombre: string; categoria: string }> = {};
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] as unknown[];
          const sku = String(row?.[idxSku] ?? '').trim();
          if (!sku) continue;
          map[sku] = {
            nombre: idxNombre >= 0 ? String(row?.[idxNombre] ?? '') : '',
            categoria: idxCategoria >= 0 ? String(row?.[idxCategoria] ?? '') : ''
          };
        }
        if (!cancelado) setProductInfoBySku(map);
      } catch (err) {
        console.error('No se pudo leer el archivo original para mostrar nombre/categoria:', err);
      }
    })();
    return () => { cancelado = true; };
  }, [result, dataFile]);

  useEffect(() => {
    if (!result || Object.keys(availableImages).length === 0) return;
    const skus = filasConProducto.map((f) => f.sku);
    setImageAssignments((prev) => {
      // No pisa asignaciones manuales que el vendedor ya haya hecho para esta misma carga.
      if (Object.keys(prev).length > 0) return prev;
      const matches = computeAutoMatches(skus);
      if (Object.keys(matches).length > 0) {
        pendingAutoUploadRef.current = true;
      }
      return matches;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, availableImages]);

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
    setShowMapper(false);
    setDataFromMapper(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    resetPhotoState();
  };

  const handleMappedFileGenerated = (file: File, fotos?: Record<string, string[]>) => {
    onFileSelected(file);
    setDataFromMapper(true);
    setShowMapper(false);
    // onFileSelected limpia el estado de fotos, asi que las declaradas se guardan despues.
    setFotosDeclaradas(fotos ?? null);
  };

  const onFileSelected = (file: File | null) => {
    // Si el navegador re-dispara onChange sobre el MISMO archivo (pasa al re-abrir el
    // dialogo y volver a elegirlo, aunque no haya cambiado nada), no hay que perder las
    // fotos que el vendedor ya selecciono para ese Excel -- solo se limpian cuando el
    // archivo de datos realmente cambia.
    const esMismoArchivo = file && dataFile && file.name === dataFile.name && file.size === dataFile.size;
    setDataFile(file);
    setPreview(null);
    setResult(null);
    setErrorMsg(null);
    setDataFromMapper(false);
    if (!esMismoArchivo) {
      resetPhotoState();
    }
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
      link.download = `plantilla-inventario-repuestop_${getIsoTimestampString()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error al descargar plantilla:', err);
      setErrorMsg('Error al conectar con el servidor para descargar la plantilla.');
    }
  };

  /**
   * Primer clic del flujo ("Analizar Carga"): corre el dry-run real del backend y le
   * suma el chequeo de SKU duplicado que el backend no puede hacer solo. No crea nada
   * todavia -- es el mismo rol que cumplia "Validar sin guardar" antes, ahora es el unico
   * primer paso (ya no hay dos botones para elegir).
   */
  const handleAnalizar = async () => {
    if (!dataFile) return;
    const session = requireSession();
    if (!session) return;
    setValidating(true);
    setActionProgress(8);
    setErrorMsg(null);
    setPreview(null);
    setResult(null);

    // Incremento gradual y realista mientras el backend procesa las filas
    const progressInterval = setInterval(() => {
      setActionProgress((prev) => {
        if (prev < 40) return prev + Math.floor(Math.random() * 8 + 5);
        if (prev < 75) return prev + Math.floor(Math.random() * 5 + 3);
        if (prev < 92) return prev + 2;
        return prev;
      });
    }, 180);

    try {
      const formData = new FormData();
      formData.append('file', dataFile);
      const response = await apiFetch(
        `${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/excel/validar`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${session.token}` }, body: formData }
      );
      clearInterval(progressInterval);
      if (!response.ok) {
        setActionProgress(0);
        setErrorMsg(await readErrorMessage(response, 'No se pudo analizar el archivo.'));
        return;
      }
      setActionProgress(100);
      const data: CargaExcelResponse = await response.json();
      setPreview(marcarSkuDuplicados(data));
    } catch (err) {
      clearInterval(progressInterval);
      setActionProgress(0);
      if (err instanceof SessionExpiredError || err instanceof RequestTimeoutError) {
        setErrorMsg(err.message);
      } else {
        console.error('Error al analizar Excel:', err);
        setErrorMsg('Error al conectar con el servidor para analizar el archivo.');
      }
    } finally {
      clearInterval(progressInterval);
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
      if (data.totalFilas > 0 && data.filasProcesadas != null) {
        const pct = Math.min(95, Math.max(10, Math.round((data.filasProcesadas / data.totalFilas) * 100)));
        setActionProgress(pct);
      }
      setPollingStatus(`Procesando ${data.filasProcesadas ?? 0} de ${data.totalFilas} filas...`);
      await wait(POLL_INTERVAL_MS);
    }
  };

  /**
   * Segundo clic del flujo ("Iniciar Carga"): manda solo las filas validas (OK +
   * ADVERTENCIA) del analisis. Si hubo filas excluidas, reconstruye un Excel nuevo con
   * unicamente esas filas -- el backend no tiene forma de "saltarse" filas de un archivo,
   * asi que la exclusion se hace en el cliente antes de mandar el request.
   */
  const handleIniciarCarga = async () => {
    if (!dataFile || !preview) return;
    const session = requireSession();
    if (!session) return;

    const filasExcluidas = preview.filas.filter((f) => f.estado === 'ERROR');
    const filasASubir = preview.filas.filter((f) => f.estado !== 'ERROR');
    if (filasASubir.length === 0) {
      setErrorMsg('No hay filas válidas para cargar. Corrige el Excel y vuelve a analizarlo.');
      return;
    }

    setUploading(true);
    setActionProgress(10);
    setErrorMsg(null);
    setResult(null);
    setPollingStatus(null);

    const uploadProgressInterval = setInterval(() => {
      setActionProgress((prev) => {
        if (prev < 45) return prev + Math.floor(Math.random() * 7 + 4);
        if (prev < 85) return prev + Math.floor(Math.random() * 4 + 2);
        return prev;
      });
    }, 200);

    try {
      const archivoASubir = filasExcluidas.length === 0
        ? dataFile
        : await construirExcelSoloValidos(dataFile, filasASubir.map((f) => f.fila));

      const formData = new FormData();
      formData.append('file', archivoASubir);
      const response = await apiFetch(
        `${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/excel/cargar`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${session.token}` }, body: formData }
      );
      clearInterval(uploadProgressInterval);
      if (!response.ok) {
        setActionProgress(0);
        setErrorMsg(await readErrorMessage(response, 'No se pudo cargar el archivo.'));
        return;
      }
      let data: CargaExcelResponse = await response.json();
      if (data.jobId != null && data.estado && JOB_ESTADOS_EN_CURSO.has(data.estado)) {
        setPollingStatus(`Procesando ${data.filasProcesadas ?? 0} de ${data.totalFilas} filas...`);
        data = await pollCarga(session.sellerId, session.token, data.jobId);
      }
      setActionProgress(100);

      // Si se mando un subconjunto, el "fila" que devuelve el backend es relativo a ESE
      // archivo, no al original -- se remapea por posicion (el orden se preserva de punta
      // a punta) antes de mezclar con las filas que se excluyeron de entrada, para que el
      // vendedor siga viendo la numeracion de fila de su Excel original.
      const filasRemapeadas = filasExcluidas.length === 0
        ? data.filas
        : data.filas.map((fila, index) => ({ ...fila, fila: filasASubir[index]?.fila ?? fila.fila }));

      const filasFinal = [...filasRemapeadas, ...filasExcluidas].sort((a, b) => a.fila - b.fila);
      const resultadoFinal = recalcularAgregados({ ...data, totalFilas: preview.totalFilas }, filasFinal);

      setResult(resultadoFinal);
      setPreview(null);
      if (resultadoFinal.productosCargados > 0) {
        onUploadSuccess();
      }
    } catch (err) {
      clearInterval(uploadProgressInterval);
      setActionProgress(0);
      if (err instanceof SessionExpiredError || err instanceof RequestTimeoutError) {
        setErrorMsg(err.message);
      } else {
        console.error('Error al cargar Excel:', err);
        setErrorMsg(err instanceof Error ? err.message : 'Error al conectar con el servidor para cargar el archivo.');
      }
    } finally {
      clearInterval(uploadProgressInterval);
      setUploading(false);
      setPollingStatus(null);
    }
  };

  // Filas que crearon o actualizaron un producto real (con productoId): son las unicas
  // candidatas a recibir foto. simulacion (preview) nunca trae productoId (Fase 15,
  // backend): esta pantalla de fotos solo tiene sentido despues de una carga real.
  const mimeTypeForExtension = (ext: string): string => {
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    return 'application/octet-stream';
  };

  /**
   * El formato ZIP no guarda el Content-Type de sus archivos, y JSZip tampoco lo infiere:
   * fileObj.async('blob') devuelve un Blob con type='' salvo que se lo indiques. Sin esto,
   * el navegador manda cada foto como application/octet-stream en el multipart, y el
   * backend las rechaza ("Solo se permiten imagenes de producto",
   * InventarioImagenSupport.validarImagen) aunque el contenido sea una imagen real.
   */
  const extractZipImages = async (zipFile: File): Promise<Record<string, Blob>> => {
    const imageFilesMap: Record<string, Blob> = {};
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const contents = await zip.loadAsync(zipFile);
    for (const [filename, fileObj] of Object.entries(contents.files)) {
      if (!fileObj.dir) {
        const ext = filename.split('.').pop()?.toLowerCase();
        if (ext && IMAGE_EXTENSIONS.includes(ext)) {
          const arrayBuffer = await fileObj.async('arraybuffer');
          const blob = new Blob([arrayBuffer], { type: mimeTypeForExtension(ext) });
          const cleanName = filename.split('/').pop() || filename;
          imageFilesMap[cleanName.toLowerCase()] = blob;
        }
      }
    }
    return imageFilesMap;
  };

  const extractFolderImages = (files: FileList): Record<string, File> => {
    const imageFilesMap: Record<string, File> = {};
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && IMAGE_EXTENSIONS.includes(ext)) {
        imageFilesMap[file.name.toLowerCase()] = file;
      }
    }
    return imageFilesMap;
  };

  const onPhotoFolderSelected = (files: FileList | null) => {
    setPhotoErrorMsg(null);
    setPhotoZipFile(null);
    if (!files || files.length === 0) {
      setPhotoFolderCount(0);
      setAvailableImages({});
      return;
    }
    const map = extractFolderImages(files);
    setPhotoFolderCount(Object.keys(map).length);
    setAvailableImages(map);
    setImageAssignments({});
    setPhotoUploadResults(null);
  };

  const onPhotoZipSelected = async (file: File | null) => {
    setPhotoErrorMsg(null);
    setPhotoFolderCount(0);
    setPhotoZipFile(file);
    if (!file) {
      setAvailableImages({});
      return;
    }
    try {
      const map = await extractZipImages(file);
      setAvailableImages(map);
      setImageAssignments({});
      setPhotoUploadResults(null);
    } catch (err) {
      console.error('Error al leer el ZIP de fotos:', err);
      setPhotoErrorMsg('No se pudo leer el archivo ZIP. Revisa que no esté dañado.');
    }
  };

  const toggleImageSelection = (sku: string, filename: string) => {
    setImageAssignments((prev) => {
      const current = prev[sku] || [];
      if (current.includes(filename)) {
        return { ...prev, [sku]: current.filter((f) => f !== filename) };
      }
      if (current.length >= MAX_IMAGES_PER_PRODUCT) return prev;
      return { ...prev, [sku]: [...current, filename] };
    });
  };

  const resetPhotoState = () => {
    setPhotoZipFile(null);
    setPhotoFolderCount(0);
    setAvailableImages({});
    setImageAssignments({});
    setPhotoUploadResults(null);
    setPhotoErrorMsg(null);
    setDescargandoFotos(null);
    setFotosNoTraidas([]);
    if (photoFolderInputRef.current) photoFolderInputRef.current.value = '';
    if (photoZipInputRef.current) photoZipInputRef.current.value = '';
  };

  /** URLs de foto declaradas en el Excel para los productos que si se cargaron. */
  const urlsDeclaradasPendientes = useMemo(() => {
    if (!fotosDeclaradas || !result) return {} as Record<string, string[]>;
    const pendientes: Record<string, string[]> = {};
    for (const fila of filasConProducto) {
      const urls = (fotosDeclaradas[fila.sku] ?? []).filter(esUrlDeImagen);
      if (urls.length > 0 && (imageAssignments[fila.sku] ?? []).length === 0) pendientes[fila.sku] = urls;
    }
    return pendientes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fotosDeclaradas, result, imageAssignments]);

  /**
   * Trae las fotos que el vendedor declaro como enlace en su Excel. Se bajan desde SU
   * navegador y no desde el servidor: que el backend descargue URLs escritas por un
   * vendedor seria pedirle que consulte cualquier direccion, incluidas las internas.
   */
  const traerFotosDeclaradas = async () => {
    const pendientes = urlsDeclaradasPendientes;
    const total = Object.values(pendientes).reduce((n, urls) => n + urls.length, 0);
    if (total === 0) return;
    setPhotoErrorMsg(null);
    setDescargandoFotos({ hechas: 0, total });
    try {
      const { archivos, asignaciones, fallidas } = await descargarFotos(
        pendientes,
        (hechas) => setDescargandoFotos({ hechas, total }),
      );
      setAvailableImages((prev) => ({ ...prev, ...archivos }));
      setImageAssignments((prev) => {
        const siguiente = { ...prev };
        for (const [sku, nombres] of Object.entries(asignaciones)) {
          siguiente[sku] = [...(siguiente[sku] ?? []), ...nombres].slice(0, MAX_IMAGES_PER_PRODUCT);
        }
        return siguiente;
      });
      setFotosNoTraidas(fallidas);
      if (Object.keys(archivos).length === 0 && fallidas.length > 0) {
        setPhotoErrorMsg('No pudimos traer ninguna foto desde los enlaces de tu Excel. '
          + 'Puedes subir las fotos como carpeta o ZIP igual que siempre.');
      }
    } finally {
      setDescargandoFotos(null);
    }
  };

  /**
   * Fase B del diseno de la Fase 15: los productos ya existen (Fase A, /excel/cargar).
   * Reutiliza el endpoint de edicion que ya sube fotos a R2 (InventarioImagenSupport) en
   * vez de escribir un camino de subida nuevo -- un multipart POR PRODUCTO, en lotes
   * paralelos acotados, igual que db.ts hace para el resto del panel.
   */
  const uploadPhotos = async () => {
    const session = requireSession();
    if (!session) return;
    const skusConFotos = filasConProducto.filter((f) => (imageAssignments[f.sku] || []).length > 0);
    if (skusConFotos.length === 0) return;

    setPhotoUploading(true);
    setPhotoErrorMsg(null);
    setPhotoUploadResults(null);
    setPhotoUploadProgress(0);

    const resultados: FotoUploadResultado[] = [];
    let completadas = 0;

    for (let i = 0; i < skusConFotos.length; i += PHOTO_UPLOAD_BATCH_SIZE) {
      const chunk = skusConFotos.slice(i, i + PHOTO_UPLOAD_BATCH_SIZE);
      await Promise.all(chunk.map(async (fila) => {
        try {
          // El endpoint de edicion es un reemplazo completo del producto (exige nombre,
          // categoria, marca, sku, precio/stock validos), no un "solo agregar imagenes" --
          // no existe un endpoint acotado para eso (a diferencia de precios-stock en la
          // Fase 14). Se trae el producto actual y se reenvia tal cual mas las fotos, en
          // vez de agregar un endpoint nuevo solo para esto.
          const getResponse = await apiFetch(
            `${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/${fila.productoId}`,
            { headers: { 'Authorization': `Bearer ${session.token}` } }
          );
          if (!getResponse.ok) {
            // 404 puntual aca casi siempre significa que el producto que esta carga creo
            // ya no existe (se borro despues) -- el mensaje generico del backend no deja
            // eso claro, y el vendedor no tiene forma de saber que paso sin este contexto.
            const mensaje = getResponse.status === 404
              ? 'Este producto ya no existe en tu inventario (puede haber sido eliminado). No se pudo subir la foto para este SKU.'
              : await readErrorMessage(getResponse, 'No se pudo leer el producto antes de subir la foto.');
            resultados.push({ sku: fila.sku, ok: false, mensaje });
            return;
          }
          const producto = await getResponse.json();

          const formData = new FormData();
          formData.append('skuProveedor', producto.skuProveedor ?? fila.sku);
          formData.append('nombrePublicado', producto.nombrePublicado ?? '');
          formData.append('categoria', producto.categoria ?? '');
          if (producto.subcategoria) formData.append('subcategoria', producto.subcategoria);
          formData.append('marcaRepuesto', producto.marcaRepuesto ?? '');
          formData.append('referenciaOem', producto.referenciaOem ?? '');
          formData.append('compatibilidadMarca', producto.compatibilidadMarca ?? '');
          formData.append('compatibilidadModelo', producto.compatibilidadModelo ?? '');
          if (producto.anioDesde != null) formData.append('anioDesde', String(producto.anioDesde));
          if (producto.anioHasta != null) formData.append('anioHasta', String(producto.anioHasta));
          formData.append('motor', producto.motor ?? '');
          formData.append('pricingMode', producto.pricingMode ?? 'SHOW_PRICE');
          if (producto.precio != null) formData.append('precio', String(producto.precio));
          formData.append('stock', String(producto.stock ?? 0));
          formData.append('descripcion', producto.descripcion ?? '');
          formData.append('condicion', producto.condicion ?? 'ORIGINAL');
          formData.append('requiereChasis', String(producto.requiereChasis === true));
          formData.append('compatibilityGroupsJson', producto.compatibilityGroupsJson ?? '');
          (producto.vehiculoCatalogoIds ?? []).forEach((id: number) => formData.append('vehiculoCatalogoIds', String(id)));
          formData.append('activo', String(producto.activo !== false));
          (imageAssignments[fila.sku] || []).forEach((filename) => {
            const blob = availableImages[filename];
            if (blob) formData.append('imagenes', blob, filename);
          });

          const response = await apiFetch(
            `${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/${fila.productoId}/editar`,
            { method: 'POST', headers: { 'Authorization': `Bearer ${session.token}` }, body: formData }
          );
          if (!response.ok) {
            resultados.push({ sku: fila.sku, ok: false, mensaje: await readErrorMessage(response, 'No se pudo subir la foto.') });
          } else {
            resultados.push({ sku: fila.sku, ok: true });
          }
        } catch (err) {
          resultados.push({ sku: fila.sku, ok: false, mensaje: err instanceof Error ? err.message : 'Error al subir la foto.' });
        } finally {
          completadas++;
          setPhotoUploadProgress(Math.round((completadas / skusConFotos.length) * 100));
        }
      }));
    }

    setPhotoUploadResults(resultados);
    setPhotoUploading(false);
    setPhotoUploadProgress(null);
    if (resultados.some((r) => r.ok)) {
      onUploadSuccess();
    }
  };

  /**
   * Si el vendedor ya selecciono carpeta/ZIP de fotos ANTES de cargar el Excel, no tiene
   * sentido pedirle un segundo clic en "Subir fotos" despues -- se suben solas apenas se
   * calcula el emparejamiento automatico por SKU. La galeria manual sigue disponible para
   * corregir lo que no matcheo solo o para reintentar fallidas.
   */
  useEffect(() => {
    if (!result) {
      autoPhotoUploadRef.current = false;
      pendingAutoUploadRef.current = false;
      return;
    }
    if (!pendingAutoUploadRef.current || autoPhotoUploadRef.current) return;
    pendingAutoUploadRef.current = false;
    autoPhotoUploadRef.current = true;
    uploadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, imageAssignments]);

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

  /**
   * Si `sourceFile` es el mismo archivo que se subio (no aplica al detalle del
   * historial, donde no tenemos los bytes originales), reconstruye un Excel con
   * las 17 columnas de la plantilla oficial + el motivo de cada error, para que
   * el vendedor corrija directo ahi y vuelva a subirlo -- sin tener que buscar
   * cada fila a mano en su archivo original. Si no hay archivo fuente, cae al
   * export simple (Fila/SKU/Motivo) de siempre.
   */
  const exportarErrores = async (data: CargaExcelResponse, sourceFile?: File | null) => {
    const filasConError = data.filas.filter((f) => f.estado === 'ERROR');
    if (filasConError.length === 0) return;

    const XLSX = await import('xlsx');
    let worksheet: import('xlsx').WorkSheet | null = null;

    if (sourceFile) {
      try {
        const buffer = await sourceFile.arrayBuffer();
        const originalWorkbook = XLSX.read(buffer, { type: 'array' });
        const originalSheet = originalWorkbook.Sheets[originalWorkbook.SheetNames[0]];
        const originalRows = XLSX.utils.sheet_to_json<unknown[]>(originalSheet, { header: 1, defval: '' });
        const headerRow = originalRows[0] as string[] | undefined;
        if (headerRow && headerRow.length > 0) {
          const filas = filasConError.map((f) => {
            const original = (originalRows[f.fila - 1] as unknown[]) ?? [];
            return [...headerRow.map((_, i) => original[i] ?? ''), f.mensajes.join(' | ')];
          });
          worksheet = XLSX.utils.aoa_to_sheet([[...headerRow, 'motivo_error'], ...filas]);
        }
      } catch (err) {
        console.error('No se pudo leer el archivo original para reconstruir el Excel de errores:', err);
      }
    }

    if (!worksheet) {
      worksheet = XLSX.utils.json_to_sheet(filasConError.map((f) => ({
        'Fila': f.fila,
        'SKU': f.sku,
        'Estado': 'FALLIDO',
        'Motivo del Error': f.mensajes.join(' | ')
      })));
    }

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

  /**
   * El vendedor tiene que enterarse de que hay filas con error, no solo verlo en un
   * badge que puede pasar de largo -- se descarga el Excel de errores solo (nunca el
   * completo) automaticamente apenas llega el resultado de una carga real, sin que tenga
   * que acordarse de tocar "Exportar errores a Excel". El boton sigue ahi por si el
   * navegador bloquea la descarga automatica o quiere volver a bajarlo despues.
   */
  useEffect(() => {
    if (!result) {
      autoErrorDownloadRef.current = false;
      return;
    }
    if (autoErrorDownloadRef.current || result.productosConError === 0) return;
    autoErrorDownloadRef.current = true;
    exportarErrores(result, dataFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const renderResumen = (data: CargaExcelResponse, titulo: string, permitirExportarErrores = false, sourceFile: File | null = null) => (
    // flex:1/minHeight:0 son no-op salvo que el padre sea flex (pasa en el panel derecho de
    // "Nueva carga"; en el modal de historial no hace nada). Necesarios para que la tabla
    // adentro pueda estirarse hasta el alto disponible y scrollear -- sin esto, envolver
    // este bloque en un div extra (como el aviso de errores en el analisis) corta la cadena
    // de flex que hace que .log-table-container llegue a tener una altura real.
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h4 style={{ fontSize: '0.9rem', fontWeight: 700 }}>{titulo}</h4>
        {permitirExportarErrores && data.productosConError > 0 && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            onClick={() => exportarErrores(data, sourceFile)}
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
        <div className="log-table-container" style={{ marginTop: 0, flex: 1, minHeight: 0, maxHeight: '390px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Cabecera fija: fuera del scroll vertical */}
          <div style={{ background: 'var(--bg-sidebar, #f8fafc)', borderBottom: '1px solid var(--border-color)', flexShrink: 0, paddingRight: '14px' }}>
            <table className="log-table" style={{ width: '100%', tableLayout: 'fixed', margin: 0 }}>
              <colgroup>
                <col style={{ width: '70px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: 'auto' }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', textAlign: 'center', background: 'transparent', borderBottom: 'none' }}>Fila</th>
                  <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', background: 'transparent', borderBottom: 'none' }}>SKU</th>
                  <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', background: 'transparent', borderBottom: 'none' }}>Estado</th>
                  <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', background: 'transparent', borderBottom: 'none' }}>Detalle</th>
                </tr>
              </thead>
            </table>
          </div>

          {/* Cuerpo con scroll propio que inicia exactamente en la primera fila */}
          <div className="log-table-body-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <table className="log-table" style={{ width: '100%', tableLayout: 'fixed', margin: 0 }}>
              <colgroup>
                <col style={{ width: '70px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: 'auto' }} />
              </colgroup>
              <tbody>
                {data.filas.map((fila) => (
                  <tr key={fila.fila}>
                    <td style={{ padding: '0.55rem 0.85rem', fontSize: '0.78rem', whiteSpace: 'nowrap', textAlign: 'center', color: 'var(--text-secondary)' }}>{fila.fila}</td>
                    <td style={{ padding: '0.55rem 0.85rem', fontSize: '0.78rem', fontWeight: 750, whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>{fila.sku}</td>
                    <td style={{ padding: '0.55rem 0.85rem', whiteSpace: 'nowrap' }}>
                      {fila.estado === 'OK' && (
                        <span className="log-status-badge" style={{ backgroundColor: 'var(--success-bg)', color: 'hsl(var(--success))', padding: '0.2rem 0.5rem', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>OK</span>
                      )}
                      {fila.estado === 'ADVERTENCIA' && (
                        <span className="log-status-badge" style={{ backgroundColor: 'var(--warning-bg)', color: 'hsl(var(--warning))', padding: '0.2rem 0.5rem', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Advertencia</span>
                      )}
                      {fila.estado === 'ERROR' && (
                        <span className="log-status-badge" style={{ backgroundColor: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.2rem 0.5rem', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Error</span>
                      )}
                    </td>
                    <td style={{ padding: '0.55rem 0.85rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {fila.mensajes.join(' — ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  const renderHistorial = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '520px', width: '100%', flex: 1 }}>
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
        <div style={{ border: '1px dashed var(--border-color)', borderRadius: '14px', minHeight: '320px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
          <div>
            <FileText size={34} style={{ marginBottom: '0.65rem', opacity: 0.6 }} />
            <p style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Aún no hay cargas registradas</p>
            <p style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Cuando completes una carga masiva, aparecerá aquí.</p>
          </div>
        </div>
      )}

      {historial && historial.content.length > 0 && (
        <>
          <div className="log-table-container" style={{ marginTop: 0, flex: 1, maxHeight: 'calc(100vh - 360px)', minHeight: '440px' }}>
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
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                          onClick={() => verDetalleCarga(item.id)}
                        >
                          <Eye size={13} />
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

  if (!isOpen) return null;

  return (
    <div className={embedded ? 'bulk-upload-page' : 'modal-overlay'}>
      <div
        className={embedded ? 'bulk-upload-page-content' : 'modal-content'}
        style={embedded
          ? { width: '100%', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 118px)' }
          : { maxWidth: '1000px', width: '95%', maxHeight: '92vh' }
        }
      >
        {activeTab === 'upload' && !result && !showMapper && (
          <section className="bulk-purpose-panel">
            <div className="bulk-purpose-head">
              <div className="bulk-purpose-icon"><UploadCloud size={20} /></div>
              <div>
                <h4>Para qué sirve la Carga Masiva</h4>
                <p>
                  Publica o actualiza <strong>cientos de repuestos a la vez</strong> desde un solo
                  archivo Excel, en lugar de cargarlos uno por uno. Todo lo que subes aquí queda
                  disponible <strong>al instante en la plataforma web y en la app móvil</strong>,
                  con el mismo stock, precio y descripción en todos los canales.
                </p>
              </div>
            </div>

            <div className="bulk-purpose-cols">
              <div className="bulk-purpose-benefits">
                <span className="bulk-purpose-label">Beneficios</span>
                <ul>
                  <li>Ahorras horas de trabajo: un archivo reemplaza cientos de formularios.</li>
                  <li>Menos errores: la plantilla valida categorías, marcas y años antes de publicar.</li>
                  <li>Catálogo consistente: mismos datos en la web y en la app, siempre sincronizados.</li>
                  <li>Control total: revisas un análisis previo y nada se guarda hasta que confirmas.</li>
                  <li>Historial completo: cada carga queda registrada y puedes descargar el detalle de errores.</li>
                </ul>
              </div>
              <div className="bulk-purpose-steps">
                <span className="bulk-purpose-label">Cómo se usa, paso a paso</span>
                <ol>
                  <li><strong>Descarga la plantilla oficial</strong> con el botón “Descargar Excel”.</li>
                  <li><strong>Completa el Excel</strong>: una fila por repuesto, usando los desplegables de categoría, marca y compatibilidad.</li>
                  <li><strong>Sube el archivo</strong> en el recuadro “DATOS (.XLSX)” (opcionalmente agrega una carpeta o ZIP con las fotos).</li>
                  <li><strong>Analiza la plantilla</strong>: el panel revisa fila por fila y te muestra válidas, alertas y errores, sin guardar nada todavía.</li>
                  <li><strong>Corrige si hace falta</strong> y vuelve a analizar, o continúa solo con las filas válidas.</li>
                  <li><strong>Inicia la carga</strong>: los productos se publican en la web y la app. Los que no tengan foto quedan con una imagen genérica hasta que subas la real.</li>
                  <li><strong>Revisa el resultado</strong> en “Historial de cargas” y descarga el reporte de errores si corresponde.</li>
                </ol>
              </div>
            </div>

            <p className="bulk-purpose-foot">
              ¿Solo necesitas cambiar precios o stock de productos que ya existen? Usa
              <strong> Actualización Rápida</strong>: una plantilla de 3 columnas (sku, precio, stock).
            </p>
          </section>
        )}

        <div className="modal-header">
          <div>
            <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
              <UploadCloud size={20} style={{ color: '#2563eb' }} />
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
              borderBottom: activeTab === 'upload' ? '3px solid #2563eb' : '3px solid transparent',
              background: 'transparent',
              color: activeTab === 'upload' ? '#2563eb' : 'var(--text-secondary)',
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
              borderBottom: activeTab === 'history' ? '3px solid #2563eb' : '3px solid transparent',
              background: 'transparent',
              color: activeTab === 'history' ? '#2563eb' : 'var(--text-secondary)',
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
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, gap: '1.25rem' }}>
              {showMapper ? (
                <PlantillaMapper
                  onCancel={() => setShowMapper(false)}
                  onGenerated={handleMappedFileGenerated}
                  esquema={esquema}
                />
              ) : !result ? (
                <div className="bulk-upload-split-layout">
                  {/* Left Panel: template download, dropzones, action buttons */}
                  <div className="bulk-upload-left-panel">
                    <div className="bulk-mode-selector">
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
                      <div style={{ background: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.65rem 0.85rem', borderRadius: '10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <AlertTriangle size={15} />
                        {errorMsg}
                      </div>
                    )}

                    {dataFromMapper ? (
                      <div className="mapper-generated-card">
                        <span className="mapper-generated-grid" aria-hidden />
                        <div className="mapper-generated-top">
                          <div className="mapper-generated-check"><CheckCircle2 size={18} /></div>
                          <div className="mapper-generated-info">
                            <span className="mapper-kicker">Plantilla adaptada</span>
                            <strong>Tu archivo ya está en formato oficial</strong>
                            <span className="mapper-generated-file"><FileSpreadsheet size={12} /> {dataFile?.name}</span>
                          </div>
                        </div>
                        <p className="mapper-generated-hint">
                          Ahora pulsa <b>Analizar Carga</b> para revisar fila por fila y luego
                          <b> Iniciar Carga</b> para publicar en la plataforma web y en la app.
                        </p>
                        <div className="mapper-generated-actions">
                          <button type="button" className="btn btn-secondary" onClick={() => setShowMapper(true)} disabled={busy}>
                            <Wand2 size={13} /> Volver a mapear
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => { onFileSelected(null); setDataFromMapper(false); }} disabled={busy}>
                            Descartar
                          </button>
                        </div>
                      </div>
                    ) : (
                    <>
                    <div className="tpl-choice">
                      <h4 className="tpl-choice-title">¿Cómo quieres cargar tus datos?</h4>

                      <div className="tpl-choice-opt">
                        <div className="tpl-choice-opt-icon"><FileSpreadsheet size={15} /></div>
                        <div className="tpl-choice-opt-body">
                          <b>Usa la plantilla oficial</b>
                          <span>Excel del sistema con desplegables de categoría, subcategoría, marcas y vehículos.</span>
                          <button
                            type="button"
                            className="btn btn-secondary tpl-choice-btn"
                            onClick={downloadTemplate}
                            disabled={busy}
                          >
                            <FileSpreadsheet size={13} style={{ color: '#107c41' }} />
                            Descargar Excel
                          </button>
                        </div>
                      </div>

                      <div className="tpl-choice-sep"><span>o</span></div>

                      <div className="tpl-choice-opt">
                        <div className="tpl-choice-opt-icon violet"><Wand2 size={15} /></div>
                        <div className="tpl-choice-opt-body">
                          <b>Ya tengo mi propio Excel</b>
                          <span>Relaciona tus columnas con las oficiales y generamos la plantilla por ti.</span>
                          <button
                            type="button"
                            className="btn btn-secondary tpl-choice-btn"
                            onClick={() => setShowMapper(true)}
                            disabled={busy}
                          >
                            <Wand2 size={13} style={{ color: '#7c3aed' }} />
                            Adaptar mi plantilla
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="dropzones-horizontal-container" style={{ gridTemplateColumns: '1fr' }}>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ color: '#2563eb', fontWeight: 800 }}>1.</span> DATOS (.XLSX)
                        </label>
                        <div
                          className={`dropzone compact ${dataFile ? 'active-full' : ''}`}
                          style={{ position: 'relative', cursor: busy ? 'not-allowed' : 'pointer', height: '125px', padding: '1rem' }}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (!busy) fileInputRef.current?.click();
                          }}
                          onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && !busy) {
                              e.preventDefault();
                              fileInputRef.current?.click();
                            }
                          }}
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            style={{ display: 'none' }}
                            disabled={busy}
                            onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
                          />
                          {dataFile && (
                            <button
                              type="button"
                              className="dropzone-clear-btn"
                              title="Quitar archivo de datos"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onFileSelected(null);
                              }}
                            >
                              <X size={13} />
                            </button>
                          )}
                          <FileSpreadsheet size={24} className="dropzone-icon" style={{ color: dataFile ? '#2563eb' : 'var(--text-muted)' }} />
                          <span className="dropzone-title">{dataFile ? dataFile.name : 'Plantilla de Inventario'}</span>
                          <span className="dropzone-desc">{dataFile ? 'Archivo de datos listo' : 'Arrastra o selecciona tu archivo Excel / CSV'}</span>
                        </div>
                      </div>
                    </div>
                    </>
                    )}

                    <div className="form-group">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ color: '#2563eb', fontWeight: 800 }}>2.</span> FOTOS (OPCIONAL)
                        </label>
                        {(photoFolderCount > 0 || photoZipFile !== null) && (
                          <span style={{ fontSize: '0.68rem', color: '#2563eb', fontWeight: 600, background: 'rgba(37, 99, 235, 0.08)', padding: '0.15rem 0.45rem', borderRadius: '6px' }}>
                            1 formato activo
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '0.4rem' }}>
                        Se emparejan solas por SKU. Selecciona una carpeta O un ZIP (el otro se bloqueará).
                      </p>
                      <div className="dropzones-horizontal-container">
                        {/* Dropzone 1: Carpeta Local */}
                        <div
                          className={`dropzone compact ${photoFolderCount > 0 ? 'active-full' : ''} ${photoZipFile !== null ? 'blocked' : ''}`}
                          style={{ position: 'relative', cursor: (busy || photoZipFile !== null) ? 'not-allowed' : 'pointer', height: '125px', padding: '1rem' }}
                          title={photoZipFile !== null ? 'Bloqueado: Hay un archivo ZIP seleccionado' : undefined}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (!busy && photoZipFile === null) {
                              photoFolderInputRef.current?.click();
                            }
                          }}
                          onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && !busy && photoZipFile === null) {
                              e.preventDefault();
                              photoFolderInputRef.current?.click();
                            }
                          }}
                        >
                          <input
                            ref={photoFolderInputRef}
                            type="file"
                            multiple
                            style={{ display: 'none' }}
                            disabled={busy || photoZipFile !== null}
                            onChange={(e) => onPhotoFolderSelected(e.target.files)}
                            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                          />
                          {photoFolderCount > 0 && (
                            <button
                              type="button"
                              className="dropzone-clear-btn"
                              title="Quitar carpeta de fotos"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onPhotoFolderSelected(null);
                              }}
                            >
                              <X size={13} />
                            </button>
                          )}
                          {photoZipFile !== null ? (
                            <Lock size={22} className="dropzone-icon" style={{ color: '#94a3b8' }} />
                          ) : (
                            <FolderOpen size={22} className="dropzone-icon" style={{ color: photoFolderCount > 0 ? '#2563eb' : '#3b82f6' }} />
                          )}
                          <span className="dropzone-title">Carpeta Local</span>
                          <span className="dropzone-desc" style={photoZipFile !== null ? { color: '#94a3b8', fontWeight: 600 } : undefined}>
                            {photoZipFile !== null
                              ? 'Bloqueado (ZIP activo)'
                              : photoFolderCount > 0
                              ? `${photoFolderCount} imágenes`
                              : 'Sube carpeta con fotos'}
                          </span>
                        </div>

                        {/* Dropzone 2: Archivo ZIP */}
                        <div
                          className={`dropzone compact ${photoZipFile ? 'active-full' : ''} ${photoFolderCount > 0 ? 'blocked' : ''}`}
                          style={{ position: 'relative', cursor: (busy || photoFolderCount > 0) ? 'not-allowed' : 'pointer', height: '125px', padding: '1rem' }}
                          title={photoFolderCount > 0 ? 'Bloqueado: Hay una carpeta local seleccionada' : undefined}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (!busy && photoFolderCount === 0) {
                              photoZipInputRef.current?.click();
                            }
                          }}
                          onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && !busy && photoFolderCount === 0) {
                              e.preventDefault();
                              photoZipInputRef.current?.click();
                            }
                          }}
                        >
                          <input
                            ref={photoZipInputRef}
                            type="file"
                            accept=".zip"
                            style={{ display: 'none' }}
                            disabled={busy || photoFolderCount > 0}
                            onChange={(e) => onPhotoZipSelected(e.target.files?.[0] ?? null)}
                          />
                          {photoZipFile && (
                            <button
                              type="button"
                              className="dropzone-clear-btn"
                              title="Quitar archivo ZIP"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onPhotoZipSelected(null);
                              }}
                            >
                              <X size={13} />
                            </button>
                          )}
                          {photoFolderCount > 0 ? (
                            <Lock size={22} className="dropzone-icon" style={{ color: '#94a3b8' }} />
                          ) : (
                            <UploadCloud size={22} className="dropzone-icon" style={{ color: photoZipFile ? '#2563eb' : '#3b82f6' }} />
                          )}
                          <span className="dropzone-title">{photoZipFile ? photoZipFile.name : 'Archivo ZIP'}</span>
                          <span className="dropzone-desc" style={photoFolderCount > 0 ? { color: '#94a3b8', fontWeight: 600 } : undefined}>
                            {photoFolderCount > 0
                              ? 'Bloqueado (Carpeta activa)'
                              : photoZipFile
                              ? `${Object.keys(availableImages).length} imágenes`
                              : 'Sube un ZIP con fotos'}
                          </span>
                        </div>
                      </div>
                      {photoErrorMsg && (
                        <p style={{ fontSize: '0.7rem', color: 'hsl(var(--danger))', marginTop: '0.35rem' }}>{photoErrorMsg}</p>
                      )}
                    </div>

                    {/* Botón principal de Análisis e Indicador de Progreso */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-primary-blue"
                        onClick={handleAnalizar}
                        disabled={!dataFile || busy}
                        style={{ width: '100%', justifyContent: 'center', gap: '0.5rem', padding: '0.65rem' }}
                      >
                        <Play size={15} />
                        {validating ? 'Analizando…' : 'Analizar Carga'}
                      </button>

                      {/* Barra de progreso igual al flujo exprés */}
                      {(validating || uploading) && (
                        <div style={{ marginTop: '0.25rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            <span>{validating ? 'Analizando registros…' : (pollingStatus ?? 'Cargando inventario…')}</span>
                            <span style={{ color: '#2563eb', fontWeight: 700 }}>{actionProgress}%</span>
                          </div>
                          <div className="import-progress-bar" style={{ margin: '0.35rem 0 0 0', height: '6px', borderRadius: '99px', overflow: 'hidden', backgroundColor: 'rgba(37, 99, 235, 0.1)' }}>
                            <div className="import-progress-fill" style={{ width: `${actionProgress}%`, height: '100%', backgroundColor: '#2563eb', borderRadius: '99px', transition: 'width 0.25s ease' }}></div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Panel: analisis. Alto igualado dinamicamente al del panel izquierdo */}
                  <div className="bulk-upload-right-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                    {validating ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', flex: 1, minHeight: '100%', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem', border: '1px dashed rgba(37, 99, 235, 0.3)', borderRadius: '16px', background: 'rgba(37, 99, 235, 0.02)' }}>
                        <RefreshCw className="spin" size={36} style={{ color: '#2563eb', marginBottom: '0.85rem' }} />
                        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>Analizando plantilla...</h4>
                        <p style={{ fontSize: '0.74rem', maxWidth: '300px', lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                          Validando registros, estructura de datos, vehículos y SKUs duplicados. Todavía no se crea nada.
                        </p>
                      </div>
                    ) : !preview ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', flex: 1, minHeight: '100%', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem', border: '1px dashed var(--border-color)', borderRadius: '16px', background: 'rgba(255, 255, 255, 0.01)' }}>
                        <UploadCloud size={40} style={{ strokeWidth: 1.2, color: 'var(--text-muted)', opacity: 0.5, marginBottom: '0.75rem' }} />
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Análisis de la plantilla</h4>
                        <p style={{ fontSize: '0.72rem', maxWidth: '280px', lineHeight: 1.4, color: 'var(--text-muted)' }}>
                          {errorMsg
                            ? ' '
                            : dataFile
                              ? 'Haz clic en "Analizar Carga" abajo para revisar los registros antes de guardarlos. Todavía no se crea nada.'
                              : 'Sube tu plantilla a la izquierda para empezar.'}
                        </p>
                      </div>
                    ) : null}
                    {preview && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        {renderResumen(preview, 'Análisis de la plantilla (nada se guardó todavía)')}
                        {preview.productosConError > 0 && (
                          preview.productosCargados === 0 ? (
                            <div style={{ background: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.65rem 0.85rem', borderRadius: '10px', fontSize: '0.78rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                              <XCircle size={15} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                              <span>
                                <strong>No hay registros válidos para avanzar con la carga.</strong> {preview.productosConError === 1 ? 'La 1 fila analizada contiene errores.' : `Las ${preview.productosConError} filas analizadas contienen errores.`} Corrige la plantilla Excel y vuelve a analizarla.
                              </span>
                            </div>
                          ) : (
                            <div style={{ background: 'var(--warning-bg)', color: 'hsl(var(--warning))', padding: '0.65rem 0.85rem', borderRadius: '10px', fontSize: '0.78rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                              <span>
                                {preview.productosConError === 1 ? 'Hay 1 registro con error que no se va a cargar.' : `Hay ${preview.productosConError} registros con error que no se van a cargar.`} Puedes iniciar la carga con los {preview.productosCargados} registros válidos (las filas con error se excluirán y se generará un Excel con el detalle), o corregir la plantilla y volver a analizarla.
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{
                  background: '#ffffff',
                  border: '1px solid #dfe7f1',
                  borderRadius: '16px',
                  padding: '1rem 1.25rem'
                }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>
                    {result.productosConError > 0 ? 'Carga finalizada con errores' : 'Carga finalizada'}
                  </h4>
                  {dataFile && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.15rem 0 0' }}>{dataFile.name}</p>
                  )}
                </div>
              )}

              {result && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 700 }}>Detalle de la carga</h4>
                    {result.productosConError > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        onClick={() => exportarErrores(result, dataFile)}
                      >
                        <Download size={13} />
                        Exportar errores a Excel
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span className="log-status-badge" style={{ backgroundColor: 'var(--success-bg)', color: 'hsl(var(--success))', padding: '0.3rem 0.6rem' }}>
                      <CheckCircle2 size={13} /> {result.productosCargados} OK
                    </span>
                    {result.productosConAdvertencia > 0 && (
                      <span className="log-status-badge" style={{ backgroundColor: 'var(--warning-bg)', color: 'hsl(var(--warning))', padding: '0.3rem 0.6rem' }}>
                        <AlertTriangle size={13} /> {result.productosConAdvertencia} con advertencia
                      </span>
                    )}
                    {result.productosConError > 0 && (
                      <span className="log-status-badge" style={{ backgroundColor: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.3rem 0.6rem' }}>
                        <XCircle size={13} /> {result.productosConError} con error
                      </span>
                    )}
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                      {result.totalFilas} filas totales
                    </span>
                  </div>

                  {Object.keys(urlsDeclaradasPendientes).length > 0 && (
                    <div className="mapper-alert info" style={{ alignItems: 'center' }}>
                      <span>
                        Tu Excel trae el enlace de la foto de{' '}
                        <b>{Object.keys(urlsDeclaradasPendientes).length}</b> repuestos. Podemos traerlas
                        y asignarlas solas.
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary mapper-btn"
                        style={{ marginLeft: 'auto' }}
                        onClick={traerFotosDeclaradas}
                        disabled={!!descargandoFotos || photoUploading}
                      >
                        {descargandoFotos
                          ? `Trayendo ${descargandoFotos.hechas} de ${descargandoFotos.total}…`
                          : 'Traer las fotos de mi Excel'}
                      </button>
                    </div>
                  )}

                  {fotosNoTraidas.length > 0 && (
                    <p style={{ fontSize: '0.75rem', color: 'hsl(var(--warning))', margin: 0 }}>
                      No pudimos traer {fotosNoTraidas.length} {fotosNoTraidas.length === 1 ? 'foto' : 'fotos'}
                      {' '}({fotosNoTraidas[0].motivo}). Puedes subirlas como carpeta o ZIP, o agregarlas
                      después desde Inventario General.
                    </p>
                  )}

                  {filasConProducto.length > 0 && Object.keys(availableImages).length === 0 && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                      No seleccionaste fotos antes de cargar el Excel, así que los productos quedaron con la imagen genérica.
                      Puedes agregarlas editando cada producto desde Inventario General.
                    </p>
                  )}

                  {photoErrorMsg && (
                    <div style={{ background: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.5rem 0.75rem', borderRadius: '8px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <AlertTriangle size={14} />
                      {photoErrorMsg}
                    </div>
                  )}

                  {Object.keys(availableImages).length > 0 && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {filasConProducto.filter((f) => (imageAssignments[f.sku] || []).length > 0).length} de {filasConProducto.length} productos con foto asignada.
                      Usa "Elegir fotos" en la tabla para corregir lo que no haya coincidido solo.
                    </span>
                  )}

                  {photoUploadResults && (() => {
                    const subidas = photoUploadResults.filter((r) => r.ok).length;
                    const fallidas = photoUploadResults.length - subidas;
                    const todoOk = fallidas === 0;
                    return (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        background: todoOk ? 'var(--success-bg)' : 'var(--warning-bg)',
                        color: todoOk ? 'hsl(var(--success))' : 'hsl(var(--warning))',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '10px',
                        fontSize: '0.8rem',
                        fontWeight: 600
                      }}>
                        {todoOk ? <CheckCircle2 size={16} style={{ flexShrink: 0 }} /> : <AlertTriangle size={16} style={{ flexShrink: 0 }} />}
                        {todoOk
                          ? `Fotos subidas: ${subidas} de ${photoUploadResults.length} correctas.`
                          : `Fotos subidas: ${subidas} de ${photoUploadResults.length} correctas, ${fallidas} fallaron. Revisa la columna "Resultado" en la tabla.`}
                      </div>
                    );
                  })()}

                  <div className="log-table-container" style={{ marginTop: 0, maxHeight: '440px', overflowY: 'auto' }}>
                    <table className="log-table">
                      <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-sidebar, #f8fafc)' }}>
                        <tr>
                          <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', width: '65px', minWidth: '65px', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--bg-sidebar, #f8fafc)', zIndex: 2, textAlign: 'center' }}>Fila</th>
                          <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', width: '130px', minWidth: '130px', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--bg-sidebar, #f8fafc)', zIndex: 2 }}>SKU</th>
                          <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', position: 'sticky', top: 0, background: 'var(--bg-sidebar, #f8fafc)', zIndex: 2 }}>Producto</th>
                          <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', position: 'sticky', top: 0, background: 'var(--bg-sidebar, #f8fafc)', zIndex: 2 }}>Categoría</th>
                          <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', width: '110px', minWidth: '110px', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--bg-sidebar, #f8fafc)', zIndex: 2 }}>Estado</th>
                          <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', position: 'sticky', top: 0, background: 'var(--bg-sidebar, #f8fafc)', zIndex: 2 }}>Detalle</th>
                          <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', position: 'sticky', top: 0, background: 'var(--bg-sidebar, #f8fafc)', zIndex: 2 }}>Fotos</th>
                          <th style={{ padding: '0.55rem 0.85rem', fontSize: '0.72rem', position: 'sticky', top: 0, background: 'var(--bg-sidebar, #f8fafc)', zIndex: 2 }}>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.filas.map((fila) => {
                          const info = productInfoBySku[fila.sku];
                          const tieneProducto = fila.estado !== 'ERROR' && fila.productoId != null;
                          const seleccionadas = imageAssignments[fila.sku] || [];
                          const subida = photoUploadResults?.find((r) => r.sku === fila.sku);
                          const isOpen = gallerySkuOpen === fila.sku;
                          return (
                            <React.Fragment key={fila.fila}>
                              <tr>
                                <td style={{ padding: '0.55rem 0.85rem', fontSize: '0.78rem', whiteSpace: 'nowrap', textAlign: 'center', color: 'var(--text-secondary)' }}>{fila.fila}</td>
                                <td style={{ padding: '0.55rem 0.85rem', fontSize: '0.78rem', fontWeight: 750, whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>{fila.sku}</td>
                                <td style={{ padding: '0.55rem 0.85rem', fontSize: '0.74rem', color: 'var(--text-secondary)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={info?.nombre}>
                                  {info?.nombre || '—'}
                                </td>
                                <td style={{ padding: '0.55rem 0.85rem', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                  {info?.categoria || '—'}
                                </td>
                                <td style={{ padding: '0.55rem 0.85rem', whiteSpace: 'nowrap' }}>
                                  {fila.estado === 'OK' && (
                                    <span className="log-status-badge" style={{ backgroundColor: 'var(--success-bg)', color: 'hsl(var(--success))', padding: '0.2rem 0.5rem', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>OK</span>
                                  )}
                                  {fila.estado === 'ADVERTENCIA' && (
                                    <span className="log-status-badge" style={{ backgroundColor: 'var(--warning-bg)', color: 'hsl(var(--warning))', padding: '0.2rem 0.5rem', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Advertencia</span>
                                  )}
                                  {fila.estado === 'ERROR' && (
                                    <span className="log-status-badge" style={{ backgroundColor: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.2rem 0.5rem', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Error</span>
                                  )}
                                </td>
                                <td style={{ padding: '0.55rem 0.85rem', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                  {fila.mensajes.join(' — ')}
                                </td>
                                <td style={{ padding: '0.5rem 0.65rem' }}>
                                  {!tieneProducto ? (
                                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                                  ) : seleccionadas.length > 0 ? (
                                    <span className="log-status-badge" style={{ backgroundColor: 'var(--success-bg)', color: 'hsl(var(--success))', padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}>
                                      {seleccionadas.length}/{MAX_IMAGES_PER_PRODUCT}
                                    </span>
                                  ) : (
                                    <span className="log-status-badge" style={{ backgroundColor: 'var(--warning-bg)', color: 'hsl(var(--warning))', padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}>
                                      Sin foto
                                    </span>
                                  )}
                                  {tieneProducto && subida && (
                                    <div style={{ fontSize: '0.68rem', color: subida.ok ? 'hsl(var(--success))' : 'hsl(var(--danger))', marginTop: '0.2rem' }}>
                                      {subida.ok ? 'Subida' : subida.mensaje || 'Falló'}
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: '0.5rem 0.65rem' }}>
                                  {tieneProducto ? (
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
                                      onClick={() => setGallerySkuOpen(isOpen ? null : fila.sku)}
                                      disabled={photoUploading || Object.keys(availableImages).length === 0}
                                    >
                                      {isOpen ? 'Cerrar' : 'Elegir fotos'}
                                    </button>
                                  ) : (
                                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                                  )}
                                </td>
                              </tr>
                              {isOpen && tieneProducto && (
                                <tr>
                                  <td colSpan={8} style={{ padding: '0.65rem', background: 'var(--bg-app)' }}>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                      Selecciona hasta {MAX_IMAGES_PER_PRODUCT} imágenes para <strong>{fila.sku}</strong>.
                                    </p>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '0.5rem' }}>
                                      {Object.keys(availableImages).map((filename) => {
                                        const isSelected = seleccionadas.includes(filename);
                                        const limitReached = !isSelected && seleccionadas.length >= MAX_IMAGES_PER_PRODUCT;
                                        return (
                                          <div
                                            key={filename}
                                            onClick={() => !limitReached && toggleImageSelection(fila.sku, filename)}
                                            title={limitReached ? `Máximo ${MAX_IMAGES_PER_PRODUCT} imágenes` : filename}
                                            style={{
                                              position: 'relative',
                                              border: isSelected ? '2px solid hsl(var(--primary))' : '1px solid var(--border-color)',
                                              borderRadius: '8px',
                                              overflow: 'hidden',
                                              cursor: limitReached ? 'not-allowed' : 'pointer',
                                              opacity: limitReached ? 0.4 : 1
                                            }}
                                          >
                                            <img src={imageObjectUrls[filename]} alt={filename} style={{ width: '100%', height: '64px', objectFit: 'cover', display: 'block' }} />
                                            {isSelected && (
                                              <div style={{ position: 'absolute', top: 3, right: 3, background: 'hsl(var(--primary))', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <CheckCircle2 size={11} color="white" />
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {Object.keys(availableImages).length > 0 && (() => {
                    const hayPendientes = filasConProducto.some((f) => {
                      const asignadas = imageAssignments[f.sku] || [];
                      if (asignadas.length === 0) return false;
                      return !photoUploadResults?.find((r) => r.sku === f.sku && r.ok);
                    });
                    return (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <button type="button" className="btn-icon" onClick={resetPhotoState} disabled={photoUploading} aria-label="Quitar fotos" title="Quitar fotos">
                          <RefreshCw size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: '0.5rem 0.9rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                          onClick={uploadPhotos}
                          disabled={photoUploading || !hayPendientes}
                        >
                          <ImageUp size={15} />
                          {photoUploading ? `Subiendo fotos… ${photoUploadProgress ?? 0}%` : 'Subir fotos'}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}

            </div>
          )}
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {activeTab === 'history' ? (
            <button
              type="button"
              className="btn btn-primary btn-primary-blue"
              style={{ marginLeft: 'auto', padding: '0.65rem 1.6rem', fontSize: '0.85rem', borderRadius: '12px', fontWeight: 700 }}
              onClick={() => setActiveTab('upload')}
            >
              Nueva carga
            </button>
          ) : showMapper ? null : !result ? (
              <>
                {(dataFile || photoFolderCount > 0 || photoZipFile) && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginRight: 'auto', background: 'rgba(239, 68, 68, 0.05)', color: 'hsl(var(--danger))', borderColor: 'rgba(239, 68, 68, 0.1)' }}
                    onClick={resetFileState}
                    disabled={busy}
                  >
                    Limpiar Vista
                  </button>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem', marginLeft: 'auto' }}>
                  {!preview && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Primero analiza la carga.
                    </span>
                  )}
                  {preview && preview.productosCargados === 0 && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Corrige los errores del análisis para poder iniciar la carga.
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-primary-blue"
                    onClick={handleIniciarCarga}
                    disabled={!preview || busy || preview.productosCargados === 0}
                    style={{
                      padding: '0.65rem 1.6rem',
                      fontSize: '0.85rem',
                      borderRadius: '12px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <UploadCloud size={16} />
                    {uploading ? (pollingStatus ?? 'Cargando…') : 'Iniciar Carga'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap', width: '100%' }}>
                <button
                  type="button"
                  onClick={resetFileState}
                  style={{ border: 'none', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.72rem', textDecoration: 'underline', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <RefreshCw size={12} />
                  Cargar otro archivo
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-primary-blue"
                  onClick={onClose}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <Package size={15} />
                  Ir a Inventario General
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
  );
};

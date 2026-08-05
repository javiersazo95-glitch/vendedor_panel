import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { UploadCloud, FolderOpen, FileText, CheckCircle2, AlertTriangle, XCircle, Play, FileSpreadsheet, RefreshCw, Trash2, SearchCheck, ImageUp, Images, Eye, Search, Download, Pencil, Zap, Package } from 'lucide-react';
import type { Product, BatchResult } from '../db';
import { saveProductsBatch, getAllProducts } from '../db';
import { useFocusTrap } from '../utils/useFocusTrap';
import { DEFAULT_PRODUCT_IMAGE_URL } from '../utils/imageHelper';

interface BulkUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
  onAssignImagesStateChange?: (isAssigning: boolean) => void;
  embedded?: boolean;
}

type PreparedProduct = Omit<Product, 'id' | 'lastUpdated'> & { imageFile?: File | Blob | (File | Blob)[] | null; sourceRow?: number };

const MAX_IMAGES_PER_PRODUCT = 4;
const BULK_UPLOAD_HISTORY_KEY = 'repuestop_bulk_upload_history';

interface BulkUploadHistoryItem {
  id: string;
  createdAt: string;
  total: number;
  success: number;
  warnings: number;
  errors: number;
  status: 'COMPLETADA' | 'CON_ERRORES';
  mode?: 'FULL_CREATION' | 'EXPRESS_STOCK_PRICE';
  records?: Product[];
  // SKUs saved with a generic placeholder photo instead of a real one, so the
  // vendor can find and fix them later — the history previously had no way to
  // tell these apart from products with a real photo (UX-SRC-007).
  genericImageSkus?: string[];
}

const loadBulkUploadHistory = (): BulkUploadHistoryItem[] => {
  try {
    const raw = localStorage.getItem(BULK_UPLOAD_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getIsoTimestampString = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};

const productHasImage = (product: PreparedProduct) => {
  if (product.image && product.image.trim()) return true;
  if (!product.imageFile) return false;
  return Array.isArray(product.imageFile) ? product.imageFile.length > 0 : true;
};

interface ImportLog {
  id: string;
  row: number;
  sku: string;
  name?: string;
  status: 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
  pendingProduct?: PreparedProduct;
}

const isSkuIssueLog = (log: ImportLog) =>
  ['ERROR', 'WARNING'].includes(log.status) && (
    /repetido|duplicad|SKU|ya existe|invalido|formato/i.test(log.message) ||
    !!log.pendingProduct
  );



export const BulkUpload: React.FC<BulkUploadProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
  onAssignImagesStateChange,
  embedded = false
}) => {
  const [uploadMode, setUploadMode] = useState<'FULL_CREATION' | 'EXPRESS_STOCK_PRICE'>('FULL_CREATION');
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [imageFolderFiles, setImageFolderFiles] = useState<FileList | null>(null);
  const [imageZipFile, setImageZipFile] = useState<File | null>(null);
  const [imageSource, setImageSource] = useState<'FOLDER' | 'ZIP'>('FOLDER');

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [stats, setStats] = useState({
    success: 0,
    warnings: 0,
    errors: 0,
  });

  const [preparedProducts, setPreparedProducts] = useState<PreparedProduct[]>([]);
  const [analysisDone, setAnalysisDone] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);

  const [reviewingLogId, setReviewingLogId] = useState<string | null>(null);
  const [reviewSkuInput, setReviewSkuInput] = useState('');
  const [reviewValidation, setReviewValidation] = useState<{ status: 'idle' | 'checking' | 'valid' | 'invalid'; message: string }>({ status: 'idle', message: '' });


  // Asignación manual de imágenes por SKU antes de iniciar la carga real
  const [imagesModalOpen, setImagesModalOpen] = useState(false);
  const [availableImages, setAvailableImages] = useState<Record<string, File | Blob>>({});
  const [imageAssignments, setImageAssignments] = useState<Record<string, string[]>>({});
  const [galleryOpenForSku, setGalleryOpenForSku] = useState<string | null>(null);
  const [uploadSuccessCount, setUploadSuccessCount] = useState<number | null>(null);
  const [missingImageRows, setMissingImageRows] = useState<{ row: number; tableRow: number; sku: string; name: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [uploadHistory, setUploadHistory] = useState<BulkUploadHistoryItem[]>(() => loadBulkUploadHistory());
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<BulkUploadHistoryItem | null>(null);

  // Filtros, búsqueda y paginación para la tabla de logs de transacciones
  const [logFilter, setLogFilter] = useState<'ALL' | 'SUCCESS' | 'WARNING' | 'ERROR'>('ALL');
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [logPage, setLogPage] = useState<number>(1);
  const [logPageSize] = useState<number>(50);
  const [savedSkusSet, setSavedSkusSet] = useState<Set<string>>(new Set());

  // Paginación para la vista de asignación de imágenes
  const [imagesPageSize, setImagesPageSize] = useState<number>(15);
  const [imagesCurrentPage, setImagesCurrentPage] = useState<number>(1);
  const [isRetryingFailed, setIsRetryingFailed] = useState<boolean>(false);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesStatus = logFilter === 'ALL' || log.status === logFilter;
      if (!matchesStatus) return false;
      if (!logSearchQuery.trim()) return true;
      const q = logSearchQuery.toLowerCase().trim();
      return (
        log.sku.toLowerCase().includes(q) ||
        (log.name && log.name.toLowerCase().includes(q)) ||
        log.message.toLowerCase().includes(q) ||
        `fila ${log.row}`.includes(q)
      );
    });
  }, [logs, logFilter, logSearchQuery]);

  useEffect(() => {
    setLogPage(1);
  }, [logFilter, logSearchQuery]);

  const paginatedLogs = useMemo(() => {
    const start = (logPage - 1) * logPageSize;
    return filteredLogs.slice(start, start + logPageSize);
  }, [filteredLogs, logPage, logPageSize]);

  const totalLogPages = Math.ceil(filteredLogs.length / logPageSize) || 1;

  const handleExportErrors = async () => {
    const errorLogs = logs.filter(l => l.status === 'ERROR');
    if (errorLogs.length === 0) return;

    const exportData = errorLogs.map(l => ({
      'Fila Original': l.row === 0 ? 'N/A' : l.row,
      'SKU': l.sku,
      'Nombre del Repuesto': l.name || '—',
      'Estado': 'FALLIDO',
      'Motivo del Error': l.message
    }));

    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Errores_Carga');
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Reporte_Errores_Carga_Masiva_${getIsoTimestampString()}.xlsx`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  useEffect(() => {
    setImagesCurrentPage(1);
  }, [imagesPageSize, preparedProducts.length]);

  useEffect(() => {
    if (onAssignImagesStateChange) {
      onAssignImagesStateChange(imagesModalOpen);
    }
  }, [imagesModalOpen, onAssignImagesStateChange]);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const dataFileInputRef = useRef<HTMLInputElement>(null);

  // Sincronización de scrollbar horizontal (superior e inferior) para la tabla de asignación de imágenes
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState<number>(0);

  useEffect(() => {
    if (tableRef.current) {
      setTableScrollWidth(tableRef.current.scrollWidth);
    }
  }, [preparedProducts, imagesPageSize, imagesCurrentPage, imagesModalOpen]);

  const handleTableScroll = () => {
    if (tableContainerRef.current && topScrollRef.current) {
      topScrollRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
    }
  };

  const handleTopScroll = () => {
    if (tableContainerRef.current && topScrollRef.current) {
      tableContainerRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };


  const handleReset = () => {
    setDataFile(null);
    setImageFolderFiles(null);
    setImageZipFile(null);
    setProgress(0);
    setLogs([]);
    setStats({ success: 0, warnings: 0, errors: 0 });
    setProcessing(false);
    setPreparedProducts([]);
    setAnalysisDone(false);
    setUploadDone(false);
    setImagesModalOpen(false);
    setAvailableImages({});
    setImageAssignments({});
    setGalleryOpenForSku(null);
    setUploadSuccessCount(null);
    setMissingImageRows([]);
    setLogFilter('ALL');
    setLogSearchQuery('');
    setLogPage(1);
    setSavedSkusSet(new Set());

    if (dataFileInputRef.current) dataFileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (zipInputRef.current) zipInputRef.current.value = '';
  };

  const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  // Selecciona una carpeta local usando la API moderna del navegador (sin el aviso
  // de "sitio de confianza" que muestra el input clásico webkitdirectory). Si el
  // navegador no la soporta, cae al input de carpeta tradicional.
  const handlePickFolder = async () => {
    if (processing) return;

    const showDirectoryPicker = (window as any).showDirectoryPicker;
    if (typeof showDirectoryPicker !== 'function') {
      folderInputRef.current?.click();
      return;
    }

    try {
      const dirHandle = await showDirectoryPicker();
      const files: File[] = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const ext = entry.name.split('.').pop()?.toLowerCase();
          if (ext && IMAGE_EXTENSIONS.includes(ext)) {
            files.push(await entry.getFile());
          }
        }
      }

      if (files.length === 0) return;

      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      setImageFolderFiles(dt.files);
    } catch {
      // El usuario cerró el selector de carpetas sin elegir ninguna.
    }
  };

  // Genera URLs temporales para mostrar las miniaturas de la galería de imágenes
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

  const productsWithAssignedImages = useMemo(() => (
    preparedProducts.map((product) => {
      const filenames = imageAssignments[product.sku] || [];
      if (filenames.length === 0) return product;
      const files = filenames.map((fn) => availableImages[fn]).filter(Boolean) as (File | Blob)[];
      return { ...product, imageFile: files };
    })
  ), [availableImages, imageAssignments, preparedProducts]);

  const currentMissingImageRows = useMemo(() => (
    productsWithAssignedImages
      .map((product, index) => ({
        row: product.sourceRow ?? 0,
        tableRow: index + 1,
        sku: product.sku,
        name: product.name,
        hasImage: productHasImage(product)
      }))
      .filter((item) => !item.hasImage)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit hasImage from the result
      .map(({ hasImage, ...item }) => item)
  ), [productsWithAssignedImages]);

  const highlightedMissingImageSkus = new Set(missingImageRows.map((item) => item.sku));

  const mainDialogRef = useFocusTrap(isOpen && !embedded);
  const reviewSkuDialogRef = useFocusTrap(reviewingLogId !== null);
  const historyDetailDialogRef = useFocusTrap(selectedHistoryItem !== null);

  if (!isOpen) return null;

  // 1. Generate & Download CSV/XLSX Templates
  const downloadTemplate = async (format: 'xlsx' | 'csv') => {
    const isExpress = uploadMode === 'EXPRESS_STOCK_PRICE';
    
    const headers = isExpress
      ? ['sku', 'precio', 'stock']
      : [
          'sku',
          'oem',
          'nombre',
          'categoria',
          'marca_repuesto',
          'marca_vehiculo',
          'modelo_vehiculo',
          'ano_vehiculo',
          'version_vehiculo',
          'precio',
          'stock',
          'descripcion',
          'url_foto'
        ];

    const sampleRows = isExpress
      ? [
          { sku: 'BOS-SPK-FR7DC', precio: 4900, stock: 45 },
          { sku: 'BRE-BRK-P83085', precio: 34900, stock: 12 }
        ]
      : [
          {
            sku: 'BOS-SPK-FR7DC',
            oem: '0242235666',
            nombre: 'Bujía de Encendido Super Plus',
            categoria: 'Motor',
            marca_repuesto: 'Bosch',
            marca_vehiculo: 'Toyota',
            modelo_vehiculo: 'Yaris',
            ano_vehiculo: 2018,
            version_vehiculo: '1.5 GLI',
            precio: 4500,
            stock: 50,
            descripcion: 'Bujía de encendido de alta durabilidad.',
            url_foto: ''
          },
          {
            sku: 'BRE-BRK-P83085',
            oem: '04465-0D020',
            nombre: 'Pastillas de Freno Brembo',
            categoria: 'Frenos',
            marca_repuesto: 'Brembo',
            marca_vehiculo: 'Toyota',
            modelo_vehiculo: 'Yaris',
            ano_vehiculo: 2019,
            version_vehiculo: '1.5 Sport',
            precio: 32000,
            stock: 15,
            descripcion: 'Pastillas de freno cerámicas delanteras.',
            url_foto: 'https://pub-650d4cc5c6be42bc9a81e878e6042ea6.r2.dev/Productos/img_generica/imagen-generica.png'
          }
        ];

    const filePrefix = isExpress ? 'Plantilla_Stock_Precio_Express' : 'Plantilla_Carga_Masiva_RepuesTop';

    if (format === 'csv') {
      const Papa = (await import('papaparse')).default;
      const csvContent = Papa.unparse({
        fields: headers,
        data: sampleRows.map(row => Object.values(row))
      });
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `${filePrefix}_${getIsoTimestampString()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      // Excel template creation
      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario');
      const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `${filePrefix}_${getIsoTimestampString()}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Helper to convert Blob or File to Base64


  // Extract images from ZIP
  const extractZipImages = async (zipFile: File): Promise<Record<string, Blob>> => {
    const imageFilesMap: Record<string, Blob> = {};
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const contents = await zip.loadAsync(zipFile);
    
    for (const [filename, fileObj] of Object.entries(contents.files)) {
      if (!fileObj.dir) {
        const ext = filename.split('.').pop()?.toLowerCase();
        if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
          const blob = await fileObj.async('blob');
          // Get only the basename
          const cleanName = filename.split('/').pop() || filename;
          imageFilesMap[cleanName.toLowerCase()] = blob;
        }
      }
    }
    return imageFilesMap;
  };

  // Extract images from folder files list
  const extractFolderImages = (files: FileList): Record<string, File> => {
    const imageFilesMap: Record<string, File> = {};
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        imageFilesMap[file.name.toLowerCase()] = file;
      }
    }
    return imageFilesMap;
  };

  // Core reconciliation engine: valida el archivo y las imágenes, pero no guarda nada aún
  const handleAnalyze = async () => {
    if (!dataFile) return;

    setProcessing(true);
    setProgress(10);
    setLogs([]);
    setStats({ success: 0, warnings: 0, errors: 0 });
    setPreparedProducts([]);
    setAnalysisDone(false);
    setUploadDone(false);

    try {
      // 1. Gather image files into a key-value dictionary (lowercase filename -> Blob/File)
      let imagesMap: Record<string, Blob | File> = {};
      setProgress(20);
      
      if (imageSource === 'ZIP' && imageZipFile) {
        imagesMap = await extractZipImages(imageZipFile);
      } else if (imageSource === 'FOLDER' && imageFolderFiles) {
        imagesMap = extractFolderImages(imageFolderFiles);
      }

      setAvailableImages(imagesMap);
      setImageAssignments({});
      setProgress(40);

      // 2. Parse Excel/CSV data file
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          let rows: any[] = [];
          if (dataFile.name.endsWith('.csv')) {
            const Papa = (await import('papaparse')).default;
            const csvText = e.target?.result as string;
            const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
            rows = parsed.data;
          } else {
            const XLSX = await import('xlsx');
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(sheet);
          }

          if (rows.length === 0) {
            setLogs([{ id: 'empty-file', row: 0, sku: 'N/A', status: 'ERROR', message: 'El archivo de datos está vacío.' }]);
            setStats(s => ({ ...s, errors: 1 }));
            setProcessing(false);
            return;
          }

          setProgress(50);

          // 3. Process rows and reconcile images
          const existingProducts = await getAllProducts();
          const existingSkus = new Set(existingProducts.map(p => p.sku.trim().toUpperCase()));
          const existingProductMap = new Map(existingProducts.map(p => [p.sku.trim().toUpperCase(), p]));
          const seenSkusInFile = new Set<string>();

          const processedProducts: PreparedProduct[] = [];
          const localLogs: Omit<ImportLog, 'id'>[] = [];
          let successCount = 0;
          let warningCount = 0;
          let errorCount = 0;

          if (uploadMode === 'EXPRESS_STOCK_PRICE') {
            for (let i = 0; i < rows.length; i++) {
              const row = rows[i];
              const rowNum = i + 2; // Row 1 is header

              const rawSku = row.sku || row.SKU || '';
              const rawPrice = row.precio !== undefined ? row.precio : (row.Precio !== undefined ? row.Precio : row.price);
              const rawStock = row.stock !== undefined ? row.stock : (row.Stock !== undefined ? row.Stock : row.units);

              const sku = String(rawSku).trim();
              const normalizedSku = sku ? sku.toUpperCase() : '';

              if (!sku) {
                errorCount++;
                localLogs.push({ row: rowNum, sku: 'VACÍO', name: 'N/A', status: 'ERROR', message: 'Fila omitida: SKU faltante o inválido.' });
                continue;
              }

              if (seenSkusInFile.has(normalizedSku)) {
                errorCount++;
                localLogs.push({ row: rowNum, sku: normalizedSku, name: 'N/A', status: 'ERROR', message: `Fila omitida: El SKU "${sku}" está repetido dentro de la misma plantilla.` });
                continue;
              }
              seenSkusInFile.add(normalizedSku);

              const existingProduct = existingProductMap.get(normalizedSku);
              if (!existingProduct) {
                warningCount++;
                localLogs.push({
                  row: rowNum,
                  sku: normalizedSku,
                  name: 'No Encontrado',
                  status: 'WARNING',
                  message: `El SKU "${sku}" no existe en tu inventario. Se omitirá esta actualización.`
                });
                continue;
              }

              const price = rawPrice !== undefined && rawPrice !== '' ? Number(rawPrice) : existingProduct.price;
              const stock = rawStock !== undefined && rawStock !== '' ? Number(rawStock) : existingProduct.stock;

              if (isNaN(price) || price <= 0) {
                errorCount++;
                localLogs.push({ row: rowNum, sku: normalizedSku, name: existingProduct.name, status: 'ERROR', message: 'El precio debe ser un número mayor a 0.' });
                continue;
              }

              if (isNaN(stock) || stock < 0) {
                errorCount++;
                localLogs.push({ row: rowNum, sku: normalizedSku, name: existingProduct.name, status: 'ERROR', message: 'El stock no puede ser un número negativo.' });
                continue;
              }

              const updatedPrepared: PreparedProduct = {
                ...existingProduct,
                price,
                stock,
                sourceRow: rowNum
              };

              processedProducts.push(updatedPrepared);
              successCount++;
              localLogs.push({
                row: rowNum,
                sku: normalizedSku,
                name: existingProduct.name,
                status: 'SUCCESS',
                message: `Listo para actualizar: Precio CLP $${price.toLocaleString('es-CL')} | Stock: ${stock} unid.`
              });
            }
          } else {
            for (let i = 0; i < rows.length; i++) {
              const row = rows[i];
              const rowNum = i + 2; // Row 1 is header
              
              // Standardise column mapping
              const rawSku = row.sku || row.SKU || '';
              const rawName = row.nombre || row.Nombre || row.name || '';
              const rawPrice = row.precio || row.Precio || row.price || 0;
              const rawStock = row.stock || row.Stock || 0;
              const rawCategory = row.categoria || row.Categoria || row.category || 'Motor';
              const rawPartBrand = row.marca_repuesto || row.Marca_Repuesto || row.partBrand || '';
              const rawVehicleBrand = row.marca_vehiculo || row.Marca_Vehiculo || row.vehicleBrand || '';
              const rawVehicleModel = row.modelo_vehiculo || row.Modelo_Vehiculo || row.vehicleModel || '';
              const rawVehicleYear = row.ano_vehiculo || row.Ano_Vehiculo || row.vehicleYear || new Date().getFullYear();
              const rawVehicleVersion = row.version_vehiculo || row.Version_Vehiculo || row.vehicleVersion || '';
              const rawDescription = row.descripcion || row.Descripcion || row.description || '';
              const rawImageFilename = row.imagen || row.Imagen || row.image || row.url_foto || row.URL_Foto || row.url_imagen || '';

              const sku = String(rawSku).trim();
              const name = String(rawName).trim();
              const price = Number(rawPrice);
              const stock = Number(rawStock);

              // Detecta problemas de SKU sin abandonar la fila todavía, para poder
              // construir el producto y dejarlo listo por si el vendedor corrige el SKU.
              const normalizedSku = sku ? sku.toUpperCase() : '';
              let skuErrorMessage: string | null = null;
              if (!sku) {
                skuErrorMessage = 'Fila omitida: SKU faltante o inválido.';
              } else if (seenSkusInFile.has(normalizedSku)) {
                skuErrorMessage = `Fila omitida: El SKU "${sku}" está repetido dentro de la misma plantilla.`;
              } else if (existingSkus.has(normalizedSku)) {
                skuErrorMessage = `Fila omitida: El SKU ya existe en el catálogo (registro omitido por SKU duplicado).`;
              } else {
                seenSkusInFile.add(normalizedSku);
              }

              // Validaciones del resto de los campos (se evalúan siempre, para poder
              // ofrecer un producto ya armado si solo falla el SKU).
              let fieldErrorMessage: string | null = null;
              if (!name) {
                fieldErrorMessage = 'Nombre de producto faltante.';
              } else if (isNaN(price) || price <= 0) {
                fieldErrorMessage = 'El precio debe ser un número mayor a 0.';
              } else if (isNaN(stock) || stock < 0) {
                fieldErrorMessage = 'El stock no puede ser un número negativo.';
              }

              // Image matching engine
              let imagePath = '';
              let matchedFile: File | Blob | null = null;
              const imgFilenameClean = String(rawImageFilename).trim();
              let imageNotFound = false;

              if (imgFilenameClean) {
                if (imgFilenameClean.startsWith('http://') || imgFilenameClean.startsWith('https://')) {
                  imagePath = imgFilenameClean;
                } else {
                  const imgKey = imgFilenameClean.toLowerCase();
                  const matchedBlob = imagesMap[imgKey];
                  if (matchedBlob) {
                    matchedFile = matchedBlob;
                  } else {
                    imageNotFound = true;
                  }
                }
              }

              const buildProductPayload = () => ({
                sku: normalizedSku || sku.toUpperCase(),
                oem: String(row.oem || row.OEM || '').trim().toUpperCase(),
                name,
                category: String(rawCategory).trim(),
                partBrand: String(rawPartBrand).trim(),
                vehicleBrand: String(rawVehicleBrand).trim(),
                vehicleModel: String(rawVehicleModel).trim(),
                vehicleYear: Number(rawVehicleYear) || new Date().getFullYear(),
                vehicleVersion: String(rawVehicleVersion).trim(),
                price,
                stock,
                description: String(rawDescription).trim(),
                image: imagePath,
                imageFile: matchedFile,
                sourceRow: rowNum
              });

              if (skuErrorMessage) {
                errorCount++;
                localLogs.push({
                  row: rowNum,
                  sku: sku ? normalizedSku : 'VACÍO',
                  name,
                  status: 'ERROR',
                  message: skuErrorMessage,
                  // Solo se deja el producto listo para re-encolar si el resto de los datos es válido.
                  pendingProduct: fieldErrorMessage ? undefined : buildProductPayload()
                });
                continue;
              }

              if (fieldErrorMessage) {
                localLogs.push({ row: rowNum, sku, name, status: 'ERROR', message: `Fila omitida: ${fieldErrorMessage}` });
                errorCount++;
                continue;
              }

              if (imageNotFound) {
                localLogs.push({
                  row: rowNum,
                  sku: normalizedSku,
                  name,
                  status: 'WARNING',
                  message: `Imagen "${rawImageFilename}" no encontrada en la carpeta. Carga guardada sin foto.`
                });
                warningCount++;
              } else {
                localLogs.push({ row: rowNum, sku: normalizedSku, name, status: 'SUCCESS', message: 'Fila válida. Lista para cargar.' });
              }
              successCount++;

              processedProducts.push(buildProductPayload());
            }
          }

          // Sort logs: errors first, then warnings, then successes
          const sortedLogs = localLogs.sort((a, b) => {
            const score = { ERROR: 3, WARNING: 2, SUCCESS: 1 };
            return score[b.status] - score[a.status];
          });

          setLogs(sortedLogs.map((l, idx) => ({ ...l, id: `${Date.now()}-${idx}` })));
          setStats({
            success: successCount,
            warnings: warningCount,
            errors: errorCount,
          });
          setPreparedProducts(processedProducts);
          setAnalysisDone(true);
          setProgress(100);
          setProcessing(false);
        } catch (innerErr: any) {
          setLogs([{ id: 'critical-error', row: 0, sku: 'N/A', status: 'ERROR', message: `Fallo crítico de lectura: ${innerErr.message}` }]);
          setStats(s => ({ ...s, errors: 1 }));
          setProgress(100);
          setProcessing(false);
        }
      };

      if (dataFile.name.endsWith('.csv')) {
        reader.readAsText(dataFile);
      } else {
        reader.readAsArrayBuffer(dataFile);
      }
    } catch (err: any) {
      setLogs([{ id: 'process-error', row: 0, sku: 'N/A', status: 'ERROR', message: `Error en proceso: ${err.message}` }]);
      setStats(s => ({ ...s, errors: 1 }));
      setProgress(100);
      setProcessing(false);
    }
  };

  const handleStartUpload = async (productsOverride?: PreparedProduct[], genericImageSkus?: Set<string>) => {
    const productsToSave = productsOverride ?? preparedProducts;
    if (productsToSave.length === 0 || stats.errors > 0) return;

    setProcessing(true);
    const startProgress = genericImageSkus && genericImageSkus.size > 0 ? 15 : 0;
    setProgress(startProgress);

    try {
      const dbResult: BatchResult = await saveProductsBatch(productsToSave, uploadMode === 'EXPRESS_STOCK_PRICE', (percent) => {
        const mappedPercent = Math.round(startProgress + (percent * ((100 - startProgress) / 100)));
        setProgress(mappedPercent);
      });

      setSavedSkusSet(new Set(dbResult.success.map((p) => p.sku)));


      setLogs((prev) => {
        let updated = [...prev];

        dbResult.success.forEach((prod) => {
          updated = updated.map((l) => (
            l.sku === prod.sku && l.status === 'SUCCESS'
              ? {
                ...l,
                message: genericImageSkus?.has(prod.sku)
                  ? 'Producto importado con imagen genérica; sube una foto real cuando puedas.'
                  : 'Producto importado exitosamente.'
              }
              : l
          ));
        });

        dbResult.errors.forEach((err) => {
          const idx = updated.findIndex((l) => l.sku === err.sku && l.status !== 'ERROR');
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], status: 'ERROR', message: `Error al guardar en base de datos: ${err.error}` };
          } else {
            updated.push({ id: `${Date.now()}-${err.sku}`, row: err.row, sku: err.sku, status: 'ERROR', message: `Error al guardar en base de datos: ${err.error}` });
          }
        });

        return updated;
      });

      setStats((prev) => ({
        success: dbResult.success.length,
        warnings: prev.warnings,
        errors: prev.errors + dbResult.errors.length,
      }));

      const historyItem: BulkUploadHistoryItem = {
        id: `CM-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
        createdAt: new Date().toISOString(),
        total: productsToSave.length,
        success: dbResult.success.length,
        warnings: stats.warnings,
        errors: stats.errors + dbResult.errors.length,
        status: dbResult.errors.length > 0 || stats.errors > 0 ? 'CON_ERRORES' : 'COMPLETADA',
        mode: uploadMode,
        records: dbResult.success,
        genericImageSkus: genericImageSkus && genericImageSkus.size > 0
          ? dbResult.success.filter((p) => genericImageSkus.has(p.sku)).map((p) => p.sku)
          : undefined
      };
      setUploadHistory((prev) => {
        const next = [historyItem, ...prev].slice(0, 50);
        localStorage.setItem(BULK_UPLOAD_HISTORY_KEY, JSON.stringify(next));
        return next;
      });

      setUploadDone(true);
      setUploadSuccessCount(dbResult.success.length);
      setImagesModalOpen(false);
      setActiveTab('upload');
      setProgress(100);
      onUploadSuccess();
    } catch (err: any) {
      setLogs((prev) => [...prev, { id: `${Date.now()}-upload-error`, row: 0, sku: 'N/A', status: 'ERROR', message: `Error al iniciar la carga: ${err.message}` }]);
      setStats((prev) => ({ ...prev, errors: prev.errors + 1 }));
    } finally {
      setProcessing(false);
    }
  };

  // Abre el popup de asignación de imágenes antes de guardar los productos analizados
  const handleOpenImagesModal = () => {
    if (preparedProducts.length === 0 || stats.errors > 0 || processing || uploadDone) return;
    setGalleryOpenForSku(null);
    setMissingImageRows([]);
    setImagesModalOpen(true);
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

  const handleProceedUpload = async (continueWithGenericImage = false) => {
    // Guard set synchronously, before any await: handleStartUpload only
    // flips `processing` after generating generic images (an async step),
    // so a fast double-click could otherwise start saveProductsBatch twice
    // for the same batch and create duplicate products (QA-SRC-005).
    if (processing) return;

    try {
      if (currentMissingImageRows.length > 0 && !continueWithGenericImage) {
        setMissingImageRows(currentMissingImageRows);
        return;
      }

      setProcessing(true);
      setProgress(2);
      setMissingImageRows([]);

      // Force UI render tick so spinner/progress appears instantly
      await new Promise((r) => setTimeout(r, 50));

      // Track which SKUs get a generic placeholder instead of a real photo,
      // so the log/history can tell them apart afterwards (UX-SRC-007) — once
      // imageFile is set below, there's no other way to distinguish them.
      const genericImageSkus = new Set<string>();
      let finalProducts: PreparedProduct[] = [];

      if (continueWithGenericImage) {
        const total = productsWithAssignedImages.length;
        finalProducts = [];
        for (let i = 0; i < total; i++) {
          const product = productsWithAssignedImages[i];
          if (productHasImage(product)) {
            finalProducts.push(product);
          } else {
            genericImageSkus.add(product.sku);
            finalProducts.push({
              ...product,
              image: product.image || DEFAULT_PRODUCT_IMAGE_URL,
              imageFile: undefined
            });
          }
          if (i % 50 === 0 || i === total - 1) {
            setProgress(Math.round(((i + 1) / total) * 15));
            await new Promise((r) => setTimeout(r, 0));
          }
        }
      } else {
        finalProducts = productsWithAssignedImages.map((product) => (
          productHasImage(product)
            ? product
            : { ...product, image: product.image || DEFAULT_PRODUCT_IMAGE_URL, imageFile: undefined }
        ));
      }

      await handleStartUpload(finalProducts, genericImageSkus);
    } catch (err: any) {
      setLogs((prev) => [...prev, { id: `${Date.now()}-generic-image-error`, row: 0, sku: 'N/A', status: 'ERROR', message: `No se pudo generar la imagen genérica: ${err?.message || 'error desconocido'}` }]);
      setProcessing(false);
    }
  };

  // Reintenta la carga ÚNICAMENTE de los registros que resultaron con estado ERROR o fueron corregidos
  const handleRetryFailedRecords = async () => {
    if (processing || !uploadDone || (stats.errors === 0 && preparedProducts.every((p) => savedSkusSet.has(p.sku)))) return;

    // Identificar los SKUs fallidos en la lista actual de logs y aquellos no guardados aún
    const errorLogs = logs.filter((l) => l.status === 'ERROR');
    const failedSkus = new Set(errorLogs.map((l) => l.sku));

    // Filtrar los productos preparados que fallaron o no se han guardado
    const failedProducts = preparedProducts.filter((p) => failedSkus.has(p.sku) || !savedSkusSet.has(p.sku));
    if (failedProducts.length === 0) return;

    setIsRetryingFailed(true);
    setProcessing(true);
    setProgress(0);

    try {
      const dbResult: BatchResult = await saveProductsBatch(failedProducts, uploadMode === 'EXPRESS_STOCK_PRICE', (percent) => {
        setProgress(percent);
      });

      const newlySucceededSkus = new Set(dbResult.success.map((p) => p.sku));
      const newlyFailedSkus = new Set(dbResult.errors.map((e) => e.sku));

      setSavedSkusSet((prev) => {
        const next = new Set(prev);
        dbResult.success.forEach((p) => next.add(p.sku));
        return next;
      });

      // Actualizar logs: cambiar logs reintentados de ERROR a SUCCESS
      setLogs((prev) =>
        prev.map((l) => {
          if (newlySucceededSkus.has(l.sku)) {
            return {
              ...l,
              status: 'SUCCESS',
              message: 'Producto importado exitosamente tras reintento.'
            };
          }
          if (newlyFailedSkus.has(l.sku)) {
            const errObj = dbResult.errors.find((e) => e.sku === l.sku);
            return {
              ...l,
              status: 'ERROR',
              message: `Error al guardar en base de datos: ${errObj?.error || 'Error recurrente'}`
            };
          }
          return l;
        })
      );

      // Actualizar estadísticas: restar aciertos del conteo de errores y sumar a éxitos
      setStats((prev) => {
        const remainingErrors = dbResult.errors.length;
        return {
          ...prev,
          success: prev.success + dbResult.success.length,
          errors: remainingErrors
        };
      });

      setUploadSuccessCount((prev) => (prev || 0) + dbResult.success.length);
      setProgress(100);
      onUploadSuccess();
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        {
          id: `${Date.now()}-retry-error`,
          row: 0,
          sku: 'N/A',
          status: 'ERROR',
          message: `Error al reintentar la carga: ${err.message}`
        }
      ]);
    } finally {
      setProcessing(false);
      setIsRetryingFailed(false);
    }
  };

  // Row-level actions: delete a log entry, or review/fix a duplicate SKU

  const handleDeleteLog = (id: string) => {
    const target = logs.find(l => l.id === id);
    if (!target) return;
    setLogs(prev => prev.filter(l => l.id !== id));
    setStats(prev => ({
      ...prev,
      success: prev.success - (target.status === 'SUCCESS' ? 1 : 0),
      warnings: prev.warnings - (target.status === 'WARNING' ? 1 : 0),
      errors: prev.errors - (target.status === 'ERROR' ? 1 : 0),
    }));
    if (target.status !== 'ERROR') {
      // Las filas listas para cargar (éxito o con alerta) también viven en preparedProducts.
      setPreparedProducts(prev => prev.filter(p => p.sku !== target.sku));
    }
    if (reviewingLogId === id) {
      setReviewingLogId(null);
    }
  };

  const handleDeletePreparedProduct = (sku: string) => {
    const matchingLog = logs.find(l => l.sku === sku);
    if (matchingLog) {
      handleDeleteLog(matchingLog.id);
    } else {
      setPreparedProducts(prev => prev.filter(p => p.sku !== sku));
    }
  };

  const openReviewSku = (id: string) => {
    const targetLog = logs.find(l => l.id === id);
    setReviewingLogId(id);
    setReviewSkuInput(targetLog && targetLog.sku !== 'VACÍO' ? targetLog.sku : '');
    setReviewValidation({ status: 'idle', message: '' });
  };

  const closeReviewSku = () => {
    setReviewingLogId(null);
    setReviewSkuInput('');
    setReviewValidation({ status: 'idle', message: '' });
  };

  const handleValidateReviewSku = async () => {
    const trimmed = reviewSkuInput.trim();
    if (!trimmed) return;

    setReviewValidation({ status: 'checking', message: 'Verificando SKU...' });
    const normalized = trimmed.toUpperCase();
    const existingProducts = await getAllProducts();
    const existsInDb = existingProducts.some(p => p.sku.trim().toUpperCase() === normalized);

    if (existsInDb) {
      setReviewValidation({ status: 'invalid', message: `El SKU "${trimmed}" ya existe en el catálogo.` });
      return;
    }

    const currentLog = logs.find(l => l.id === reviewingLogId);
    if (!currentLog) return;

    const existsInPrepared = preparedProducts.some(
      p => p.sku.trim().toUpperCase() === normalized && p.sourceRow !== currentLog.row
    );

    if (existsInPrepared) {
      setReviewValidation({ status: 'invalid', message: `El SKU "${trimmed}" ya está en la lista para cargar.` });
      return;
    }

    if (currentLog.pendingProduct) {
      setPreparedProducts(prev => [...prev, { ...currentLog.pendingProduct!, sku: normalized }]);
    } else {
      setPreparedProducts(prev => {
        const idx = prev.findIndex(p => p.sku === currentLog.sku || (p.sourceRow && p.sourceRow === currentLog.row));
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], sku: normalized };
          return copy;
        }
        return prev;
      });
    }

    setLogs(prev => prev.map(l => l.id === reviewingLogId
      ? {
          ...l,
          sku: normalized,
          status: 'SUCCESS',
          message: `SKU corregido a "${normalized}". Listo para cargar.`,
          pendingProduct: undefined
        }
      : l
    ));

    setStats(prev => ({
      ...prev,
      errors: Math.max(0, prev.errors - 1),
      success: prev.success + 1
    }));

    setReviewValidation({ status: 'valid', message: `El SKU "${trimmed}" es válido. Registros actualizados.` });
  };

  const reviewingLog = logs.find(l => l.id === reviewingLogId) || null;


  return (
    <div className={embedded ? "bulk-upload-page" : "modal-overlay"}>
      <div
        className={embedded ? "bulk-upload-page-content" : "modal-content"}
        ref={embedded ? undefined : mainDialogRef}
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-label={embedded ? undefined : 'Cargar inventario masivo'}
        style={embedded
          ? { width: '100%', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 118px)' }
          : { maxWidth: '1240px', width: '95%', maxHeight: '92vh' }
        }
      >
        <div className="modal-header">
          <div>
            <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UploadCloud size={20} style={{ color: 'hsl(var(--primary))' }} />
              Cargar Inventario Masivo
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Vincula un archivo Excel/CSV y empareja imágenes locales en paralelo
            </p>
          </div>
          {!embedded && (
            <button className="btn-icon" onClick={onClose} disabled={processing} aria-label="Cerrar carga masiva">
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '520px', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: '1.05rem', margin: 0 }}>Historial de cargas</h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                    Registro local de las últimas cargas masivas realizadas en este navegador.
                  </p>
                </div>
              </div>

              {uploadHistory.length === 0 ? (
                <div style={{ border: '1px dashed var(--border-color)', borderRadius: '14px', minHeight: '320px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
                  <div>
                    <FileText size={34} style={{ marginBottom: '0.65rem', opacity: 0.6 }} />
                    <p style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Aún no hay cargas registradas</p>
                    <p style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Cuando completes una carga masiva, aparecerá aquí.</p>
                  </div>
                </div>
              ) : (
                <div className="log-table-container" style={{ marginTop: 0, flex: 1 }}>
                  <table className="log-table">
                    <thead>
                      <tr>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>ID carga</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Fecha</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Tipo</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Registros</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Éxito</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Fallidos</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Estado</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadHistory.map((item) => (
                        <tr key={item.id}>
                          <td style={{ padding: '0.65rem 0.75rem' }}>
                            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 700 }}>{item.id}</code>
                          </td>
                          <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            {new Date(item.createdAt).toLocaleString('es-CL')}
                          </td>
                          <td style={{ padding: '0.65rem 0.75rem' }}>
                            {item.mode === 'EXPRESS_STOCK_PRICE' ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  backgroundColor: 'rgba(16, 185, 129, 0.08)',
                                  color: '#047857',
                                  border: '1px solid rgba(16, 185, 129, 0.2)',
                                  borderRadius: '6px',
                                  padding: '0.15rem 0.45rem',
                                  fontSize: '0.68rem',
                                  fontWeight: 700
                                }}
                              >
                                <Zap size={11} />
                                Rápida
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  backgroundColor: 'rgba(59, 130, 246, 0.08)',
                                  color: '#1d4ed8',
                                  border: '1px solid rgba(59, 130, 246, 0.2)',
                                  borderRadius: '6px',
                                  padding: '0.15rem 0.45rem',
                                  fontSize: '0.68rem',
                                  fontWeight: 700
                                }}
                              >
                                <Package size={11} />
                                Completa
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', fontWeight: 700 }}>{item.total}</td>
                          <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', color: 'hsl(var(--success))', fontWeight: 800 }}>{item.success}</td>
                          <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', color: 'hsl(var(--danger))', fontWeight: 800 }}>{item.errors}</td>
                          <td style={{ padding: '0.65rem 0.75rem' }}>
                            <span
                              className="log-status-badge"
                              style={{
                                backgroundColor: item.status === 'COMPLETADA' ? 'var(--success-bg)' : 'var(--danger-bg)',
                                color: item.status === 'COMPLETADA' ? 'hsl(var(--success))' : 'hsl(var(--danger))',
                                padding: '0.2rem 0.45rem',
                                fontSize: '0.66rem'
                              }}
                            >
                              {item.status === 'COMPLETADA' ? 'COMPLETADA' : 'CON ERRORES'}
                            </span>
                          </td>
                          <td style={{ padding: '0.65rem 0.75rem' }}>
                            <button
                              type="button"
                              className="btn-icon"
                              title="Ver registros cargados"
                              aria-label={`Ver registros de la carga ${item.id}`}
                              onClick={() => setSelectedHistoryItem(item)}
                              style={{ color: 'hsl(var(--primary))' }}
                            >
                              <Eye size={17} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : imagesModalOpen ? (() => {
            const totalImagesPages = Math.ceil(preparedProducts.length / imagesPageSize) || 1;
            const safeImagesPage = Math.min(Math.max(1, imagesCurrentPage), totalImagesPages);
            const startIndex = (safeImagesPage - 1) * imagesPageSize;
            const endIndex = Math.min(startIndex + imagesPageSize, preparedProducts.length);
            const paginatedPreparedProducts = preparedProducts.slice(startIndex, endIndex);

            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '560px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                    {uploadMode === 'EXPRESS_STOCK_PRICE' ? (
                      <>
                        <Zap size={18} style={{ color: 'hsl(var(--success))' }} />
                        Confirmar Actualización de Precios y Stock
                      </>
                    ) : (
                      <>
                        <Images size={18} style={{ color: 'hsl(var(--primary))' }} />
                        Asignar Imágenes a Productos
                      </>
                    )}
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                    {uploadMode === 'EXPRESS_STOCK_PRICE'
                      ? 'Revisa los valores de precio y stock que serán actualizados en tu inventario. Los cambios se aplicarán al confirmar.'
                      : `Puedes seleccionar hasta ${MAX_IMAGES_PER_PRODUCT} imágenes por producto desde tu carpeta cargada.`}
                  </p>
                </div>

                {preparedProducts.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                    {/* Leyenda sutil de color amarillo - Solo se muestra en Publicación Completa */}
                    {uploadMode === 'FULL_CREATION' && (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          background: '#fff8db',
                          border: '1px solid #facc15',
                          borderRadius: '8px',
                          padding: '0.3rem 0.65rem',
                          fontSize: '0.74rem',
                          color: '#92400e',
                          fontWeight: 700
                        }}
                        title="Los productos resaltados en amarillo corresponden a aquellos que no tienen una foto real asignada"
                      >
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
                        <span>Filas en amarillo = Sin foto asignada</span>
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Mostrar:</span>
                      <select
                        value={imagesPageSize}
                        onChange={(e) => setImagesPageSize(Number(e.target.value))}
                        style={{
                          padding: '0.35rem 0.65rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-card)',
                          color: 'var(--text-primary)',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        <option value={15}>15 registros</option>
                        <option value={50}>50 registros</option>
                        <option value={100}>100 registros</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Mostrando <strong>{preparedProducts.length > 0 ? startIndex + 1 : 0}-{endIndex}</strong> de <strong>{preparedProducts.length}</strong>
                      </span>
                      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', height: 'auto' }}
                          disabled={safeImagesPage <= 1 || processing}
                          onClick={() => setImagesCurrentPage((p) => Math.max(1, p - 1))}
                        >
                          Anterior
                        </button>
                        <span style={{ fontSize: '0.78rem', padding: '0 0.4rem', fontWeight: 700, color: 'hsl(var(--primary))' }}>
                          Pág. {safeImagesPage} / {totalImagesPages}
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', height: 'auto' }}
                          disabled={safeImagesPage >= totalImagesPages || processing}
                          onClick={() => setImagesCurrentPage((p) => Math.min(totalImagesPages, p + 1))}
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Banner de ayuda visual para el vendedor */}
              {uploadMode === 'FULL_CREATION' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    background: 'rgba(27, 100, 218, 0.06)',
                    border: '1px solid rgba(27, 100, 218, 0.2)',
                    borderRadius: '12px',
                    padding: '0.75rem 1rem'
                  }}
                >
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'hsl(var(--primary))',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <ImageUp size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)', display: 'block' }}>
                      💡 ¿Cómo asignar fotos a cada producto?
                    </span>
                    <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                      Haz clic en el botón azul <strong>"+ Asignar foto"</strong> en la columna <strong>Imágenes</strong> de cada producto para abrir la galería de fotos cargadas. <em>(Nota: Las filas destacadas en 🟡 amarillo indican repuestos sin foto asignada)</em>.
                    </span>
                  </div>
                </div>
              )}


              {uploadMode === 'FULL_CREATION' && Object.keys(availableImages).length === 0 && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>
                  No hay imágenes cargadas en la carpeta. Puedes iniciar la carga sin fotos.
                </p>
              )}





              {/* Barra de desplazamiento horizontal superior sincronizada */}
              <div
                ref={topScrollRef}
                onScroll={handleTopScroll}
                style={{
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  width: '100%',
                  height: '14px',
                  marginBottom: '0.15rem'
                }}
              >
                <div style={{ width: `${tableScrollWidth}px`, height: '1px' }} />
              </div>

              <div
                ref={tableContainerRef}
                onScroll={handleTableScroll}
                style={{
                  overflow: 'auto',
                  maxHeight: 'calc(100vh - 310px)',
                  minHeight: '380px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  flex: 1
                }}
              >
                <table ref={tableRef} className="log-table" style={{ width: '100%' }}>
                  <thead style={{ background: 'var(--bg-card)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <tr>
                      <th style={{ width: '72px', padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Fila</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>SKU</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>OEM</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Nombre</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Categoría</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Marca Repuesto</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Marca Vehículo</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Modelo Vehículo</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Año Vehículo</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Versión Vehículo</th>
                      <th style={{
                        padding: '0.5rem 0.75rem',
                        fontSize: '0.7rem',
                        whiteSpace: 'nowrap',
                        background: uploadMode === 'EXPRESS_STOCK_PRICE' ? 'rgba(16, 185, 129, 0.12)' : undefined,
                        color: uploadMode === 'EXPRESS_STOCK_PRICE' ? '#047857' : undefined,
                        fontWeight: uploadMode === 'EXPRESS_STOCK_PRICE' ? 800 : undefined
                      }}>Precio</th>
                      <th style={{
                        padding: '0.5rem 0.75rem',
                        fontSize: '0.7rem',
                        whiteSpace: 'nowrap',
                        background: uploadMode === 'EXPRESS_STOCK_PRICE' ? 'rgba(16, 185, 129, 0.12)' : undefined,
                        color: uploadMode === 'EXPRESS_STOCK_PRICE' ? '#047857' : undefined,
                        fontWeight: uploadMode === 'EXPRESS_STOCK_PRICE' ? 800 : undefined
                      }}>Stock</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Descripción</th>
                      {uploadMode === 'FULL_CREATION' && (
                        <th className="sticky-images" style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Imágenes</th>
                      )}
                      <th className="sticky-action" style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', textAlign: 'center', whiteSpace: 'nowrap' }}>Acción</th>
                    </tr>
                  </thead>

                  <tbody>
                    {paginatedPreparedProducts.map((product, pIndex) => {
                      const actualRowNumber = startIndex + pIndex + 1;
                      const selected = imageAssignments[product.sku] || [];
                      const isGalleryOpen = galleryOpenForSku === product.sku;
                      const isMissingImageHighlighted = highlightedMissingImageSkus.has(product.sku);
                      return (
                        <React.Fragment key={product.sku}>
                          <tr
                            className={isMissingImageHighlighted ? "missing-image-row" : ""}
                            style={{
                              background: isMissingImageHighlighted ? '#fff8db' : undefined,
                              boxShadow: isMissingImageHighlighted ? 'inset 4px 0 0 #f59e0b' : undefined
                            }}
                          >
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  color: isMissingImageHighlighted ? '#92400e' : 'var(--text-secondary)',
                                  background: isMissingImageHighlighted ? '#fef3c7' : 'var(--bg-app)',
                                  padding: '0.15rem 0.4rem',
                                  borderRadius: '999px',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {actualRowNumber}
                              </span>
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600 }}>{product.sku}</code>
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{product.oem || '—'}</td>
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem' }}>{product.name}</td>
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{product.category || '—'}</td>
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{product.partBrand || '—'}</td>
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{product.vehicleBrand || '—'}</td>
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{product.vehicleModel || '—'}</td>
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{product.vehicleYear || '—'}</td>
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{product.vehicleVersion || '—'}</td>
                            <td style={{
                              padding: '0.5rem 0.75rem',
                              fontSize: '0.78rem',
                              whiteSpace: 'nowrap',
                              background: uploadMode === 'EXPRESS_STOCK_PRICE' ? 'rgba(16, 185, 129, 0.08)' : undefined,
                              color: uploadMode === 'EXPRESS_STOCK_PRICE' ? '#047857' : undefined,
                              fontWeight: uploadMode === 'EXPRESS_STOCK_PRICE' ? 800 : undefined
                            }}>${product.price?.toLocaleString('es-CL')}</td>
                            <td style={{
                              padding: '0.5rem 0.75rem',
                              fontSize: '0.78rem',
                              whiteSpace: 'nowrap',
                              background: uploadMode === 'EXPRESS_STOCK_PRICE' ? 'rgba(16, 185, 129, 0.08)' : undefined,
                              color: uploadMode === 'EXPRESS_STOCK_PRICE' ? '#047857' : undefined,
                              fontWeight: uploadMode === 'EXPRESS_STOCK_PRICE' ? 800 : undefined
                            }}>{product.stock}</td>
                             <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={product.description}>
                              {product.description || '—'}
                            </td>
                            {uploadMode === 'FULL_CREATION' && (
                              <td className="sticky-images" style={{ padding: '0.5rem 0.75rem' }}>
                                <button
                                  type="button"
                                  onClick={() => setGalleryOpenForSku(isGalleryOpen ? null : product.sku)}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                    padding: '0.3rem 0.6rem',
                                    borderRadius: '8px',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    border: isGalleryOpen
                                      ? '1px solid hsl(var(--primary))'
                                      : isMissingImageHighlighted
                                      ? '1px solid #facc15'
                                      : selected.length > 0
                                      ? '1px solid rgba(16, 185, 129, 0.4)'
                                      : '1px solid hsl(var(--primary) / 0.4)',
                                    background: isGalleryOpen
                                      ? 'hsl(var(--primary))'
                                      : isMissingImageHighlighted
                                      ? '#fef3c7'
                                      : selected.length > 0
                                      ? 'var(--success-bg)'
                                      : 'rgba(27, 100, 218, 0.08)',
                                    color: isGalleryOpen
                                      ? '#ffffff'
                                      : isMissingImageHighlighted
                                      ? '#92400e'
                                      : selected.length > 0
                                      ? 'hsl(var(--success))'
                                      : 'hsl(var(--primary))',
                                    boxShadow: isGalleryOpen ? '0 2px 6px rgba(27, 100, 218, 0.25)' : 'none',
                                    transition: 'all 0.15s ease'
                                  }}
                                  title="Haz clic para abrir la galería de fotos y seleccionar imágenes para este producto"
                                >
                                  <ImageUp size={14} />
                                  <span>
                                    {isMissingImageHighlighted
                                      ? 'Asignar foto'
                                      : selected.length > 0
                                      ? `${selected.length}/${MAX_IMAGES_PER_PRODUCT} fotos`
                                      : '+ Asignar foto'}
                                  </span>
                                </button>
                              </td>
                            )}

                            <td className="sticky-action" style={{ padding: '0.5rem 0.75rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <button
                                  type="button"
                                  title="Quitar registro"
                                  onClick={() => handleDeletePreparedProduct(product.sku)}
                                  style={{
                                    border: 'none',
                                    background: 'rgba(239, 68, 68, 0.08)',
                                    color: 'hsl(var(--danger))',
                                    borderRadius: '6px',
                                    width: '30px',
                                    height: '30px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    flexShrink: 0
                                  }}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isGalleryOpen && (
                            <tr>
                              <td className="gallery-row-cell" colSpan={15} style={{ paddingTop: '0.75rem', paddingBottom: '1.25rem', paddingLeft: '1rem', background: 'var(--bg-app)' }}>
                                {Object.keys(availableImages).length === 0 ? (
                                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No hay imágenes disponibles en la carpeta cargada.</p>
                                ) : (
                                  <>
                                    <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                      Selecciona hasta {MAX_IMAGES_PER_PRODUCT} imágenes para <strong>{product.sku}</strong>. Haz clic para marcar o desmarcar.
                                    </p>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '0.6rem' }}>
                                      {Object.keys(availableImages).map((filename) => {
                                        const isSelected = selected.includes(filename);
                                        const limitReached = !isSelected && selected.length >= MAX_IMAGES_PER_PRODUCT;
                                        return (
                                          <div
                                            key={filename}
                                            onClick={() => !limitReached && toggleImageSelection(product.sku, filename)}
                                            title={limitReached ? `Máximo ${MAX_IMAGES_PER_PRODUCT} imágenes por producto` : filename}
                                            style={{
                                              position: 'relative',
                                              border: isSelected ? '2px solid hsl(var(--primary))' : '1px solid var(--border-color)',
                                              borderRadius: '10px',
                                              overflow: 'hidden',
                                              cursor: limitReached ? 'not-allowed' : 'pointer',
                                              opacity: limitReached ? 0.4 : 1,
                                              background: 'var(--bg-card)',
                                              transition: 'all 0.15s ease'
                                            }}
                                          >
                                            <img
                                              src={imageObjectUrls[filename]}
                                              alt={filename}
                                              style={{ width: '100%', height: '72px', objectFit: 'cover', display: 'block' }}
                                            />
                                            {isSelected && (
                                              <div
                                                style={{
                                                  position: 'absolute',
                                                  top: 4,
                                                  right: 4,
                                                  background: 'hsl(var(--primary))',
                                                  color: '#fff',
                                                  borderRadius: '50%',
                                                  width: 20,
                                                  height: 20,
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  justifyContent: 'center',
                                                  boxShadow: '0 1px 4px rgba(0,0,0,0.25)'
                                                }}
                                              >
                                                <CheckCircle2 size={14} />
                                              </div>
                                            )}
                                            <span
                                              style={{
                                                fontSize: '0.6rem',
                                                display: 'block',
                                                padding: '0.2rem 0.3rem',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                color: 'var(--text-secondary)'
                                              }}
                                            >
                                              {filename}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {preparedProducts.length > imagesPageSize && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Mostrando <strong>{startIndex + 1}-{endIndex}</strong> de <strong>{preparedProducts.length}</strong> productos
                  </span>
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', height: 'auto' }}
                      disabled={safeImagesPage <= 1 || processing}
                      onClick={() => setImagesCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      Anterior
                    </button>
                    <span style={{ fontSize: '0.75rem', padding: '0 0.5rem', fontWeight: 700, color: 'hsl(var(--primary))' }}>
                      Página {safeImagesPage} de {totalImagesPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', height: 'auto' }}
                      disabled={safeImagesPage >= totalImagesPages || processing}
                      onClick={() => setImagesCurrentPage((p) => Math.min(totalImagesPages, p + 1))}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>
            );
          })() : (

          <div className="bulk-upload-split-layout">
            
            {/* Left Panel: Uploading and template downloads */}
            <div className={`bulk-upload-left-panel ${uploadMode === 'EXPRESS_STOCK_PRICE' ? 'express-theme' : ''}`}>
              {/* Mode Switcher Tabs */}
              <div className="bulk-mode-selector">
                <button
                  type="button"
                  className={`bulk-mode-tab ${uploadMode === 'FULL_CREATION' ? 'active-full' : ''}`}
                  onClick={() => {
                    setUploadMode('FULL_CREATION');
                    setDataFile(null);
                    setLogs([]);
                    setPreparedProducts([]);
                    setAnalysisDone(false);
                  }}
                  disabled={processing}
                >
                  <Package size={15} />
                  <span>Publicación Completa</span>
                </button>
                <button
                  type="button"
                  className={`bulk-mode-tab ${uploadMode === 'EXPRESS_STOCK_PRICE' ? 'active-express' : ''}`}
                  onClick={() => {
                    setUploadMode('EXPRESS_STOCK_PRICE');
                    setDataFile(null);
                    setLogs([]);
                    setPreparedProducts([]);
                    setAnalysisDone(false);
                  }}
                  disabled={processing}
                >
                  <Zap size={15} />
                  <span>Actualización Rápida</span>
                </button>
              </div>

              {/* Template Download Banner */}
              <div style={{
                background: uploadMode === 'EXPRESS_STOCK_PRICE' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(99, 102, 241, 0.04)',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: uploadMode === 'EXPRESS_STOCK_PRICE' ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem'
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <h4 style={{ fontSize: '0.825rem', fontWeight: 700, color: uploadMode === 'EXPRESS_STOCK_PRICE' ? '#047857' : 'inherit' }}>
                      {uploadMode === 'EXPRESS_STOCK_PRICE' ? 'Plantilla Expresa (3 Cols)' : 'Plantilla Oficial (13 Cols)'}
                    </h4>
                    {uploadMode === 'EXPRESS_STOCK_PRICE' && (
                      <span className="express-badge"><Zap size={11} /> Expreso</span>
                    )}
                  </div>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    {uploadMode === 'EXPRESS_STOCK_PRICE'
                      ? 'Ajuste veloz de stock y precio CLP por SKU (3 columnas).'
                      : 'Formato completo con OEM, vehículos, fotos y columna URL_Foto.'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.65rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', flex: 1, justifyContent: 'center' }}
                    onClick={() => downloadTemplate('xlsx')}
                  >
                    <FileSpreadsheet size={13} style={{ color: '#107c41' }} />
                    Excel
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.65rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', flex: 1, justifyContent: 'center' }}
                    onClick={() => downloadTemplate('csv')}
                  >
                    <FileText size={13} style={{ color: 'hsl(var(--primary))' }} />
                    CSV
                  </button>
                </div>
              </div>

              {/* Horizontal Dropzones Container */}
              <div className="dropzones-horizontal-container" style={{
                display: 'grid',
                gridTemplateColumns: uploadMode === 'EXPRESS_STOCK_PRICE' ? '1fr' : '1fr 1fr',
                gap: '1rem'
              }}>
                {/* Input 1: CSV/Excel Data */}
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: '0.72rem', marginBottom: '0.35rem', display: 'block' }}>1. Datos (.csv, .xlsx)</label>
                  <label className={`dropzone compact ${dataFile ? 'active' : ''}`}>
                    <input
                      type="file"
                      ref={dataFileInputRef}
                      accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                      style={{ display: 'none' }}
                      onChange={(e) => setDataFile(e.target.files?.[0] || null)}
                      disabled={processing}
                    />
                    <FileSpreadsheet size={24} className="dropzone-icon" />
                    <span className="dropzone-title">Fila Productos</span>
                    <span className="dropzone-desc">Arrastra o sube tu plantilla</span>
                    {dataFile && (
                      <div className="file-selected-badge" style={{ marginTop: '0.25rem', maxWidth: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', fontSize: '0.72rem' }} title={dataFile.name}>
                          {dataFile.name}
                        </span>
                      </div>
                    )}
                  </label>
                </div>

                {/* Input 2: Folder or ZIP files */}
                {uploadMode === 'FULL_CREATION' && (
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', height: '15px' }}>
                      <label className="form-label" style={{ margin: 0, fontSize: '0.72rem' }}>2. Fotos</label>
                      <div style={{ display: 'flex', gap: '2px', background: 'var(--border-color)', padding: '1px', borderRadius: '4px' }}>
                        <button
                          type="button"
                          style={{ border: 'none', background: imageSource === 'FOLDER' ? 'var(--bg-sidebar)' : 'transparent', fontSize: '0.6rem', padding: '0.1rem 0.25rem', borderRadius: '3px', cursor: 'pointer', fontWeight: 600 }}
                          onClick={() => { setImageSource('FOLDER'); setImageZipFile(null); }}
                          disabled={processing}
                        >
                          Carpeta
                        </button>
                        <button
                          type="button"
                          style={{ border: 'none', background: imageSource === 'ZIP' ? 'var(--bg-sidebar)' : 'transparent', fontSize: '0.6rem', padding: '0.1rem 0.25rem', borderRadius: '3px', cursor: 'pointer', fontWeight: 600 }}
                          onClick={() => { setImageSource('ZIP'); setImageFolderFiles(null); }}
                          disabled={processing}
                        >
                          ZIP
                        </button>
                      </div>
                    </div>

                    {imageSource === 'FOLDER' ? (
                      <div
                        className={`dropzone compact ${imageFolderFiles ? 'active' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={handlePickFolder}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handlePickFolder();
                          }
                        }}
                        style={{ cursor: processing ? 'not-allowed' : 'pointer' }}
                      >
                        <input
                          type="file"
                          ref={folderInputRef}
                          multiple
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const files = e.target.files;
                            if (files && files.length > 0) {
                              setImageFolderFiles(files);
                            } else {
                              setImageFolderFiles(null);
                            }
                          }}
                          disabled={processing}
                          {...({
                            webkitdirectory: '',
                            directory: '',
                          } as any)}
                        />
                        <FolderOpen size={24} className="dropzone-icon" style={{ color: 'hsl(var(--accent))' }} />
                        <span className="dropzone-title">Carpeta Local</span>
                        <span className="dropzone-desc">Sube carpeta con fotos</span>
                        {imageFolderFiles && imageFolderFiles.length > 0 && (
                          <div className="file-selected-badge" style={{ marginTop: '0.25rem', background: 'rgba(6, 182, 212, 0.1)', color: 'hsl(var(--accent))', borderColor: 'rgba(6, 182, 212, 0.2)', maxWidth: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', fontSize: '0.72rem' }}>
                              {imageFolderFiles.length} imágenes
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <label className={`dropzone compact ${imageZipFile ? 'active' : ''}`}>
                        <input
                          type="file"
                          ref={zipInputRef}
                          accept=".zip"
                          style={{ display: 'none' }}
                          onChange={(e) => setImageZipFile(e.target.files?.[0] || null)}
                          disabled={processing}
                        />
                        <UploadCloud size={24} className="dropzone-icon" style={{ color: 'hsl(var(--accent))' }} />
                        <span className="dropzone-title">Archivo ZIP</span>
                        <span className="dropzone-desc">Sube archivo ZIP con fotos</span>
                        {imageZipFile && (
                          <div className="file-selected-badge" style={{ marginTop: '0.25rem', background: 'rgba(6, 182, 212, 0.1)', color: 'hsl(var(--accent))', borderColor: 'rgba(6, 182, 212, 0.2)', maxWidth: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', fontSize: '0.72rem' }} title={imageZipFile.name}>
                              {imageZipFile.name}
                            </span>
                          </div>
                        )}
                      </label>
                    )}
                  </div>
                )}
              </div>

              {/* Action trigger button */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem' }}
                  disabled={
                    !dataFile ||
                    processing ||
                    (uploadMode === 'FULL_CREATION' && (
                      (imageSource === 'FOLDER' && !imageFolderFiles) ||
                      (imageSource === 'ZIP' && !imageZipFile)
                    ))
                  }
                  onClick={handleAnalyze}
                >
                  {processing ? (
                    <>
                      <RefreshCw className="spin" size={16} />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      Analizar Carga
                    </>
                  )}
                </button>

                {/* Progress bar */}
                {(processing || progress > 0) && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      <span>Progreso</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="import-progress-bar" style={{ margin: '0.35rem 0 0 0', height: '6px', borderRadius: '99px', overflow: 'hidden', backgroundColor: 'rgba(0, 0, 0, 0.08)' }}>
                      <div className="import-progress-fill" style={{ width: `${progress}%`, height: '100%', backgroundColor: 'hsl(var(--primary))', borderRadius: '99px', transition: 'width 0.3s ease' }}></div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Analysis & logs */}
            <div className="bulk-upload-right-panel">
              {logs.length === 0 && !processing && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '350px', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem', border: '1px dashed var(--border-color)', borderRadius: '16px', background: 'rgba(255, 255, 255, 0.01)' }}>
                  <UploadCloud size={40} style={{ strokeWidth: 1.2, color: 'var(--text-muted)', opacity: 0.5, marginBottom: '0.75rem' }} />
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Análisis Post Carga</h4>
                  <p style={{ fontSize: '0.72rem', maxWidth: '280px', lineHeight: 1.4, color: 'var(--text-muted)' }}>
                    Completa la carga de archivos a la izquierda y ejecuta "Analizar Carga" para desplegar el análisis de registros y errores aquí.
                  </p>
                </div>
              )}

              {processing && logs.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '350px', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem', border: '1px dashed var(--border-color)', borderRadius: '16px', background: 'rgba(255, 255, 255, 0.01)' }}>
                  <RefreshCw className="spin" size={32} style={{ color: 'hsl(var(--primary))', marginBottom: '0.75rem' }} />
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Procesando catálogo...</h4>
                  <p style={{ fontSize: '0.72rem', maxWidth: '280px', lineHeight: 1.4, color: 'var(--text-muted)' }}>
                    Analizando registros de la plantilla, verificando SKU repetidos y emparejando archivos multimedia.
                  </p>
                </div>
              )}

              {logs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  {uploadDone && uploadSuccessCount !== null && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        background: 'var(--success-bg)',
                        color: 'hsl(var(--success))',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '10px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        marginBottom: '0.85rem'
                      }}
                    >
                      <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                      ¡Carga completada! {uploadSuccessCount} {uploadSuccessCount === 1 ? 'producto se cargó' : 'productos se cargaron'} exitosamente al inventario.
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>Resumen del Procesamiento</h4>
                    {logFilter !== 'ALL' && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setLogFilter('ALL')}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', height: 'auto' }}
                      >
                        Ver todos ({logs.length})
                      </button>
                    )}
                  </div>

                  <div className="report-summary-cards" style={{ margin: '0 0 1rem 0', gap: '0.75rem' }}>
                    <div
                      className={`summary-card summary-card-success ${logFilter === 'SUCCESS' ? 'active' : ''}`}
                      onClick={() => setLogFilter((prev) => (prev === 'SUCCESS' ? 'ALL' : 'SUCCESS'))}
                      style={{ padding: '0.75rem 0.5rem', borderRadius: '12px', cursor: 'pointer' }}
                      title="Haz clic para filtrar por registros exitosos"
                    >
                      <div className="summary-num" style={{ fontSize: '1.45rem' }}>{stats.success}</div>
                      <div className="summary-txt" style={{ fontSize: '0.62rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                        Éxito {logFilter === 'SUCCESS' && <CheckCircle2 size={11} />}
                      </div>
                    </div>

                    <div
                      className={`summary-card summary-card-warning ${logFilter === 'WARNING' ? 'active' : ''}`}
                      onClick={() => setLogFilter((prev) => (prev === 'WARNING' ? 'ALL' : 'WARNING'))}
                      style={{ padding: '0.75rem 0.5rem', borderRadius: '12px', cursor: 'pointer' }}
                      title="Haz clic para filtrar por registros con alertas"
                    >
                      <div className="summary-num" style={{ fontSize: '1.45rem' }}>{stats.warnings}</div>
                      <div className="summary-txt" style={{ fontSize: '0.62rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                        Alertas {logFilter === 'WARNING' && <CheckCircle2 size={11} />}
                      </div>
                    </div>

                    <div
                      className={`summary-card summary-card-danger ${logFilter === 'ERROR' ? 'active' : ''}`}
                      onClick={() => setLogFilter((prev) => (prev === 'ERROR' ? 'ALL' : 'ERROR'))}
                      style={{ padding: '0.75rem 0.5rem', borderRadius: '12px', cursor: 'pointer' }}
                      title="Haz clic para filtrar únicamente los registros fallidos"
                    >
                      <div className="summary-num" style={{ fontSize: '1.45rem' }}>{stats.errors}</div>
                      <div className="summary-txt" style={{ fontSize: '0.62rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                        Fallidos {logFilter === 'ERROR' && <CheckCircle2 size={11} />}
                      </div>
                    </div>
                  </div>

                  {uploadDone && stats.errors > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        background: '#fff8db',
                        border: '1px solid #facc15',
                        borderLeft: '4px solid #f59e0b',
                        borderRadius: '10px',
                        padding: '0.85rem 1rem',
                        marginBottom: '1rem',
                        flexWrap: 'wrap'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <AlertTriangle size={20} style={{ color: '#b45309', flexShrink: 0 }} />
                        <div>
                          <span style={{ fontSize: '0.82rem', color: '#92400e', fontWeight: 800, display: 'block' }}>
                            {stats.errors} {stats.errors === 1 ? 'registro no se pudo guardar' : 'registros no se pudieron guardar'} en la base de datos
                          </span>
                          <span style={{ fontSize: '0.74rem', color: '#92400e' }}>
                            Puedes hacer clic en el botón para reintentar cargar únicamente las filas con fallos.
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleRetryFailedRecords}
                        disabled={processing}
                        style={{
                          background: '#d97706',
                          borderColor: '#d97706',
                          color: '#ffffff',
                          fontSize: '0.78rem',
                          padding: '0.45rem 0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: '0 2px 6px rgba(217, 119, 6, 0.25)',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <RefreshCw size={15} className={processing ? 'spin' : ''} />
                        Reintentar Carga de {stats.errors} Fallidos
                      </button>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <h5 style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Detalle del Procesamiento
                      </h5>
                      {logFilter !== 'ALL' && (
                        <span
                          style={{
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            padding: '0.12rem 0.45rem',
                            borderRadius: '99px',
                            background: logFilter === 'ERROR' ? 'var(--danger-bg)' : logFilter === 'WARNING' ? 'var(--warning-bg)' : 'var(--success-bg)',
                            color: logFilter === 'ERROR' ? 'hsl(var(--danger))' : logFilter === 'WARNING' ? 'hsl(var(--warning))' : 'hsl(var(--success))',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}
                        >
                          Filtro: {logFilter === 'ERROR' ? 'Fallidos' : logFilter === 'WARNING' ? 'Alertas' : 'Éxito'}
                          <button
                            type="button"
                            onClick={() => setLogFilter('ALL')}
                            style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, fontWeight: 800, fontSize: '0.75rem', lineHeight: 1 }}
                            title="Quitar filtro"
                          >
                            ×
                          </button>
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {stats.errors > 0 && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={handleExportErrors}
                          style={{ padding: '0.2rem 0.55rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.3rem', height: 'auto' }}
                          title="Descargar reporte Excel con las filas fallidas y sus motivos de error"
                        >
                          <Download size={13} style={{ color: 'hsl(var(--danger))' }} />
                          Exportar Errores (.xlsx)
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Search Bar for logs */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.65rem', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Buscar por SKU, repuesto o detalle de error..."
                        value={logSearchQuery}
                        onChange={(e) => setLogSearchQuery(e.target.value)}
                        style={{ paddingLeft: '2rem', height: '32px', fontSize: '0.75rem' }}
                      />
                      {logSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setLogSearchQuery('')}
                          style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700 }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      Mostrando {filteredLogs.length} de {logs.length}
                    </span>
                  </div>

                  <div className="log-table-container" style={{ flexGrow: 1, marginTop: 0 }}>
                    <table className="log-table">
                      <thead>
                        <tr>
                          <th style={{ width: '90px', padding: '0.5rem 0.75rem', fontSize: '0.7rem' }}>Fila Excel</th>
                          <th style={{ width: '120px', padding: '0.5rem 0.75rem', fontSize: '0.7rem' }}>SKU</th>
                          <th style={{ width: '90px', padding: '0.5rem 0.75rem', fontSize: '0.7rem' }}>Estado</th>
                          <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem' }}>Detalle / Error</th>
                          <th style={{ width: '110px', padding: '0.5rem 0.75rem', fontSize: '0.7rem', textAlign: 'center' }}>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedLogs.map((log) => {
                          let bgRow = '';
                          let borderLeft = '';
                          let iconColor = '';
                          let IconComponent = CheckCircle2;

                          if (log.status === 'SUCCESS') {
                            bgRow = 'rgba(16, 185, 129, 0.015)';
                            borderLeft = '3px solid hsl(var(--success))';
                            iconColor = 'hsl(var(--success))';
                            IconComponent = CheckCircle2;
                          } else if (log.status === 'WARNING') {
                            bgRow = 'rgba(245, 158, 11, 0.025)';
                            borderLeft = '3px solid hsl(var(--warning))';
                            iconColor = 'hsl(var(--warning))';
                            IconComponent = AlertTriangle;
                          } else {
                            bgRow = 'rgba(239, 68, 68, 0.025)';
                            borderLeft = '3px solid hsl(var(--danger))';
                            iconColor = 'hsl(var(--danger))';
                            IconComponent = XCircle;
                          }

                          return (
                            <tr key={log.id} style={{ backgroundColor: bgRow, borderLeft: borderLeft }}>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                <span style={{ fontSize: '0.68rem', background: 'var(--bg-app)', padding: '0.15rem 0.35rem', borderRadius: '4px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                  {log.row === 0 ? 'Sistema' : `Fila ${log.row}`}
                                </span>
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600, color: log.status === 'ERROR' ? 'hsl(var(--danger))' : 'inherit' }}>
                                  {log.sku}
                                </code>
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                {log.status === 'SUCCESS' && (
                                  <span className="log-status-badge" style={{ backgroundColor: 'var(--success-bg)', color: 'hsl(var(--success))', padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}>
                                    ÉXITO
                                  </span>
                                )}
                                {log.status === 'WARNING' && (
                                  <span className="log-status-badge" style={{ backgroundColor: 'var(--warning-bg)', color: 'hsl(var(--warning))', padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}>
                                    ALERTA
                                  </span>
                                )}
                                {log.status === 'ERROR' && (
                                  <span className="log-status-badge" style={{ backgroundColor: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}>
                                    FALLIDO
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: log.status === 'ERROR' ? 'hsl(var(--danger))' : 'inherit', fontWeight: log.status === 'ERROR' ? 600 : 500 }}>
                                  <IconComponent size={13} style={{ color: iconColor, flexShrink: 0 }} />
                                  <span style={{ fontSize: '0.74rem', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.3 }}>{log.message}</span>
                                </div>
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                                  {(log.status === 'ERROR' || isSkuIssueLog(log)) && (
                                    <button
                                      type="button"
                                      title="Modificar SKU para reintentar la carga"
                                      onClick={() => openReviewSku(log.id)}
                                      style={{
                                        border: '1px solid rgba(37, 99, 235, 0.2)',
                                        background: 'rgba(37, 99, 235, 0.08)',
                                        color: 'hsl(var(--primary))',
                                        borderRadius: '6px',
                                        padding: '0.2rem 0.4rem',
                                        height: '26px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        cursor: 'pointer',
                                        fontSize: '0.68rem',
                                        fontWeight: 700,
                                        whiteSpace: 'nowrap'
                                      }}
                                    >
                                      <Pencil size={12} />
                                      <span>Editar</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    title="Eliminar registro del reporte"
                                    onClick={() => handleDeleteLog(log.id)}
                                    style={{
                                      border: 'none',
                                      background: 'rgba(239, 68, 68, 0.08)',
                                      color: 'hsl(var(--danger))',
                                      borderRadius: '6px',
                                      width: '26px',
                                      height: '26px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                      flexShrink: 0
                                    }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {filteredLogs.length > logPageSize && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', marginTop: '0.25rem', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        Mostrando <strong>{(logPage - 1) * logPageSize + 1}-{Math.min(logPage * logPageSize, filteredLogs.length)}</strong> de <strong>{filteredLogs.length}</strong> logs
                      </span>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', height: 'auto' }}
                          disabled={logPage <= 1}
                          onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                        >
                          Anterior
                        </button>
                        <span style={{ fontSize: '0.72rem', padding: '0 0.4rem', fontWeight: 700, color: 'hsl(var(--primary))' }}>
                          Página {logPage} de {totalLogPages}
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', height: 'auto' }}
                          disabled={logPage >= totalLogPages}
                          onClick={() => setLogPage((p) => Math.min(totalLogPages, p + 1))}
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
          )}
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', padding: '1.25rem 2rem' }}>
          {activeTab === 'history' ? (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setActiveTab('upload')}>
                Nueva carga
              </button>
            </>
          ) : imagesModalOpen ? (
            missingImageRows.length > 0 ? (
              <>
                <button type="button" className="btn btn-secondary" style={{ marginRight: 'auto' }} onClick={() => setMissingImageRows([])}>
                  Volver a asignar
                </button>
                <button type="button" className="btn btn-primary" onClick={() => handleProceedUpload(true)} disabled={processing}>
                  Continuar con imagen genérica
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-secondary" style={{ marginRight: 'auto' }} onClick={() => { setImagesModalOpen(false); setMissingImageRows([]); }}>
                  Volver
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleProceedUpload()}
                  disabled={processing}
                  style={currentMissingImageRows.length > 0 ? {
                    background: 'hsl(var(--danger))',
                    borderColor: 'hsl(var(--danger))',
                    color: '#fff',
                    boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.15)'
                  } : undefined}
                  title={currentMissingImageRows.length > 0 ? 'Hay filas sin imagen. Presiona para revisar la alerta antes de cargar.' : undefined}
                >
                  Confirmar y Cargar
                </button>
              </>
            )
          ) : (
            <>
              {(dataFile || imageFolderFiles || imageZipFile || logs.length > 0) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginRight: 'auto', background: 'rgba(239, 68, 68, 0.05)', color: 'hsl(var(--danger))', borderColor: 'rgba(239, 68, 68, 0.1)' }}
                  onClick={handleReset}
                  disabled={processing}
                >
                  Limpiar Vista
                </button>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                {(!analysisDone || stats.errors > 0) && !uploadDone && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {!analysisDone
                      ? 'Primero analiza la carga.'
                      : 'Corrige los errores del análisis para poder iniciar la carga.'}
                  </span>
                )}
                {uploadDone && stats.errors > 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleRetryFailedRecords}
                    disabled={processing}
                    style={{
                      background: '#d97706',
                      borderColor: '#d97706',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      boxShadow: '0 2px 6px rgba(217, 119, 6, 0.25)'
                    }}
                  >
                    <RefreshCw size={16} className={processing ? 'spin' : ''} />
                    Reintentar Carga ({stats.errors} fallidos)
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleOpenImagesModal}
                    disabled={processing || !analysisDone || stats.errors > 0 || preparedProducts.length === 0 || uploadDone}
                    title={
                      !analysisDone
                        ? 'Primero debes analizar la carga.'
                        : stats.errors > 0
                          ? 'Corrige los errores del análisis antes de continuar.'
                          : undefined
                    }
                  >
                    {uploadDone ? 'Carga Completada' : 'Iniciar Carga'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>



      {selectedHistoryItem && createPortal(
        <div className="modal-overlay" style={{ zIndex: 200 }} onMouseDown={() => setSelectedHistoryItem(null)}>
          <div className="modal-content" ref={historyDetailDialogRef} role="dialog" aria-modal="true" aria-label="Registros cargados" style={{ maxWidth: '1050px', width: '94%', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h4 style={{ fontSize: '1rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Registros cargados
                  {selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        color: '#047857',
                        border: '1px solid rgba(16, 185, 129, 0.2)',
                        borderRadius: '6px',
                        padding: '0.1rem 0.35rem',
                        fontSize: '0.62rem',
                        fontWeight: 700
                      }}
                    >
                      <Zap size={10} />
                      Carga Rápida
                    </span>
                  ) : (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        color: '#1d4ed8',
                        border: '1px solid rgba(59, 130, 246, 0.2)',
                        borderRadius: '6px',
                        padding: '0.1rem 0.35rem',
                        fontSize: '0.62rem',
                        fontWeight: 700
                      }}
                    >
                      <Package size={10} />
                      Carga Completa
                    </span>
                  )}
                </h4>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  {selectedHistoryItem.id} · {selectedHistoryItem.records?.length ?? 0} registros disponibles
                  {selectedHistoryItem.genericImageSkus && selectedHistoryItem.genericImageSkus.length > 0 && (
                    <> · <span style={{ color: 'hsl(var(--warning))', fontWeight: 600 }}>{selectedHistoryItem.genericImageSkus.length} con imagen genérica</span></>
                  )}
                </p>
              </div>
              <button className="btn-icon" onClick={() => setSelectedHistoryItem(null)} aria-label="Cerrar detalle de carga"><XCircle size={19} /></button>
            </div>
            <div className="modal-body" style={{ overflow: 'auto' }}>
              {!selectedHistoryItem.records ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Esta carga fue realizada antes de habilitar el detalle de registros.</p>
              ) : selectedHistoryItem.records.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No se cargaron registros exitosamente en esta carga.</p>
              ) : (
                <div className="log-table-container" style={{ marginTop: 0 }}>
                  <table className="log-table">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Repuesto</th>
                        <th>Marca</th>
                        <th>Vehículo</th>
                        <th>Año</th>
                        <th style={{
                          background: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? 'rgba(16, 185, 129, 0.12)' : undefined,
                          color: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? '#047857' : undefined,
                          fontWeight: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? 800 : undefined
                        }}>Stock</th>
                        <th style={{
                          background: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? 'rgba(16, 185, 129, 0.12)' : undefined,
                          color: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? '#047857' : undefined,
                          fontWeight: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? 800 : undefined
                        }}>Precio</th>
                        <th>Foto</th>
                      </tr>
                    </thead>
                    <tbody>{selectedHistoryItem.records.map((product, index) => (
                      <tr key={`${product.id}-${index}`}>
                        <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>{product.sku}</code></td>
                        <td>{product.name}</td>
                        <td>{product.partBrand || '—'}</td>
                        <td>{[product.vehicleBrand, product.vehicleModel].filter(Boolean).join(' ') || '—'}</td>
                        <td>{product.vehicleYear}</td>
                        <td style={{
                          background: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? 'rgba(16, 185, 129, 0.08)' : undefined,
                          color: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? '#047857' : undefined,
                          fontWeight: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? 800 : undefined
                        }}>{product.stock}</td>
                        <td style={{
                          background: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? 'rgba(16, 185, 129, 0.08)' : undefined,
                          color: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? '#047857' : undefined,
                          fontWeight: selectedHistoryItem.mode === 'EXPRESS_STOCK_PRICE' ? 800 : undefined
                        }}>{product.pricingMode === 'quote_only' ? 'A cotizar' : `$${product.price.toLocaleString('es-CL')}`}</td>
                        <td>
                          {selectedHistoryItem.genericImageSkus?.includes(product.sku)
                            ? <span className="badge badge-warning">Genérica</span>
                            : <span className="badge badge-success">Real</span>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ padding: '1rem 1.5rem' }}><button type="button" className="btn btn-secondary" onClick={() => setSelectedHistoryItem(null)}>Cerrar</button></div>
          </div>
        </div>,
        document.body
      )}

      {reviewingLog && (
        <div className="modal-overlay" style={{ zIndex: 60 }}>
          <div className="modal-content" ref={reviewSkuDialogRef} role="dialog" aria-modal="true" aria-label="Revisar SKU" style={{ maxWidth: '380px', width: '90%', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <SearchCheck size={16} style={{ color: 'hsl(var(--primary))' }} />
                Revisar SKU
              </h4>
              <button className="btn-icon" onClick={closeReviewSku} style={{ padding: 0 }} aria-label="Cerrar revisión de SKU">
                <XCircle size={18} />
              </button>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
              SKU actual: <code style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{reviewingLog.sku === 'VACÍO' ? '(sin SKU)' : reviewingLog.sku}</code>
            </p>
            {reviewingLog.name && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                Repuesto: <strong>{reviewingLog.name}</strong>
              </p>
            )}
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
              Fila del Excel: <strong>{reviewingLog.row === 0 ? 'N/A' : reviewingLog.row}</strong>
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Ingresa un nuevo SKU y valida su disponibilidad en tu inventario.
            </p>

            <label className="form-label" style={{ fontSize: '0.72rem', marginBottom: '0.35rem', display: 'block' }}>Nuevo SKU</label>
            <input
              type="text"
              className="form-control"
              value={reviewSkuInput}
              onChange={(e) => {
                setReviewSkuInput(e.target.value);
                setReviewValidation({ status: 'idle', message: '' });
              }}
              placeholder="Ej: BOS-SPK-FR7DC-2"
              style={{ marginBottom: '0.75rem' }}
              autoFocus
            />

            {reviewValidation.status !== 'idle' && (
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '0.5rem 0.65rem',
                  borderRadius: '8px',
                  marginBottom: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: reviewValidation.status === 'valid'
                    ? 'var(--success-bg)'
                    : reviewValidation.status === 'invalid'
                      ? 'var(--danger-bg)'
                      : 'var(--bg-app)',
                  color: reviewValidation.status === 'valid'
                    ? 'hsl(var(--success))'
                    : reviewValidation.status === 'invalid'
                      ? 'hsl(var(--danger))'
                      : 'var(--text-secondary)'
                }}
              >
                {reviewValidation.status === 'valid' && <CheckCircle2 size={14} />}
                {reviewValidation.status === 'invalid' && <XCircle size={14} />}
                {reviewValidation.message}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={closeReviewSku}>
                {reviewValidation.status === 'valid' ? 'Cerrar' : 'Cancelar'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={reviewValidation.status === 'valid' ? closeReviewSku : handleValidateReviewSku}
                disabled={!reviewSkuInput.trim() || reviewValidation.status === 'checking'}
              >
                {reviewValidation.status === 'valid' ? 'Aceptar' : 'Validar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {processing && (imagesModalOpen || isRetryingFailed) && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem'
          }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '20px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              padding: '2.5rem 2rem',
              maxWidth: '480px',
              width: '100%',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.25rem'
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(27, 100, 218, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'hsl(var(--primary))'
              }}
            >
              <RefreshCw className="spin" size={32} />
            </div>

            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.35rem' }}>
                {isRetryingFailed
                  ? 'Reintentando carga de registros fallidos...'
                  : 'Guardando inventario en la base de datos...'}
              </h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                {isRetryingFailed
                  ? `Por favor espera mientras se reintenta guardar únicamente los ${stats.errors} registros que presentaron fallos.`
                  : 'Por favor espera mientras se procesan y guardan los registros en la base de datos.'}
              </p>
            </div>

            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 700, color: 'hsl(var(--primary))', marginBottom: '0.4rem' }}>
                <span>Progreso de carga</span>
                <span>{progress}%</span>
              </div>
              <div className="import-progress-bar" style={{ height: '10px', borderRadius: '99px', overflow: 'hidden', margin: 0, backgroundColor: 'rgba(0, 0, 0, 0.08)' }}>
                <div className="import-progress-fill" style={{ width: `${progress}%`, height: '100%', backgroundColor: 'hsl(var(--primary))', borderRadius: '99px', transition: 'width 0.3s ease' }} />
              </div>
            </div>

            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              No cierres ni cambies de pantalla hasta finalizar el proceso
            </span>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};


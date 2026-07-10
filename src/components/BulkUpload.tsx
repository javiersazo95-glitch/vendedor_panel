import React, { useState, useRef, useEffect, useMemo } from 'react';
import { UploadCloud, FolderOpen, FileText, CheckCircle2, AlertTriangle, XCircle, Play, FileSpreadsheet, RefreshCw, Trash2, SearchCheck, ImageUp, Images } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import type { Product, BatchResult } from '../db';
import { saveProductsBatch, getAllProducts } from '../db';

interface BulkUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
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

const productHasImage = (product: PreparedProduct) => {
  if (product.image && product.image.trim()) return true;
  if (!product.imageFile) return false;
  return Array.isArray(product.imageFile) ? product.imageFile.length > 0 : true;
};

const escapeSvgText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const createGenericProductImage = (product: PreparedProduct) => {
  const label = escapeSvgText(product.name || product.sku || 'Producto');
  const filenameSku = (product.sku || 'producto').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
      <rect width="1200" height="900" fill="#f8fafc"/>
      <rect x="120" y="120" width="960" height="660" rx="36" fill="#ffffff" stroke="#cbd5e1" stroke-width="6"/>
      <path d="M342 610h516l-148-188-112 132-74-88-182 144Z" fill="#dbeafe"/>
      <circle cx="430" cy="330" r="62" fill="#bfdbfe"/>
      <text x="600" y="720" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="#334155">Imagen generica</text>
      <text x="600" y="785" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" fill="#64748b">${label}</text>
    </svg>
  `;
  return new File([svg], `${filenameSku}-imagen-generica.svg`, { type: 'image/svg+xml' });
};

interface ImportLog {
  id: string;
  row: number;
  sku: string;
  name?: string;
  status: 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
  // Producto ya armado y listo para re-encolar si el vendedor corrige el SKU.
  pendingProduct?: PreparedProduct;
}

const isSkuIssueLog = (log: ImportLog) =>
  log.status === 'ERROR' && /repetido|duplicad|SKU faltante/i.test(log.message);

export const BulkUpload: React.FC<BulkUploadProps> = ({ isOpen, onClose, onUploadSuccess, embedded = false }) => {
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

  const [pendingImageFiles, setPendingImageFiles] = useState<FileList | null>(null);
  const [pendingImageCount, setPendingImageCount] = useState(0);

  // Asignación manual de imágenes por SKU antes de iniciar la carga real
  const [imagesModalOpen, setImagesModalOpen] = useState(false);
  const [availableImages, setAvailableImages] = useState<Record<string, File | Blob>>({});
  const [imageAssignments, setImageAssignments] = useState<Record<string, string[]>>({});
  const [galleryOpenForSku, setGalleryOpenForSku] = useState<string | null>(null);
  const [uploadSuccessCount, setUploadSuccessCount] = useState<number | null>(null);
  const [missingImageRows, setMissingImageRows] = useState<{ row: number; tableRow: number; sku: string; name: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [uploadHistory, setUploadHistory] = useState<BulkUploadHistoryItem[]>(() => loadBulkUploadHistory());

  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const dataFileInputRef = useRef<HTMLInputElement>(null);

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
      setPendingImageFiles(dt.files);
      setPendingImageCount(files.length);
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
      .map(({ hasImage, ...item }) => item)
  ), [productsWithAssignedImages]);

  const highlightedMissingImageSkus = new Set(missingImageRows.map((item) => item.sku));

  if (!isOpen) return null;

  // 1. Generate & Download CSV/XLSX Templates
  const downloadTemplate = (format: 'xlsx' | 'csv') => {
    const headers = [
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
      'descripcion'
    ];

    const sampleRows = [
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
        descripcion: 'Bujía de encendido de alta durabilidad.'
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
        descripcion: 'Pastillas de freno cerámicas delanteras.'
      }
    ];

    if (format === 'csv') {
      const csvContent = Papa.unparse({
        fields: headers,
        data: sampleRows.map(row => Object.values(row))
      });
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', 'Plantilla_Carga_Masiva_RepuesTop.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      // Excel template creation
      const worksheet = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario');
      const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', 'Plantilla_Carga_Masiva_RepuesTop.xlsx');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Helper to convert Blob or File to Base64


  // Extract images from ZIP
  const extractZipImages = async (zipFile: File): Promise<Record<string, Blob>> => {
    const imageFilesMap: Record<string, Blob> = {};
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
            const csvText = e.target?.result as string;
            const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
            rows = parsed.data;
          } else {
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
          const seenSkusInFile = new Set<string>();

          const processedProducts: PreparedProduct[] = [];
          const localLogs: Omit<ImportLog, 'id'>[] = [];
          let successCount = 0;
          let warningCount = 0;
          let errorCount = 0;

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
            const rawImageFilename = row.imagen || row.Imagen || row.image || '';

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

  // Guarda en el backend los productos que ya pasaron el análisis
  const handleStartUpload = async (productsOverride?: PreparedProduct[]) => {
    const productsToSave = productsOverride ?? preparedProducts;
    if (productsToSave.length === 0 || stats.errors > 0) return;

    setImagesModalOpen(false);
    setProcessing(true);
    setProgress(60);

    try {
      const dbResult: BatchResult = await saveProductsBatch(productsToSave, false, (percent) => {
        setProgress(60 + Math.round((percent / 100) * 35));
      });

      setLogs((prev) => {
        let updated = [...prev];

        dbResult.success.forEach((prod) => {
          updated = updated.map((l) => (
            l.sku === prod.sku && l.status === 'SUCCESS'
              ? { ...l, message: 'Producto importado exitosamente.' }
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
        status: dbResult.errors.length > 0 || stats.errors > 0 ? 'CON_ERRORES' : 'COMPLETADA'
      };
      setUploadHistory((prev) => {
        const next = [historyItem, ...prev].slice(0, 50);
        localStorage.setItem(BULK_UPLOAD_HISTORY_KEY, JSON.stringify(next));
        return next;
      });

      setUploadDone(true);
      setUploadSuccessCount(dbResult.success.length);
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

  const handleProceedUpload = (continueWithGenericImage = false) => {
    if (currentMissingImageRows.length > 0 && !continueWithGenericImage) {
      setMissingImageRows(currentMissingImageRows);
      return;
    }

    setMissingImageRows([]);

    const finalProducts = continueWithGenericImage
      ? productsWithAssignedImages.map((product) => (
        productHasImage(product)
          ? product
          : { ...product, imageFile: createGenericProductImage(product) }
      ))
      : productsWithAssignedImages;

    handleStartUpload(finalProducts);
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

  const openReviewSku = (id: string) => {
    setReviewingLogId(id);
    setReviewSkuInput('');
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

    setReviewValidation({ status: 'checking', message: 'Verificando...' });
    const normalized = trimmed.toUpperCase();
    const existingProducts = await getAllProducts();
    const exists = existingProducts.some(p => p.sku.trim().toUpperCase() === normalized);

    if (exists) {
      setReviewValidation({ status: 'invalid', message: `El SKU "${trimmed}" ya existe en tu inventario.` });
      return;
    }

    const currentLog = logs.find(l => l.id === reviewingLogId);

    if (currentLog?.pendingProduct) {
      setReviewValidation({ status: 'valid', message: `El SKU "${trimmed}" es válido y está disponible.` });
      setPreparedProducts(prev => [...prev, { ...currentLog.pendingProduct!, sku: normalized }]);
      setLogs(prev => prev.map(l => l.id === reviewingLogId
        ? { ...l, sku: normalized, status: 'SUCCESS', message: 'SKU corregido y validado correctamente. Lista para cargar.', pendingProduct: undefined }
        : l
      ));
      setStats(prev => ({ ...prev, errors: Math.max(0, prev.errors - 1), success: prev.success + 1 }));
    } else {
      // El SKU ya es válido, pero a la fila le faltan otros datos obligatorios
      // (nombre, precio o stock), así que no puede re-encolarse automáticamente.
      setReviewValidation({
        status: 'valid',
        message: `El SKU "${trimmed}" es válido, pero esta fila tiene otros datos incompletos y no se cargará automáticamente.`
      });
      if (reviewingLogId) {
        setLogs(prev => prev.map(l => l.id === reviewingLogId ? { ...l, sku: normalized } : l));
      }
    }
  };

  const reviewingLog = logs.find(l => l.id === reviewingLogId) || null;

  const confirmPendingImages = () => {
    if (pendingImageFiles) setImageFolderFiles(pendingImageFiles);
    setPendingImageFiles(null);
    setPendingImageCount(0);
  };

  const cancelPendingImages = () => {
    setImageFolderFiles(null);
    if (folderInputRef.current) folderInputRef.current.value = '';
    setPendingImageFiles(null);
    setPendingImageCount(0);
  };

  return (
    <div className={embedded ? "bulk-upload-page" : "modal-overlay"}>
      <div
        className={embedded ? "bulk-upload-page-content" : "modal-content"}
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
            <button className="btn-icon" onClick={onClose} disabled={processing}>
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
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Registros</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Éxito</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Alertas</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Fallidos</th>
                        <th style={{ padding: '0.65rem 0.75rem', fontSize: '0.72rem' }}>Estado</th>
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
                          <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', fontWeight: 700 }}>{item.total}</td>
                          <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', color: 'hsl(var(--success))', fontWeight: 800 }}>{item.success}</td>
                          <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', color: 'hsl(var(--warning))', fontWeight: 800 }}>{item.warnings}</td>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : imagesModalOpen ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '560px' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                  <Images size={18} style={{ color: 'hsl(var(--primary))' }} />
                  Asignar Imágenes a Productos
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                  Puedes seleccionar hasta <strong>{MAX_IMAGES_PER_PRODUCT} imágenes por producto</strong> desde tu carpeta cargada.
                </p>
              </div>

              {Object.keys(availableImages).length === 0 && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>
                  No hay imágenes cargadas en la carpeta. Puedes iniciar la carga sin fotos.
                </p>
              )}

              {missingImageRows.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    background: '#fff8db',
                    border: '1px solid #facc15',
                    borderLeft: '4px solid #f59e0b',
                    borderRadius: '10px',
                    padding: '0.85rem 1rem'
                  }}
                >
                  <AlertTriangle size={18} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <p style={{ fontSize: '0.82rem', color: '#92400e', fontWeight: 800, margin: '0 0 0.35rem' }}>
                      Hay registros sin imagen cargada
                    </p>
                    <p style={{ fontSize: '0.76rem', color: '#92400e', margin: '0 0 0.5rem' }}>
                      Puedes asignar una imagen a las filas marcadas o continuar usando una imagen genérica del producto.
                    </p>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {missingImageRows.map((item) => (
                        <span
                          key={`${item.tableRow}-${item.sku}`}
                          style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', padding: '0.2rem 0.45rem', borderRadius: '999px', fontWeight: 800 }}
                          title={item.name}
                        >
                          Fila {item.tableRow} sin asignar imagen · {item.sku}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div style={{ overflowX: 'auto', flex: 1 }}>
                <table className="log-table" style={{ width: '100%' }}>
                  <thead>
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
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Precio</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Stock</th>
                      <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Descripción</th>
                      <th style={{ width: '140px', padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Imágenes</th>
                      <th style={{ width: '90px', padding: '0.5rem 0.75rem', fontSize: '0.7rem', textAlign: 'center', whiteSpace: 'nowrap' }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preparedProducts.map((product, index) => {
                      const selected = imageAssignments[product.sku] || [];
                      const isGalleryOpen = galleryOpenForSku === product.sku;
                      const isMissingImageHighlighted = highlightedMissingImageSkus.has(product.sku);
                      return (
                        <React.Fragment key={product.sku}>
                          <tr
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
                                {index + 1}
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
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>${product.price?.toLocaleString('es-CL')}</td>
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{product.stock}</td>
                            <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={product.description}>
                              {product.description || '—'}
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              <span
                                style={{
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  padding: '0.15rem 0.5rem',
                                  borderRadius: '999px',
                                  whiteSpace: 'nowrap',
                                  background: isMissingImageHighlighted ? '#fef3c7' : selected.length > 0 ? 'var(--success-bg)' : 'var(--bg-app)',
                                  color: isMissingImageHighlighted ? '#92400e' : selected.length > 0 ? 'hsl(var(--success))' : 'var(--text-muted)'
                                }}
                              >
                                {isMissingImageHighlighted ? 'Falta imagen' : `${selected.length} / ${MAX_IMAGES_PER_PRODUCT} seleccionadas`}
                              </span>
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <button
                                  type="button"
                                  title="Subir imagen"
                                  onClick={() => setGalleryOpenForSku(isGalleryOpen ? null : product.sku)}
                                  style={{
                                    border: 'none',
                                    background: isGalleryOpen ? 'hsl(var(--primary))' : 'rgba(37, 99, 235, 0.08)',
                                    color: isGalleryOpen ? '#fff' : 'hsl(var(--primary))',
                                    borderRadius: '6px',
                                    width: '30px',
                                    height: '30px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <ImageUp size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isGalleryOpen && (
                            <tr>
                              <td colSpan={15} style={{ padding: '0.75rem 1rem 1.25rem', background: 'var(--bg-app)' }}>
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
            </div>
          ) : (
          <div className="bulk-upload-split-layout">
            
            {/* Left Panel: Uploading and template downloads */}
            <div className="bulk-upload-left-panel">
              {/* Template Download Banner */}
              <div style={{ background: 'rgba(99, 102, 241, 0.04)', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>
                  <h4 style={{ fontSize: '0.825rem', fontWeight: 700 }}>Plantilla Oficial</h4>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Completa el stock, OEM y fotos usando este formato.</p>
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
              <div className="dropzones-horizontal-container">
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
                            const imageCount = Array.from(files).filter((f) => {
                              const ext = f.name.split('.').pop()?.toLowerCase();
                              return ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
                            }).length;
                            setPendingImageFiles(files);
                            setPendingImageCount(imageCount);
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
              </div>

              {/* Action trigger button */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem' }}
                  disabled={!dataFile || processing || (imageSource === 'FOLDER' && !imageFolderFiles) || (imageSource === 'ZIP' && !imageZipFile)}
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
                    <div className="import-progress-bar" style={{ margin: '0.35rem 0 0 0', height: '6px' }}>
                      <div className="import-progress-fill" style={{ width: `${progress}%` }}></div>
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
                  </div>

                  <div className="report-summary-cards" style={{ margin: '0 0 1rem 0', gap: '0.75rem' }}>
                    <div className="summary-card summary-card-success" style={{ padding: '0.75rem 0.5rem', borderRadius: '12px' }}>
                      <div className="summary-num" style={{ fontSize: '1.45rem' }}>{stats.success}</div>
                      <div className="summary-txt" style={{ fontSize: '0.62rem' }}>Éxito</div>
                    </div>
                    <div className="summary-card summary-card-warning" style={{ padding: '0.75rem 0.5rem', borderRadius: '12px' }}>
                      <div className="summary-num" style={{ fontSize: '1.45rem' }}>{stats.warnings}</div>
                      <div className="summary-txt" style={{ fontSize: '0.62rem' }}>Alertas</div>
                    </div>
                    <div className="summary-card summary-card-danger" style={{ padding: '0.75rem 0.5rem', borderRadius: '12px' }}>
                      <div className="summary-num" style={{ fontSize: '1.45rem' }}>{stats.errors}</div>
                      <div className="summary-txt" style={{ fontSize: '0.62rem' }}>Fallidos</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h5 style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Detalle de Transacciones (Log)
                    </h5>
                    <span 
                      className="scroll-indicator-pulse"
                      style={{ fontSize: '0.68rem', color: 'hsl(var(--primary))', fontWeight: 700 }}
                    >
                      ↕ Scroll activo
                    </span>
                  </div>

                  <div className="log-table-container" style={{ flexGrow: 1, marginTop: 0 }}>
                    <table className="log-table">
                      <thead>
                        <tr>
                          <th style={{ width: '80px', padding: '0.5rem 0.75rem', fontSize: '0.7rem' }}>Origen</th>
                          <th style={{ width: '120px', padding: '0.5rem 0.75rem', fontSize: '0.7rem' }}>SKU</th>
                          <th style={{ width: '90px', padding: '0.5rem 0.75rem', fontSize: '0.7rem' }}>Estado</th>
                          <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem' }}>Detalle / Error</th>
                          <th style={{ width: '80px', padding: '0.5rem 0.75rem', fontSize: '0.7rem', textAlign: 'center' }}>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((log) => {
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
                                  {log.row === 0 ? 'DB' : `Fila ${log.row}`}
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
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                                  {isSkuIssueLog(log) && (
                                    <button
                                      type="button"
                                      title="Revisar SKU"
                                      onClick={() => openReviewSku(log.id)}
                                      style={{ border: 'none', background: 'rgba(37, 99, 235, 0.08)', color: 'hsl(var(--primary))', borderRadius: '6px', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                    >
                                      <SearchCheck size={14} />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    title="Eliminar registro"
                                    onClick={() => handleDeleteLog(log.id)}
                                    style={{ border: 'none', background: 'rgba(239, 68, 68, 0.08)', color: 'hsl(var(--danger))', borderRadius: '6px', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
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
                <button type="button" className="btn btn-primary" onClick={() => handleProceedUpload(true)}>
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
              </div>
            </>
          )}
        </div>
      </div>

      {pendingImageFiles && (
        <div className="modal-overlay" style={{ zIndex: 60 }}>
          <div className="modal-content" style={{ maxWidth: '360px', width: '90%', padding: '1.5rem' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
              <FolderOpen size={16} style={{ color: 'hsl(var(--accent))' }} />
              Confirmar Imágenes
            </h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Se seleccionaron <strong>{pendingImageCount}</strong> {pendingImageCount === 1 ? 'imagen' : 'imágenes'}. ¿Deseas continuar con la carga?
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={cancelPendingImages}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmPendingImages}>
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {false && imagesModalOpen && (
        <div className="modal-overlay" style={{ zIndex: 60 }}>
          <div className="modal-content" style={{ maxWidth: '1400px', width: '97%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Images size={18} style={{ color: 'hsl(var(--primary))' }} />
                  Asignar Imágenes a Productos
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                  Puedes seleccionar hasta <strong>{MAX_IMAGES_PER_PRODUCT} imágenes por producto</strong> desde tu carpeta cargada. Es opcional: puedes iniciar la carga sin asignar imágenes.
                </p>
              </div>
              <button className="btn-icon" onClick={() => setImagesModalOpen(false)}>
                <XCircle size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              {Object.keys(availableImages).length === 0 && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>
                  No hay imágenes cargadas en la carpeta. Puedes iniciar la carga sin fotos.
                </p>
              )}

              {missingImageRows.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    background: '#fff8db',
                    border: '1px solid #facc15',
                    borderLeft: '4px solid #f59e0b',
                    borderRadius: '10px',
                    padding: '0.85rem 1rem',
                    marginBottom: '0.85rem'
                  }}
                >
                  <AlertTriangle size={18} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <p style={{ fontSize: '0.82rem', color: '#92400e', fontWeight: 800, margin: '0 0 0.35rem' }}>
                      Hay registros sin imagen cargada
                    </p>
                    <p style={{ fontSize: '0.76rem', color: '#92400e', margin: '0 0 0.5rem' }}>
                      Puedes asignar una imagen a las filas marcadas o continuar usando una imagen genérica del producto.
                    </p>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {missingImageRows.map((item) => (
                        <span
                          key={`${item.tableRow}-${item.sku}`}
                          style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', padding: '0.2rem 0.45rem', borderRadius: '999px', fontWeight: 800 }}
                          title={item.name}
                        >
                          Fila {item.tableRow} sin asignar imagen · {item.sku}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
              <table className="log-table" style={{ width: '100%' }}>
                <thead>
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
                    <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Precio</th>
                    <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Stock</th>
                    <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Descripción</th>
                    <th style={{ width: '140px', padding: '0.5rem 0.75rem', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Imágenes</th>
                    <th style={{ width: '90px', padding: '0.5rem 0.75rem', fontSize: '0.7rem', textAlign: 'center', whiteSpace: 'nowrap' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {preparedProducts.map((product, index) => {
                    const selected = imageAssignments[product.sku] || [];
                    const isGalleryOpen = galleryOpenForSku === product.sku;
                    const isMissingImageHighlighted = highlightedMissingImageSkus.has(product.sku);
                    return (
                      <React.Fragment key={product.sku}>
                        <tr
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
                              title={`Fila ${product.sourceRow || 'N/A'} del Excel`}
                            >
                              {index + 1}
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
                          <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>${product.price?.toLocaleString('es-CL')}</td>
                          <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{product.stock}</td>
                          <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={product.description}>
                            {product.description || '—'}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>
                            <span
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                padding: '0.15rem 0.5rem',
                                borderRadius: '999px',
                                whiteSpace: 'nowrap',
                                background: isMissingImageHighlighted ? '#fef3c7' : selected.length > 0 ? 'var(--success-bg)' : 'var(--bg-app)',
                                color: isMissingImageHighlighted ? '#92400e' : selected.length > 0 ? 'hsl(var(--success))' : 'var(--text-muted)'
                              }}
                            >
                              {isMissingImageHighlighted ? 'Falta imagen' : `${selected.length} / ${MAX_IMAGES_PER_PRODUCT} seleccionadas`}
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                              <button
                                type="button"
                                title="Subir imagen"
                                onClick={() => setGalleryOpenForSku(isGalleryOpen ? null : product.sku)}
                                style={{
                                  border: 'none',
                                  background: isGalleryOpen ? 'hsl(var(--primary))' : 'rgba(37, 99, 235, 0.08)',
                                  color: isGalleryOpen ? '#fff' : 'hsl(var(--primary))',
                                  borderRadius: '6px',
                                  width: '30px',
                                  height: '30px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer'
                                }}
                              >
                                <ImageUp size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isGalleryOpen && (
                          <tr>
                            <td colSpan={15} style={{ padding: '0.75rem 1rem 1.25rem', background: 'var(--bg-app)' }}>
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
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', padding: '1.25rem 2rem' }}>
              {missingImageRows.length > 0 ? (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => setMissingImageRows([])}>
                    Volver a asignar
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => handleProceedUpload(true)}>
                    Continuar con imagen genérica
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => setImagesModalOpen(false)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleProceedUpload()}
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
              )}
            </div>
          </div>
        </div>
      )}

      {reviewingLog && (
        <div className="modal-overlay" style={{ zIndex: 60 }}>
          <div className="modal-content" style={{ maxWidth: '380px', width: '90%', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <SearchCheck size={16} style={{ color: 'hsl(var(--primary))' }} />
                Revisar SKU
              </h4>
              <button className="btn-icon" onClick={closeReviewSku} style={{ padding: 0 }}>
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
    </div>
  );
};

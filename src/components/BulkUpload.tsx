import React, { useState, useRef } from 'react';
import { Download, UploadCloud, FolderOpen, FileText, CheckCircle2, AlertTriangle, XCircle, Play, FileSpreadsheet, RefreshCw } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import type { Product, BatchResult } from '../db';
import { saveProductsBatch, getAllProducts } from '../db';

interface BulkUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
}

interface ImportLog {
  row: number;
  sku: string;
  status: 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
}

export const BulkUpload: React.FC<BulkUploadProps> = ({ isOpen, onClose, onUploadSuccess }) => {
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

    if (dataFileInputRef.current) dataFileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (zipInputRef.current) zipInputRef.current.value = '';
  };

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
      'descripcion',
      'imagen'
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
        descripcion: 'Bujía de encendido de alta durabilidad.',
        imagen: 'bujia_bosch_fr7.jpg'
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
        imagen: 'pastilla_brembo_p83.png'
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

  // Core reconciliation and import engine
  const handleProcessImport = async () => {
    if (!dataFile) return;

    setProcessing(true);
    setProgress(10);
    setLogs([]);
    setStats({ success: 0, warnings: 0, errors: 0 });

    try {
      // 1. Gather image files into a key-value dictionary (lowercase filename -> Blob/File)
      let imagesMap: Record<string, Blob | File> = {};
      setProgress(20);
      
      if (imageSource === 'ZIP' && imageZipFile) {
        imagesMap = await extractZipImages(imageZipFile);
      } else if (imageSource === 'FOLDER' && imageFolderFiles) {
        imagesMap = extractFolderImages(imageFolderFiles);
      }
      
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
            setLogs([{ row: 0, sku: 'N/A', status: 'ERROR', message: 'El archivo de datos está vacío.' }]);
            setStats(s => ({ ...s, errors: 1 }));
            setProcessing(false);
            return;
          }

          setProgress(50);

          // 3. Process rows and reconcile images
          const existingProducts = await getAllProducts();
          const existingSkus = new Set(existingProducts.map(p => p.sku.trim().toUpperCase()));
          const seenSkusInFile = new Set<string>();

          const processedProducts: (Omit<Product, 'id' | 'lastUpdated'> & { imageFile?: File | Blob | null })[] = [];
          const localLogs: ImportLog[] = [];
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

            // Validations
            if (!sku) {
              localLogs.push({ row: rowNum, sku: 'VACÍO', status: 'ERROR', message: 'Fila omitida: SKU faltante o inválido.' });
              errorCount++;
              continue;
            }

            const normalizedSku = sku.toUpperCase();

            // Duplicate checks
            if (seenSkusInFile.has(normalizedSku)) {
              localLogs.push({
                row: rowNum,
                sku: normalizedSku,
                status: 'ERROR',
                message: `Fila omitida: El SKU "${sku}" está repetido dentro de la misma plantilla.`
              });
              errorCount++;
              continue;
            }
            seenSkusInFile.add(normalizedSku);

            if (existingSkus.has(normalizedSku)) {
              localLogs.push({
                row: rowNum,
                sku: normalizedSku,
                status: 'ERROR',
                message: `Fila omitida: El SKU ya existe en el catálogo (registro omitido por SKU duplicado).`
              });
              errorCount++;
              continue;
            }
            if (!name) {
              localLogs.push({ row: rowNum, sku, status: 'ERROR', message: 'Fila omitida: Nombre de producto faltante.' });
              errorCount++;
              continue;
            }
            if (isNaN(price) || price <= 0) {
              localLogs.push({ row: rowNum, sku, status: 'ERROR', message: 'Fila omitida: El precio debe ser un número mayor a 0.' });
              errorCount++;
              continue;
            }
            if (isNaN(stock) || stock < 0) {
              localLogs.push({ row: rowNum, sku, status: 'ERROR', message: 'Fila omitida: El stock no puede ser un número negativo.' });
              errorCount++;
              continue;
            }

            // Image matching engine
            let imagePath = '';
            let matchedFile: File | Blob | null = null;
            const imgFilenameClean = String(rawImageFilename).trim();

            if (imgFilenameClean) {
              if (imgFilenameClean.startsWith('http://') || imgFilenameClean.startsWith('https://')) {
                imagePath = imgFilenameClean;
              } else {
                const imgKey = imgFilenameClean.toLowerCase();
                const matchedBlob = imagesMap[imgKey];
                if (matchedBlob) {
                  matchedFile = matchedBlob;
                } else {
                  localLogs.push({
                    row: rowNum,
                    sku,
                    status: 'WARNING',
                    message: `Imagen "${rawImageFilename}" no encontrada en la carpeta. Carga guardada sin foto.`
                  });
                  warningCount++;
                }
              }
            }

            processedProducts.push({
              sku: sku.toUpperCase(),
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
              imageFile: matchedFile
            });
          }

          setProgress(60);

          // 4. Save to central backend API
          const dbResult: BatchResult = await saveProductsBatch(processedProducts, false, (percent) => {
            setProgress(60 + Math.round((percent / 100) * 35)); // scale progress 60% to 95%
          });
          
          // Combine logs
          dbResult.success.forEach((prod) => {
            // Check if there was already a warning for this SKU
            const hasWarning = localLogs.some(l => l.sku === prod.sku && l.status === 'WARNING');
            if (!hasWarning) {
              localLogs.push({
                row: 0, // database action
                sku: prod.sku,
                status: 'SUCCESS',
                message: `Producto importado exitosamente.`
              });
              successCount++;
            } else {
              // Warned item still counts as a success in DB but with warning status flag
              successCount++;
            }
          });

          dbResult.errors.forEach((err) => {
            localLogs.push({
              row: err.row,
              sku: err.sku,
              status: 'ERROR',
              message: `Error al guardar en base de datos: ${err.error}`
            });
            errorCount++;
          });

          // Sort logs: errors first, then warnings, then successes
          const sortedLogs = localLogs.sort((a, b) => {
            const score = { ERROR: 3, WARNING: 2, SUCCESS: 1 };
            return score[b.status] - score[a.status];
          });

          setLogs(sortedLogs);
          setStats({
            success: successCount,
            warnings: warningCount,
            errors: errorCount,
          });
          setProgress(100);
          setProcessing(false);
          onUploadSuccess(); // Update KPIs and dashboard grid list
        } catch (innerErr: any) {
          setLogs([{ row: 0, sku: 'N/A', status: 'ERROR', message: `Fallo crítico de lectura: ${innerErr.message}` }]);
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
      setLogs([{ row: 0, sku: 'N/A', status: 'ERROR', message: `Error en proceso: ${err.message}` }]);
      setStats(s => ({ ...s, errors: 1 }));
      setProgress(100);
      setProcessing(false);
    }
  };

  // 3. Download Error/Warning Logs Report
  const downloadErrorReport = () => {
    const errorWarnings = logs.filter(l => l.status !== 'SUCCESS');
    if (errorWarnings.length === 0) return;

    const headers = ['Fila', 'SKU', 'Severidad', 'Detalle del Error / Advertencia'];
    const csvContent = Papa.unparse({
      fields: headers,
      data: errorWarnings.map(l => [l.row === 0 ? 'DB' : l.row, l.sku, l.status, l.message])
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'Reporte_Errores_Importacion_RepuesTop.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '1240px', width: '95%', maxHeight: '92vh' }}>
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
          <button className="btn-icon" onClick={onClose} disabled={processing}>
            <XCircle size={20} />
          </button>
        </div>

        <div className="modal-body">
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
                    <label className={`dropzone compact ${imageFolderFiles ? 'active' : ''}`}>
                      <input
                        type="file"
                        ref={folderInputRef}
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => setImageFolderFiles(e.target.files)}
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
                    </label>
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
                  onClick={handleProcessImport}
                >
                  {processing ? (
                    <>
                      <RefreshCw className="spin" size={16} />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      Iniciar Carga Masiva
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
                    Completa la carga de archivos a la izquierda y ejecuta "Iniciar Carga Masiva" para desplegar el análisis de registros y errores aquí.
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>Resumen del Procesamiento</h4>
                    {stats.errors + stats.warnings > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        onClick={downloadErrorReport}
                      >
                        <Download size={12} />
                        Exportar Log (CSV)
                      </button>
                    )}
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
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((log, index) => {
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
                            <tr key={index} style={{ backgroundColor: bgRow, borderLeft: borderLeft }}>
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
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', padding: '1.25rem 2rem' }}>
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={processing}
          >
            Cerrar Ventana
          </button>
        </div>
      </div>
    </div>
  );
};

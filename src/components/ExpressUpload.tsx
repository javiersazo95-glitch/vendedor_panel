import React, { useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, UploadCloud, XCircle, Zap } from 'lucide-react';
import { getAllProducts, savePreciosStockBatch } from '../db';
import { excedeTamanoMaximoDatos, mensajeArchivoDemasiadoGrande, pareceExcelValido, MENSAJE_EXCEL_INVALIDO } from '../utils/fileValidation';
import { sanitizeAoaForExport } from '../utils/xlsxSafety';
import {
  analizarExpress,
  detectarColumnasExpress,
  itemsParaEnviar,
  NOMBRE_EXPRESS,
  type AnalisisExpress,
  type FilaRetenida,
} from '../utils/expressPreciosStock';

/**
 * "Cambiar precios y stock" en dos pantallas: el archivo y la confirmación (Fase 6 del plan de
 * auditoría de carga). Reemplaza al modo Express que vivía dentro de BulkUpload.tsx, con su
 * tabla de 14 columnas, su modal "Editar SKU" y su historial guardado sólo en este navegador.
 *
 * Nada se guarda hasta que el vendedor confirma, y lo que se manda al backend es sólo el dato
 * que cambia: un producto "Sólo cotizar" sin precio en el archivo se actualiza sólo en stock.
 */

interface ExpressUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
  /** Todos los cambios se guardaron y no quedó ninguna fila fuera. */
  onExpressSuccess?: (cargados: number) => void;
  /** Vuelve a "¿Qué tienes?" (Fase 8). */
  onVolver: () => void;
  embedded?: boolean;
}

type Paso = 'archivo' | 'confirmar' | 'resultado';

const TEXTO = { fontSize: '0.95rem' } as const;
const TEXTO_SUAVE = { fontSize: '0.95rem', color: 'var(--text-secondary)' } as const;
const CELDA = { padding: '0.6rem 0.75rem', fontSize: '0.95rem' } as const;

const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;

const timestamp = (date = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
};

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nombre;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** FileReader y no Blob.text()/arrayBuffer(): son los que existen en todos los navegadores y en jsdom. */
function leerComo(file: File, como: 'texto'): Promise<string>;
function leerComo(file: File, como: 'bytes'): Promise<ArrayBuffer>;
function leerComo(file: File, como: 'texto' | 'bytes'): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    if (como === 'texto') reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

/** Todas las filas de la primera hoja (o del CSV) como texto, con el encabezado incluido. */
async function leerFilas(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name)) {
    const Papa = (await import('papaparse')).default;
    const texto = await leerComo(file, 'texto');
    return Papa.parse<unknown[]>(texto, { header: false, skipEmptyLines: true }).data;
  }
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await leerComo(file, 'bytes'));
  const libro = XLSX.read(data, { type: 'array' });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: '' });
}

const ListaFilas: React.FC<{ titulo: string; filas: FilaRetenida[]; tono: 'danger' | 'warning' }> = ({ titulo, filas, tono }) => (
  <div
    style={{
      background: tono === 'danger' ? 'var(--danger-bg)' : 'var(--warning-bg)',
      border: `1px solid hsl(var(--${tono}) / 0.3)`,
      borderRadius: '12px',
      padding: '0.85rem 1rem',
    }}
  >
    <p style={{ ...TEXTO, fontWeight: 700, color: `hsl(var(--${tono}))`, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
      <AlertTriangle size={17} /> {titulo}
    </p>
    <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem', maxHeight: '220px', overflowY: 'auto' }}>
      {filas.map((f) => (
        <li key={`${f.fila}-${f.sku}`} style={{ ...TEXTO, marginBottom: '0.25rem' }}>
          <strong>Fila {f.fila}</strong> · {f.sku}: {f.motivo}
        </li>
      ))}
    </ul>
  </div>
);

export const ExpressUpload: React.FC<ExpressUploadProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
  onExpressSuccess,
  onVolver,
  embedded = false,
}) => {
  const [paso, setPaso] = useState<Paso>('archivo');
  const [archivoNombre, setArchivoNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [analisis, setAnalisis] = useState<AnalisisExpress | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<{ guardados: number; fallidos: FilaRetenida[] } | null>(null);
  const enviandoRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const reiniciar = () => {
    setPaso('archivo');
    setArchivoNombre('');
    setError(null);
    setAnalisis(null);
    setResultado(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const descargarMisProductos = async () => {
    setError(null);
    try {
      const productos = await getAllProducts();
      const filas: (string | number)[][] = [['Código', 'Nombre', 'Precio', 'Stock']];
      for (const p of productos) {
        // Un "Sólo cotizar" va sin precio: si el vendedor no lo toca, al subirlo sólo cambia el stock.
        // Igual un precio 0 guardado de antes: exportarlo haría que el archivo recién descargado
        // se rechazara a sí mismo al subirlo ("el precio tiene que ser mayor que cero").
        const sinPrecio = p.pricingMode === 'quote_only' || !(p.price > 0);
        filas.push([p.sku, p.name, sinPrecio ? '' : p.price, p.stock]);
      }
      if (productos.length === 0) filas.push(['PF-100', 'Ejemplo: pastilla de freno', 24990, 10]);
      const XLSX = await import('xlsx');
      const hoja = XLSX.utils.aoa_to_sheet(sanitizeAoaForExport(filas));
      hoja['!cols'] = [{ wch: 18 }, { wch: 48 }, { wch: 12 }, { wch: 10 }];
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, 'Precios y stock');
      const salida = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
      descargar(new Blob([salida], { type: 'application/octet-stream' }), `mis-precios-y-stock_${timestamp()}.xlsx`);
    } catch {
      setError('No pudimos descargar tus productos. Revisa tu conexión e inténtalo de nuevo.');
    }
  };

  const leerArchivo = async (file: File) => {
    setError(null);
    setArchivoNombre(file.name);
    if (excedeTamanoMaximoDatos(file)) {
      setError(mensajeArchivoDemasiadoGrande(file));
      return;
    }
    setLeyendo(true);
    try {
      if (!(await pareceExcelValido(file))) {
        setError(MENSAJE_EXCEL_INVALIDO);
        return;
      }
      const filas = await leerFilas(file);
      const indiceEncabezado = filas.findIndex((f) => f.some((c) => String(c ?? '').trim() !== ''));
      if (indiceEncabezado < 0) {
        setError('El archivo está vacío.');
        return;
      }
      const encabezados = filas[indiceEncabezado].map((c) => String(c ?? '').trim());
      const columnas = detectarColumnasExpress(encabezados);
      const lista = encabezados.filter(Boolean).map((e) => `«${e}»`).join(', ');
      if (columnas.sku === null) {
        setError(`No encontramos la columna con el código de cada repuesto. Tu archivo tiene: ${lista}. Ponle a esa columna el título «Código» y vuelve a subirlo.`);
        return;
      }
      if (columnas.precio === null && columnas.stock === null) {
        setError(`No encontramos las columnas de precio ni de stock. Tu archivo tiene: ${lista}. Ponles los títulos «Precio» y «Stock» y vuelve a subirlo.`);
        return;
      }
      const productos = await getAllProducts();
      setAnalisis(analizarExpress(filas.slice(indiceEncabezado + 1), columnas, productos, indiceEncabezado + 2));
      setPaso('confirmar');
    } catch {
      setError('No pudimos leer el archivo. Revisa que sea un Excel o CSV e inténtalo de nuevo.');
    } finally {
      setLeyendo(false);
    }
  };

  const guardar = async () => {
    if (!analisis || analisis.cambios.length === 0 || enviandoRef.current) return;
    enviandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      const respuesta = await savePreciosStockBatch(itemsParaEnviar(analisis.cambios));
      const errores = new Map(respuesta.filas.filter((f) => f.estado === 'ERROR').map((f) => [f.sku, f]));
      const fallidos = analisis.cambios
        .filter((c) => errores.has(c.sku))
        .map((c) => ({ fila: c.fila, sku: c.sku, motivo: errores.get(c.sku)?.mensajes.join(' ') || 'No se pudo guardar.' }));
      const guardados = analisis.cambios.length - fallidos.length;
      onUploadSuccess();
      const todoLimpio = fallidos.length === 0 && analisis.retenidas.length === 0 && analisis.noEncontrados.length === 0;
      if (todoLimpio && onExpressSuccess) {
        onExpressSuccess(guardados);
        reiniciar();
        return;
      }
      setResultado({ guardados, fallidos });
      setPaso('resultado');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los cambios. Inténtalo de nuevo.');
    } finally {
      enviandoRef.current = false;
      setGuardando(false);
    }
  };

  const renderArchivo = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', maxWidth: '760px' }}>
      <button type="button" className="btn btn-secondary" style={{ ...TEXTO, alignSelf: 'flex-start', minHeight: '44px', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} onClick={onVolver} disabled={leyendo}>
        <ArrowLeft size={16} /> Elegir otra forma de cargar
      </button>

      <div>
        <p style={{ ...TEXTO, margin: 0 }}>
          Cambia el precio y el stock de repuestos que <strong>ya publicaste</strong>, todos de una vez.
          No se crean productos nuevos ni se cambia nada más.
        </p>
        <ol style={{ ...TEXTO, margin: '0.6rem 0 0', paddingLeft: '1.3rem', lineHeight: 1.6 }}>
          <li>Descarga tus productos en Excel.</li>
          <li>Cambia los precios y el stock que quieras. Puedes escribir los precios como siempre: <strong>$ 12.900</strong>.</li>
          <li>Sube el archivo. Antes de guardar vas a ver cada cambio.</li>
        </ol>
      </div>

      <button type="button" className="btn btn-secondary" style={{ ...TEXTO, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minHeight: '44px' }} onClick={descargarMisProductos}>
        <Download size={17} /> Descargar mis productos
      </button>

      {/* `.dropzone` es el recuadro punteado de la carga masiva; se puede abrir con Enter o
          Espacio, y lleva un botón visible porque un recuadro solo no parece clicable. */}
      <label
        className={`dropzone ${archivoNombre && !error ? 'active' : ''}`}
        style={{ padding: '2rem 1.5rem', gap: '0.6rem', cursor: leyendo ? 'wait' : 'pointer' }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <UploadCloud size={32} className="dropzone-icon" />
        <span style={{ fontSize: '1.05rem', fontWeight: 800 }}>{leyendo ? 'Leyendo el archivo…' : 'Sube el archivo con los precios y el stock'}</span>
        <span style={TEXTO_SUAVE}>Excel (.xlsx, .xls) o CSV. Necesita una columna con el código y otra con el precio o el stock.</span>
        <span className="btn btn-primary" style={{ ...TEXTO, minHeight: '44px', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', pointerEvents: 'none' }}>
          <FileSpreadsheet size={17} /> Elegir archivo
        </span>
        {archivoNombre && <span style={{ ...TEXTO, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><FileSpreadsheet size={15} /> {archivoNombre}</span>}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          aria-label="Elegir archivo de precios y stock"
          style={{ display: 'none' }}
          disabled={leyendo}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Siempre se limpia: tras un error, Chrome no avisa si se vuelve a elegir el mismo
            // archivo (ya corregido) y parecía que el botón no hacía nada.
            e.target.value = '';
            if (file) void leerArchivo(file);
          }}
        />
      </label>
    </div>
  );

  const renderConfirmar = () => {
    if (!analisis) return null;
    const { cambios, retenidas, noEncontrados, sinCambios } = analisis;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <h4 style={{ fontSize: '1.1rem', margin: 0 }}>Revisa los cambios antes de guardarlos</h4>
          <p style={{ ...TEXTO_SUAVE, margin: '0.3rem 0 0' }}>
            {cambios.length === 0
              ? 'Este archivo no trae ningún cambio que se pueda guardar.'
              : `${cambios.length === 1 ? 'Va a cambiar 1 repuesto' : `Van a cambiar ${cambios.length} repuestos`}. Nada se guarda hasta que confirmes.`}
            {sinCambios > 0 && ` ${sinCambios === 1 ? '1 repuesto ya tenía' : `${sinCambios} repuestos ya tenían`} ese precio y stock.`}
          </p>
        </div>

        {retenidas.length > 0 && (
          <ListaFilas
            tono="danger"
            titulo={retenidas.length === 1 ? '1 fila no se va a guardar hasta que la corrijas:' : `${retenidas.length} filas no se van a guardar hasta que las corrijas:`}
            filas={retenidas}
          />
        )}
        {noEncontrados.length > 0 && (
          <ListaFilas
            tono="warning"
            titulo={noEncontrados.length === 1 ? '1 código no está en tu inventario y se omite:' : `${noEncontrados.length} códigos no están en tu inventario y se omiten:`}
            filas={noEncontrados}
          />
        )}

        {cambios.length > 0 && (
          <div className="log-table-container" style={{ marginTop: 0, maxHeight: '420px' }}>
            <table className="log-table">
              <thead>
                <tr>
                  <th style={CELDA}>Código</th>
                  <th style={CELDA}>Repuesto</th>
                  <th style={CELDA}>Precio</th>
                  <th style={CELDA}>Stock</th>
                </tr>
              </thead>
              <tbody>
                {cambios.map((c) => (
                  <tr key={c.sku}>
                    <td style={CELDA}><strong>{c.sku}</strong></td>
                    <td style={CELDA}>
                      {c.nombre}
                      {c.avisos.map((aviso) => (
                        <div key={aviso} style={{ fontSize: '0.9rem', color: 'hsl(var(--warning))', marginTop: '0.2rem' }}>{aviso}</div>
                      ))}
                    </td>
                    <td style={CELDA}>
                      {c.precioDespues === null
                        ? <span style={{ color: 'var(--text-secondary)' }}>{c.soloCotizar ? 'Sólo cotizar' : `${pesos(c.precioAntes)} (igual)`}</span>
                        : <>{c.soloCotizar ? 'Sólo cotizar' : pesos(c.precioAntes)} → <strong>{pesos(c.precioDespues)}</strong></>}
                    </td>
                    <td style={CELDA}>
                      {c.stockDespues === null
                        ? <span style={{ color: 'var(--text-secondary)' }}>{c.stockAntes} (igual)</span>
                        : <>{c.stockAntes} → <strong>{c.stockDespues}</strong></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {cambios.length > 0 && (
            <button type="button" className="btn btn-primary" style={{ ...TEXTO, minHeight: '44px' }} onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : cambios.length === 1 ? 'Guardar 1 cambio' : `Guardar ${cambios.length} cambios`}
            </button>
          )}
          <button type="button" className="btn btn-secondary" style={{ ...TEXTO, minHeight: '44px' }} onClick={reiniciar} disabled={guardando}>
            Elegir otro archivo
          </button>
        </div>
      </div>
    );
  };

  const renderResultado = () => {
    if (!resultado || !analisis) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '760px' }}>
        <p style={{ fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'hsl(var(--success))', margin: 0 }}>
          <CheckCircle2 size={20} />
          {resultado.guardados === 1 ? 'Se guardó 1 cambio.' : `Se guardaron ${resultado.guardados} cambios.`}
        </p>
        {resultado.fallidos.length > 0 && (
          <ListaFilas tono="danger" titulo="Estos no se pudieron guardar:" filas={resultado.fallidos} />
        )}
        {analisis.retenidas.length > 0 && (
          <ListaFilas tono="danger" titulo="Estas filas no se guardaron; corrígelas en tu archivo y vuelve a subirlo:" filas={analisis.retenidas} />
        )}
        {analisis.noEncontrados.length > 0 && (
          <ListaFilas tono="warning" titulo="Estos códigos no están en tu inventario:" filas={analisis.noEncontrados} />
        )}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" style={{ ...TEXTO, minHeight: '44px' }} onClick={onClose}>Ver mi inventario</button>
          <button type="button" className="btn btn-secondary" style={{ ...TEXTO, minHeight: '44px' }} onClick={reiniciar}>Subir otro archivo</button>
        </div>
      </div>
    );
  };

  return (
    <div className={embedded ? 'bulk-upload-page' : 'modal-overlay'}>
      <div
        className={embedded ? 'bulk-upload-page-content' : 'modal-content'}
        style={embedded
          ? { width: '100%', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 118px)' }
          : { maxWidth: '1000px', width: '95%', maxHeight: '92vh' }}
      >
        <div className="modal-header">
          <div>
            <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Zap size={20} style={{ color: 'hsl(var(--primary))' }} />
              {NOMBRE_EXPRESS}
            </h3>
          </div>
          {!embedded && (
            <button className="btn-icon" onClick={onClose} disabled={guardando} aria-label="Cerrar">
              <XCircle size={20} />
            </button>
          )}
        </div>

        <div className="modal-body">
          {error && (
            <div role="alert" style={{ ...TEXTO, background: 'var(--danger-bg)', color: 'hsl(var(--danger))', padding: '0.75rem 1rem', borderRadius: '10px', display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem' }}>
              <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: '0.15rem' }} />
              {error}
            </div>
          )}
          {paso === 'archivo'
              ? renderArchivo()
              : paso === 'confirmar'
                ? renderConfirmar()
                : renderResultado()}
        </div>
      </div>
    </div>
  );
};

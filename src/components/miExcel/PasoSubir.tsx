/**
 * Etapa 1 · Sube tu archivo, compartida por las dos cargas con Excel. Primero, "¿tu propio Excel
 * o la plantilla de RepuesTop?" (con la plantilla para descargar). Después, dos cosas lado a lado:
 * el Excel (obligatorio) y la carpeta o ZIP con las fotos (opcional). Al leer el Excel el panel
 * dice qué es: con su propio Excel confirma la hoja y la fila de los títulos; con la plantilla no
 * hay nada que confirmar.
 */
import React, { useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Download, FileArchive, FileSpreadsheet, FolderOpen,
  ImagePlus, Info, Loader2, ShieldCheck, Wand2, X,
} from 'lucide-react';
import type { HojaUsuario } from '../../utils/plantillaMapping';
import { columnLetter } from '../../utils/plantillaMapping';
import type { TipoCarga } from '../../utils/miExcelBorrador';
import { descargarPlantilla } from '../../utils/cargaExcelApi';
import { getStoredSession } from '../../utils/session';
import { plural } from './textos';

/** Filas crudas que se muestran para confirmar dónde están los títulos. */
const FILAS_VISTA = 6;
/** El backend no acepta más filas que esto en una carga. */
export const LIMITE_FILAS_CARGA = 5000;

interface Props {
  archivo: File | null;
  hojas: HojaUsuario[];
  hojaIndex: number;
  filaEncabezados: number;
  columnas: number;
  filas: number;
  leyendo: boolean;
  error: string | null;
  onArchivo: (file: File) => void;
  onQuitarArchivo: () => void;
  onElegirHoja: (indice: number) => void;
  onElegirFila: (fila: number) => void;

  fotos: number;
  origenFotos: 'carpeta' | 'zip' | null;
  nombreZip: string | null;
  leyendoFotos: boolean;
  errorFotos: string | null;
  /** Fotos que ya estaban guardadas en el progreso (al retomar sin volver a elegir la carpeta). */
  fotosGuardadas: number;
  onCarpeta: (files: FileList) => void;
  onZip: (file: File) => void;
  onQuitarFotos: () => void;

  /** Qué resultó ser el archivo, una vez leído. */
  tipo: TipoCarga | null;
  versionPlantilla: string | null;
  /** La fila de ejemplo de la plantilla, si el vendedor la dejó: no se carga. */
  filasEjemploQuitadas: number;

  onCancelar: () => void;
  onSiguiente: () => void;
}

/** "¿Tu propio Excel o la plantilla?": sin archivo todavía, las dos entradas y la descarga. */
function QueExcelTienes() {
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descargada, setDescargada] = useState(false);
  const descargar = async () => {
    const s = getStoredSession();
    if (!s?.sellerId || !s?.token) { setError('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
    setDescargando(true);
    setError(null);
    try {
      await descargarPlantilla(s.sellerId, s.token);
      setDescargada(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar la plantilla.');
    } finally {
      setDescargando(false);
    }
  };
  return (
    <section className="mx-que-excel" aria-label="¿Tienes tu propio Excel o prefieres la plantilla de RepuesTop?">
      <h4 className="mx-subtitulo">¿Tienes tu propio Excel o prefieres la plantilla de RepuesTop?</h4>
      <div className="mx-que-excel-opciones">
        <div className="mx-tarjeta mx-que-excel-opcion">
          <Wand2 size={24} />
          <div>
            <strong>Tengo mi Excel</strong>
            <span>Súbelo abajo tal como lo usas hoy. Te ayudamos a relacionar tus columnas con las de RepuesTop.</span>
          </div>
        </div>
        <div className="mx-tarjeta mx-que-excel-opcion">
          <FileSpreadsheet size={24} />
          <div>
            <strong>Prefiero la plantilla de RepuesTop</strong>
            <span>
              Trae listas para elegir categoría, marca, modelo, años y motor, sólo con lo que existe en RepuesTop.
              Llénala y súbela abajo: la reconocemos sola y no hay columnas que relacionar.
            </span>
            <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" onClick={() => void descargar()} disabled={descargando}>
              {descargando ? <Loader2 size={15} className="mx-girando" /> : <Download size={15} />} Descargar la plantilla
            </button>
            {descargada && <span className="mx-nota"><CheckCircle2 size={14} /> Descargada. Revisa tu carpeta de descargas.</span>}
            {error && <span className="mx-error-texto">{error}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

export function PasoSubir(p: Props) {
  const inputExcel = useRef<HTMLInputElement>(null);
  const inputCarpeta = useRef<HTMLInputElement>(null);
  const inputZip = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const hoja = p.hojas[p.hojaIndex];
  const filasVista = (hoja?.aoa ?? []).slice(0, Math.max(FILAS_VISTA, p.filaEncabezados + 2));
  const anchoVista = Math.min(8, filasVista.reduce((max, f) => Math.max(max, (f as unknown[]).length), 0));
  const sinTitulos = !!p.archivo && p.columnas === 0;
  const sinFilas = !!p.archivo && p.columnas > 0 && p.filas === 0;
  const demasiadas = p.filas > LIMITE_FILAS_CARGA;
  const puedeSeguir = !!p.archivo && !sinTitulos && !sinFilas && !p.leyendo;
  /** Por qué todavía no se puede seguir, en palabras del vendedor (se muestra junto al botón). */
  const motivoNoSigue = p.leyendo ? 'Leyendo tu archivo…'
    : !p.archivo ? 'Sube tu Excel para seguir.'
      : sinTitulos ? 'Elige la fila donde están los títulos de tus columnas.'
        : sinFilas ? (p.tipo === 'plantilla' ? 'La plantilla no tiene repuestos: llena una fila por repuesto.' : 'Debajo de los títulos no hay repuestos: elige otra fila u otra hoja.')
          : null;

  const soltar = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastrando(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !p.leyendo) p.onArchivo(file);
  };

  return (
    <div className="mx-paso">
      <div className="mx-explica">
        <Info size={18} />
        <p>
          Sube <b>tu propio Excel tal como lo usas hoy</b> o la <b>plantilla de RepuesTop</b> ya llena: reconocemos
          cuál es. Si tienes las fotos de tus repuestos en una carpeta, súbela también: las asignamos solas a cada
          repuesto por su código. Nada se publica hasta el último paso.
        </p>
      </div>

      {!p.archivo && <QueExcelTienes />}

      <div className="mx-subir-grid">
        {/* ---------------------------- El Excel ---------------------------- */}
        <section className={`mx-tarjeta mx-subir-tarjeta ${p.archivo ? 'lista' : ''}`}>
          <header className="mx-tarjeta-titulo">
            <span className="mx-num">1</span>
            <div>
              <h4>Tu Excel de inventario</h4>
              <p>Obligatorio · tu Excel o la plantilla · .xlsx, .xls o .csv</p>
            </div>
          </header>
          {p.archivo ? (
            <div className="mx-archivo-listo">
              <FileSpreadsheet size={28} />
              <div>
                <strong>{p.archivo.name}</strong>
                <span>
                  {p.hojas.length > 1 ? `Hoja "${hoja?.nombre}" · ` : ''}
                  {plural(p.filas, 'fila', 'filas')} · {plural(p.columnas, 'columna', 'columnas')}
                </span>
              </div>
              <button type="button" className="mx-icono-btn" onClick={p.onQuitarArchivo} aria-label="Quitar el archivo" title="Elegir otro archivo">
                <X size={16} />
              </button>
            </div>
          ) : (
            <div
              className={`mx-zona ${arrastrando ? 'arrastrando' : ''} ${p.leyendo ? 'ocupada' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Elegir tu Excel"
              onClick={() => !p.leyendo && inputExcel.current?.click()}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !p.leyendo) { e.preventDefault(); inputExcel.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); if (!p.leyendo) setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={soltar}
            >
              <FileSpreadsheet size={34} />
              <strong>{p.leyendo ? 'Leyendo tu archivo…' : 'Arrastra tu Excel aquí'}</strong>
              <span>o haz clic para buscarlo en tu computador</span>
            </div>
          )}
          <input
            ref={inputExcel}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            data-testid="mx-input-excel"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onArchivo(f); e.target.value = ''; }}
          />
          {p.error && <div className="mx-alerta error"><AlertTriangle size={16} /> {p.error}</div>}
          {p.archivo && p.tipo === 'plantilla' && (
            <div className="mx-alerta ok" role="status">
              <CheckCircle2 size={16} />
              <span>
                <b>Es la plantilla de RepuesTop</b>{p.versionPlantilla ? ` (versión ${p.versionPlantilla})` : ''}: sus columnas ya son las
                nuestras, así que no hay nada que relacionar. En el siguiente paso corriges lo que falte.
                {p.filasEjemploQuitadas > 0 && <> La fila de ejemplo (SKU-001) no se carga.</>}
              </span>
            </div>
          )}
          {p.archivo && p.tipo === 'mi-excel' && (
            <div className="mx-alerta info" role="status">
              <Wand2 size={16} />
              <span><b>Es tu propio Excel.</b> En el paso 2 te ayudamos a relacionar tus columnas con las de RepuesTop.</span>
            </div>
          )}
        </section>

        {/* ---------------------------- Las fotos ---------------------------- */}
        <section className={`mx-tarjeta mx-subir-tarjeta ${p.fotos > 0 ? 'lista' : ''}`}>
          <header className="mx-tarjeta-titulo">
            <span className="mx-num">2</span>
            <div>
              <h4>Fotos de tus repuestos</h4>
              <p>Opcional · puedes agregarlas después</p>
            </div>
          </header>
          {p.fotos > 0 ? (
            <div className="mx-archivo-listo">
              {p.origenFotos === 'zip' ? <FileArchive size={28} /> : <FolderOpen size={28} />}
              <div>
                <strong>{plural(p.fotos, 'foto lista', 'fotos listas')}</strong>
                <span>{p.origenFotos === 'zip' ? `Desde ${p.nombreZip ?? 'tu ZIP'}` : 'Desde tu carpeta'}</span>
              </div>
              <button type="button" className="mx-icono-btn" onClick={p.onQuitarFotos} aria-label="Quitar las fotos" title="Quitar las fotos">
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="mx-fotos-botones">
              <button
                type="button"
                className="mx-boton-carpeta"
                onClick={() => inputCarpeta.current?.click()}
                disabled={p.leyendoFotos}
              >
                <FolderOpen size={30} />
                <strong>Elegir carpeta</strong>
                <span>La carpeta donde tienes las fotos</span>
              </button>
              <button
                type="button"
                className="mx-boton-carpeta"
                onClick={() => inputZip.current?.click()}
                disabled={p.leyendoFotos}
              >
                <FileArchive size={30} />
                <strong>Subir ZIP</strong>
                <span>Si las tienes comprimidas</span>
              </button>
            </div>
          )}
          <input
            ref={inputCarpeta}
            type="file"
            multiple
            hidden
            data-testid="mx-input-carpeta"
            {...{ webkitdirectory: '', directory: '' }}
            onChange={(e) => { if (e.target.files?.length) p.onCarpeta(e.target.files); e.target.value = ''; }}
          />
          <input
            ref={inputZip}
            type="file"
            accept=".zip"
            hidden
            data-testid="mx-input-zip"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onZip(f); e.target.value = ''; }}
          />
          {p.leyendoFotos && <p className="mx-nota">Leyendo tus fotos…</p>}
          {p.errorFotos && <div className="mx-alerta error"><AlertTriangle size={16} /> {p.errorFotos}</div>}
          {p.fotosGuardadas > 0 && p.fotos === 0 && (
            <p className="mx-nota"><CheckCircle2 size={14} /> Tienes {plural(p.fotosGuardadas, 'foto guardada', 'fotos guardadas')} de tu progreso anterior.</p>
          )}
          <p className="mx-consejo">
            <ImagePlus size={15} />
            <span>
              <b>Consejo:</b> nombra cada foto con el código del repuesto (ej. <code>ABC123.jpg</code>,{' '}
              <code>ABC123_2.jpg</code>) y la asignamos sola. Si no, la eliges en el paso {p.tipo === 'plantilla' ? 2 : 3}.
            </span>
          </p>
        </section>
      </div>

      {/* ------------------- Hoja y fila de títulos ------------------- */}
      {/* La plantilla no necesita confirmar hoja ni títulos: son siempre los mismos. */}
      {p.archivo && p.tipo === 'plantilla' && (sinFilas || demasiadas) && (
        <section className="mx-tarjeta">
          {sinFilas && <div className="mx-alerta aviso"><AlertTriangle size={16} /> La plantilla no tiene repuestos: llena una fila por repuesto debajo de los títulos.</div>}
          {demasiadas && (
            <div className="mx-alerta aviso">
              <AlertTriangle size={16} />
              <span>
                Tu plantilla tiene {plural(p.filas, 'fila', 'filas')}. RepuesTop recibe hasta {LIMITE_FILAS_CARGA.toLocaleString('es-CL')} por
                carga: te conviene dividirla en dos y cargarlas por separado.
              </span>
            </div>
          )}
        </section>
      )}

      {p.archivo && p.tipo !== 'plantilla' && p.hojas.length > 0 && (
        <section className="mx-tarjeta">
          {p.hojas.length > 1 && (
            <div className="mx-bloque">
              <h4 className="mx-subtitulo">¿Qué hoja de tu Excel quieres cargar?</h4>
              <div className="mx-hojas">
                {p.hojas.map((h, i) => (
                  <button
                    type="button"
                    key={h.nombre}
                    className={`mx-hoja ${i === p.hojaIndex ? 'sel' : ''}`}
                    onClick={() => p.onElegirHoja(i)}
                    aria-pressed={i === p.hojaIndex}
                  >
                    <b>{h.nombre}</b>
                    <span>{plural(Math.max(h.filasConDatos - 1, 0), 'fila con datos', 'filas con datos')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mx-bloque">
            <h4 className="mx-subtitulo">¿Estamos leyendo bien tu archivo?</h4>
            {/* H48 (prueba del 30-sep): "marcamos en azul" no decía para qué se usa esa fila. Ahora se
                nombra la fila y lo que pasa con ella. */}
            <p className="mx-ayuda">
              Usaremos la <b>fila {p.filaEncabezados + 1}</b> (en azul) como los <b>títulos de tus columnas</b>:
              con ellos las relacionas en el paso 2. Lo que está arriba de esa fila no se carga.
              ¿No es esa? Haz clic en la fila correcta.
            </p>
            <div className="mx-tabla-cruda-wrap">
              <table className="mx-tabla-cruda">
                <thead>
                  <tr>
                    <th aria-label="Fila" />
                    {Array.from({ length: anchoVista }, (_, c) => <th key={c}>{columnLetter(c)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filasVista.map((fila, i) => (
                    <tr
                      key={i}
                      className={i === p.filaEncabezados ? 'titulos' : i < p.filaEncabezados ? 'fuera' : ''}
                      onClick={() => p.onElegirFila(i)}
                      title={`Usar la fila ${i + 1} como títulos`}
                    >
                      <th scope="row">
                        {i + 1}
                        {i === p.filaEncabezados && <span className="mx-etiqueta-titulos">Títulos de tus columnas</span>}
                      </th>
                      {Array.from({ length: anchoVista }, (_, c) => <td key={c}>{String((fila as unknown[])[c] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {sinTitulos && <div className="mx-alerta aviso"><AlertTriangle size={16} /> Esa fila no tiene títulos. Elige otra fila u otra hoja.</div>}
          {sinFilas && <div className="mx-alerta aviso"><AlertTriangle size={16} /> Debajo de esa fila no hay datos. Elige otra fila u otra hoja.</div>}
          {demasiadas && (
            <div className="mx-alerta aviso">
              <AlertTriangle size={16} />
              <span>
                Tu archivo tiene {plural(p.filas, 'fila', 'filas')}. RepuesTop recibe hasta{' '}
                {LIMITE_FILAS_CARGA.toLocaleString('es-CL')} por carga: te conviene dividirlo en dos archivos y
                cargarlos por separado. Puedes seguir igual, pero la publicación se va a rechazar.
              </span>
            </div>
          )}
        </section>
      )}

      <p className="mx-letra-chica"><ShieldCheck size={14} /> Tu archivo se lee en tu navegador. Guardamos tu progreso en tu cuenta para que puedas retomarlo.</p>

      <footer className="mx-pie">
        <button type="button" className="btn btn-secondary mx-btn" onClick={p.onCancelar}>
          <ArrowLeft size={16} /> Volver
        </button>
        {motivoNoSigue && <span className="mx-pie-motivo" role="status">{motivoNoSigue}</span>}
        <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={p.onSiguiente} disabled={!puedeSeguir} title={motivoNoSigue ?? undefined}>
          {p.tipo === 'plantilla' ? 'Siguiente: corregir' : 'Siguiente: relacionar columnas'} <ArrowRight size={16} />
        </button>
      </footer>
    </div>
  );
}

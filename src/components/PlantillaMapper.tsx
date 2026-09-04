import React, { useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, Wand2, AlertTriangle, ArrowLeft, ArrowRight, Download, X,
  UploadCloud, ArrowLeftRight, ListChecks, Rocket, ShieldCheck, Check, Image as ImageIcon,
} from 'lucide-react';
import {
  ESQUEMA_FALLBACK,
  camposDesdeEsquema,
  autoDetectMapping,
  reconcileMapping,
  buildOfficialAoA,
  buildOfficialAoADetallado,
  buildOfficialXlsxFile,
  leerLibro,
  columnasDeHoja,
  detectarFilaEncabezados,
  elegirHojaInicial,
  columnLetter,
  headerSignature,
  loadSavedMapping,
  saveMapping,
  distinctValuesForColumn,
  mappedEnumColumns,
  getIsoTimestampString,
  type CampoMeta,
  type HojaUsuario,
  type Mapping,
  type UserColumn,
  type EsquemaPlantilla,
} from '../utils/plantillaMapping';
import { revisarAoA, fichaDesdeFila, type FilaRevisada } from '../utils/plantillaRevision';
import {
  agruparCambios,
  normalizarCelda,
  pareceColumnaDeRangos,
  partirRangoAnios,
} from '../utils/plantillaNormalizacion';

interface PlantillaMapperProps {
  onGenerated: (file: File) => void;
  onCancel: () => void;
  /** Esquema vigente de la plantilla. Por defecto, el contrato de respaldo del panel. */
  esquema?: EsquemaPlantilla;
}

const BIG_FILE_ROWS = 5000;
const VALUE_MAP_CAP = 20;
/** Filas crudas que se muestran para que el vendedor confirme dónde están sus títulos. */
const PREVIEW_ROWS = 6;

/** Los cuatro pasos del flujo. El 4 es la acción final, no una pantalla más. */
const PASOS = [
  { n: 1, titulo: 'Sube tu archivo' },
  { n: 2, titulo: 'Relaciona' },
  { n: 3, titulo: 'Revisa' },
  { n: 4, titulo: 'Genera' },
] as const;

/** ¿La columna que quedó en "año desde" trae rangos en una sola celda? */
function traeRangosDeAnios(mapping: Mapping, cols: UserColumn[], rows: unknown[][]): boolean {
  const id = mapping.oficial.anio_desde;
  const col = id ? cols.find((c) => c.id === id) : undefined;
  if (!col) return false;
  return pareceColumnaDeRangos(rows.slice(0, 50).map((r) => String((r as unknown[])[col.index] ?? '')));
}

const plural = (n: number, singular: string, plural_: string) =>
  `${n.toLocaleString('es-CL')} ${n === 1 ? singular : plural_}`;

export const PlantillaMapper: React.FC<PlantillaMapperProps> = ({
  onGenerated,
  onCancel,
  esquema = ESQUEMA_FALLBACK,
}) => {
  const [userFile, setUserFile] = useState<File | null>(null);
  const [hojas, setHojas] = useState<HojaUsuario[]>([]);
  const [hojaIndex, setHojaIndex] = useState(0);
  const [filaEncabezados, setFilaEncabezados] = useState(0);
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [userCols, setUserCols] = useState<UserColumn[]>([]);
  const [userRows, setUserRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reused, setReused] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Todo lo que esta pantalla recorre sale del esquema del backend: las columnas, cuáles
  // son obligatorias y qué valores acepta cada lista.
  const campos = useMemo(() => camposDesdeEsquema(esquema), [esquema]);

  /**
   * Aplica una elección de hoja + fila de títulos: recalcula columnas y filas, y vuelve a
   * proponer la relación entre columnas. Se llama desde los handlers y no desde un efecto
   * para que el vendedor vea el resultado en el mismo clic.
   */
  const aplicarSeleccion = (libro: HojaUsuario[], indiceHoja: number, fila: number) => {
    const hoja = libro[indiceHoja];
    const { cols, rows } = columnasDeHoja(hoja?.aoa ?? [], fila);
    const saved = cols.length ? loadSavedMapping(headerSignature(cols)) : null;
    const base = saved ? reconcileMapping(saved, cols, campos) : autoDetectMapping(cols, campos);
    setUserCols(cols);
    setUserRows(rows);
    // Si la columna de años trae rangos ("2014-2020"), se propone dividirla de entrada:
    // es el formato más común en las listas de repuestos, y el vendedor puede desactivarlo.
    setMapping({ ...base, dividirAnios: base.dividirAnios ?? traeRangosDeAnios(base, cols, rows) });
    setReused(!!saved);
    setHojaIndex(indiceHoja);
    setFilaEncabezados(fila);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setParsing(true);
    setParseError(null);
    try {
      const libro = await leerLibro(file);
      const indiceHoja = elegirHojaInicial(libro);
      const fila = detectarFilaEncabezados(libro[indiceHoja].aoa);
      setHojas(libro);
      aplicarSeleccion(libro, indiceHoja, fila);
      setUserFile(file);
      setPaso(1);
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'No se pudo leer el archivo.';
      resetFile();
      setParseError(mensaje);
    } finally {
      setParsing(false);
    }
  };

  const resetFile = () => {
    setUserFile(null);
    setHojas([]);
    setHojaIndex(0);
    setFilaEncabezados(0);
    setUserCols([]);
    setUserRows([]);
    setMapping(null);
    setReused(false);
    setParseError(null);
    setPaso(1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const colById = useMemo(() => new Map(userCols.map((c) => [c.id, c])), [userCols]);

  const referencedIds = useMemo(() => {
    const set = new Set<string>();
    if (mapping) Object.values(mapping.oficial).forEach((id) => { if (id) set.add(id); });
    return set;
  }, [mapping]);

  const unassignedCols = useMemo(
    () => userCols.filter((c) => !referencedIds.has(c.id)),
    [userCols, referencedIds],
  );

  const usageCount = useMemo(() => {
    const counts = new Map<string, number>();
    if (mapping) {
      Object.values(mapping.oficial).forEach((id) => {
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      });
    }
    return counts;
  }, [mapping]);

  const counts = useMemo(() => {
    if (!mapping) return { asignadas: 0, sinAsignar: 0, aDescripcion: 0, ignoradas: 0 };
    const asignadas = campos.filter((c) => mapping.oficial[c.key]).length;
    const ignoradas = unassignedCols.filter((c) => mapping.extras[c.id] === 'ignore').length;
    return {
      asignadas,
      sinAsignar: unassignedCols.length,
      aDescripcion: unassignedCols.length - ignoradas,
      ignoradas,
    };
  }, [mapping, unassignedCols, campos]);

  /**
   * Obligatorios que siguen sin resolver. Un valor fijo para todas las filas cuenta como
   * resuelto: hay vendedores cuyo Excel simplemente no trae esa columna porque para ellos
   * es siempre la misma.
   */
  const missingRequired = useMemo(
    () => (mapping
      ? campos.filter((c) => c.required && !mapping.oficial[c.key] && !(mapping.defaults?.[c.key] ?? '').trim())
      : []),
    [mapping, campos],
  );

  const enumColumns = useMemo(
    () => (mapping ? mappedEnumColumns(mapping, campos) : []),
    [mapping, campos],
  );

  /**
   * Revisión del archivo ya transformado. Se calcula sólo en el paso 3 porque transforma
   * todas las filas, y en los pasos anteriores no se muestra.
   */
  const { revision, cambios } = useMemo(() => {
    if (paso !== 3 || !mapping) return { revision: null, cambios: [] };
    const { aoa, cambios: hechos } = buildOfficialAoADetallado(userRows, userCols, mapping, campos);
    return {
      revision: revisarAoA(aoa, campos, { maxFilas: 20, primeraFilaArchivo: filaEncabezados + 2 }),
      cambios: hechos,
    };
  }, [paso, mapping, userRows, userCols, campos, filaEncabezados]);

  /** Los arreglos automáticos, agrupados para poder mostrarlos como "antes → después". */
  const arreglos = useMemo(() => agruparCambios(cambios), [cambios]);

  /**
   * Columnas que vale la pena mostrar en la tabla: las que traen algo o las que tienen
   * algún problema. Las 18 completas obligan a un scroll largo lleno de celdas vacías, y
   * lo que hay que mirar se pierde.
   */
  const columnasVisibles = useMemo(() => {
    if (!revision) return [];
    return revision.columnas.filter((col, i) =>
      revision.filas.some((f) => (f.valores[i] ?? '').trim() !== '' || f.problemas.some((p) => p.columna === col)),
    );
  }, [revision]);

  /** El primer repuesto que sí se puede publicar: es el que vale la pena mostrar armado. */
  const ficha = useMemo(() => {
    if (!revision) return null;
    const fila = revision.filas.find((f) => !f.tieneError) ?? revision.filas[0];
    return fila ? fichaDesdeFila(revision.columnas, fila.valores) : null;
  }, [revision]);

  const setOficial = (key: string, valueId: string) => {
    setMapping((prev) => {
      if (!prev) return prev;
      const oficial = { ...prev.oficial, [key]: valueId || null };
      const extras = { ...prev.extras };
      if (valueId) delete extras[valueId];
      const referenced = new Set(Object.values(oficial).filter(Boolean) as string[]);
      userCols.forEach((c) => {
        if (!referenced.has(c.id) && !(c.id in extras)) extras[c.id] = 'descripcion';
      });
      return { ...prev, oficial, extras };
    });
  };

  const setExtra = (id: string, policy: 'descripcion' | 'ignore') => {
    setMapping((prev) => (prev ? { ...prev, extras: { ...prev.extras, [id]: policy } } : prev));
  };

  const setValue = (colKey: string, sourceValue: string, target: string) => {
    setMapping((prev) => {
      if (!prev) return prev;
      const valueMap = { ...prev.valueMap };
      const table = { ...(valueMap[colKey] ?? {}) };
      if (target) table[sourceValue] = target;
      else delete table[sourceValue];
      valueMap[colKey] = table;
      return { ...prev, valueMap };
    });
  };

  const columnaAniosConRangos = useMemo(
    () => (mapping ? traeRangosDeAnios(mapping, userCols, userRows) : false),
    [mapping, userCols, userRows],
  );

  /** Un ejemplo real del archivo, que dice más que cualquier explicación. */
  const ejemploRangoAnios = useMemo(() => {
    const id = mapping?.oficial.anio_desde;
    const col = id ? userCols.find((c) => c.id === id) : undefined;
    if (!col) return '';
    for (const row of userRows.slice(0, 50)) {
      const bruto = String((row as unknown[])[col.index] ?? '');
      const rango = partirRangoAnios(bruto);
      if (rango) return `"${bruto.trim()}" queda como ${rango.desde} y ${rango.hasta}`;
    }
    return '';
  }, [mapping, userCols, userRows]);

  const setDividirAnios = (valor: boolean) => {
    setMapping((prev) => (prev ? { ...prev, dividirAnios: valor } : prev));
  };

  const setDefault = (colKey: string, valor: string) => {
    setMapping((prev) => {
      if (!prev) return prev;
      const defaults = { ...(prev.defaults ?? {}) };
      if (valor.trim()) defaults[colKey] = valor;
      else delete defaults[colKey];
      return { ...prev, defaults };
    });
  };

  const buildFile = async (): Promise<File> => {
    const aoa = buildOfficialAoA(userRows, userCols, mapping as Mapping, campos);
    return buildOfficialXlsxFile(aoa, `plantilla-adaptada_${getIsoTimestampString()}.xlsx`, esquema.version);
  };

  const handleGenerate = () => {
    if (!mapping) return;
    setGenerating(true);
    // Deja pintar el spinner antes de un build potencialmente pesado.
    setTimeout(async () => {
      try {
        const file = await buildFile();
        saveMapping(headerSignature(userCols), mapping);
        onGenerated(file);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'No se pudo generar el archivo.');
        setGenerating(false);
      }
    }, 30);
  };

  const handleDownloadGenerated = async () => {
    if (!mapping) return;
    try {
      const file = await buildFile();
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'No se pudo generar el archivo.');
    }
  };

  const sampleValue = (col: UserColumn): string => {
    for (const row of userRows) {
      const v = String((row as unknown[])[col.index] ?? '').trim();
      if (v) return v;
    }
    return '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (!parsing) handleFile(e.dataTransfer.files?.[0] ?? null);
  };

  /** Barra de pasos: dónde estoy, qué falta. Visible en todo el flujo. */
  const renderPasos = (actual: number) => (
    <ol className="mapper-progress" aria-label="Pasos para adaptar tu plantilla">
      {PASOS.map((p) => {
        const estado = p.n < actual ? 'listo' : p.n === actual ? 'actual' : 'pendiente';
        return (
          <li key={p.n} className={`mapper-progress-step ${estado}`} aria-current={estado === 'actual' ? 'step' : undefined}>
            <span className="mapper-progress-num">{estado === 'listo' ? <Check size={16} /> : p.n}</span>
            <span className="mapper-progress-label">{p.titulo}</span>
          </li>
        );
      })}
    </ol>
  );

  /* --------------------------- Antes de subir nada --------------------------- */
  if (!userFile || !mapping) {
    const explicacion = [
      { icon: <UploadCloud size={18} />, t: 'Sube tu archivo', d: 'Tu Excel o CSV tal como lo tienes hoy. Si trae varias hojas, tú eliges cuál.' },
      { icon: <ArrowLeftRight size={18} />, t: 'Relaciona tus columnas', d: 'Nos dices qué columna tuya corresponde a cada dato que pide RepuesTop. Te proponemos la relación y tú la corriges.' },
      { icon: <ListChecks size={18} />, t: 'Revisa', d: 'Miras cómo quedó antes de generar nada. Las columnas que te sobran las mandas a la descripción o las dejas fuera.' },
      { icon: <Rocket size={18} />, t: 'Genera', d: 'Creamos el Excel con el formato de RepuesTop y sigues con la carga normal.' },
    ];
    return (
      <div className="mapper mapper-intro">
        <div className="mapper-hero">
          <span className="mapper-hero-grid" aria-hidden />
          <div className="mapper-hero-icon"><Wand2 size={22} /></div>
          <div className="mapper-hero-text">
            <span className="mapper-kicker">Carga inteligente</span>
            <h4>Adapta tu propia plantilla</h4>
            <p>
              ¿Ya llevas tu inventario en tu propio Excel? No lo rehagas. Sube tu archivo tal cual,
              relaciona tus columnas con las de RepuesTop <b>una sola vez</b> y generamos la plantilla
              oficial lista para publicar en la plataforma web y en la app. Ninguna columna se pierde
              en el camino.
            </p>
          </div>
        </div>

        {renderPasos(1)}

        <ol className="mapper-steps">
          {explicacion.map((p, i) => (
            <li key={p.t}>
              <span className="mapper-step-num">{i + 1}</span>
              <div className="mapper-step-body">
                <span className="mapper-step-icon">{p.icon}</span>
                <b>{p.t}</b>
                <span>{p.d}</span>
              </div>
            </li>
          ))}
        </ol>

        {parseError && (
          <div className="mapper-alert error"><AlertTriangle size={15} /> {parseError}</div>
        )}

        <div
          className={`dropzone compact mapper-dropzone ${parsing ? 'blocked' : ''} ${dragActive ? 'drag' : ''}`}
          role="button"
          tabIndex={0}
          style={{ height: '160px', cursor: parsing ? 'wait' : 'pointer' }}
          onClick={() => !parsing && fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (!parsing) setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !parsing) {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <FileSpreadsheet size={28} className="dropzone-icon" />
          <span className="dropzone-title">{parsing ? 'Leyendo tu archivo…' : 'Arrastra tu Excel aquí'}</span>
          <span className="dropzone-desc">o haz clic para seleccionarlo · .xlsx, .xls, .csv</span>
        </div>

        <p className="mapper-fineprint">
          <ShieldCheck size={13} /> Tu archivo se procesa en tu navegador. Nada se sube ni se publica
          hasta que confirmes la carga.
        </p>

        <div className="mapper-footer">
          <button type="button" className="btn btn-secondary mapper-btn" onClick={onCancel}>
            <ArrowLeft size={16} /> Volver
          </button>
        </div>
      </div>
    );
  }

  const hoja = hojas[hojaIndex];
  const bigFile = userRows.length > BIG_FILE_ROWS;
  const sinTitulos = userCols.length === 0;
  const sinFilas = userRows.length === 0;
  const puedeAvanzarDelPaso1 = !sinTitulos && !sinFilas;

  const chipArchivo = (
    <div className="mapper-file-chip">
      <FileSpreadsheet size={15} />
      <strong>{userFile.name}</strong>
      <span>
        {hojas.length > 1 ? `hoja "${hoja?.nombre}" · ` : ''}
        {`${plural(userRows.length, 'fila', 'filas')} · ${plural(userCols.length, 'columna', 'columnas')}`}
      </span>
      <button type="button" onClick={resetFile} title="Cambiar archivo"><X size={14} /></button>
    </div>
  );

  /* ------------------- Paso 1: qué hoja y dónde están los títulos ------------------ */
  if (paso === 1) {
    const filasPreview = (hoja?.aoa ?? []).slice(0, Math.max(PREVIEW_ROWS, filaEncabezados + 2));
    const anchoPreview = Math.min(
      8,
      filasPreview.reduce((max, f) => Math.max(max, (f as unknown[]).length), 0),
    );

    return (
      <div className="mapper">
        <div className="mapper-hero compact">
          <span className="mapper-hero-grid" aria-hidden />
          <div className="mapper-hero-icon"><UploadCloud size={20} /></div>
          <div className="mapper-hero-text">
            <span className="mapper-kicker">Paso 1 de 4 · Tu archivo</span>
            <h4>Revisemos que estemos leyendo bien tu archivo</h4>
            <p>
              Marcamos en azul la fila donde creemos que están los títulos de tus columnas.
              Si nos equivocamos, haz clic en la fila correcta.
            </p>
          </div>
        </div>

        {renderPasos(1)}
        {chipArchivo}
        {parseError && <div className="mapper-alert error"><AlertTriangle size={15} /> {parseError}</div>}

        {hojas.length > 1 && (
          <section className="mapper-section">
            <span className="bulk-purpose-label">¿Qué hoja de tu Excel quieres cargar?</span>
            <div className="mapper-sheet-list">
              {hojas.map((h, i) => (
                <button
                  type="button"
                  key={h.nombre}
                  className={`mapper-sheet ${i === hojaIndex ? 'sel' : ''}`}
                  onClick={() => aplicarSeleccion(hojas, i, detectarFilaEncabezados(h.aoa))}
                >
                  <b>{h.nombre}</b>
                  <span>{plural(Math.max(h.filasConDatos - 1, 0), 'fila con datos', 'filas con datos')}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mapper-section">
          <span className="bulk-purpose-label">¿En qué fila están los títulos de tus columnas?</span>
          <div className="mapper-preview-wrap">
            <table className="mapper-preview">
              <tbody>
                {filasPreview.map((fila, i) => (
                  <tr
                    key={i}
                    className={i === filaEncabezados ? 'titulos' : ''}
                    onClick={() => aplicarSeleccion(hojas, hojaIndex, i)}
                    title={`Usar la fila ${i + 1} como títulos`}
                  >
                    <th scope="row">
                      {i + 1}
                      {i === filaEncabezados && <span className="mapper-preview-tag">títulos</span>}
                    </th>
                    {Array.from({ length: anchoPreview }, (_, c) => (
                      <td key={c}>{String((fila as unknown[])[c] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mapper-hint">
            Haz clic en la fila que contiene los títulos ({columnLetter(0)}, {columnLetter(1)}, … son las
            columnas de tu Excel). Todo lo que esté encima de esa fila se ignora.
          </p>
        </section>

        {sinTitulos && (
          <div className="mapper-alert warn">
            <AlertTriangle size={15} /> Esa fila no tiene títulos. Elige otra fila, u otra hoja.
          </div>
        )}
        {!sinTitulos && sinFilas && (
          <div className="mapper-alert warn">
            <AlertTriangle size={15} /> Debajo de esa fila no hay datos. Elige otra fila, u otra hoja.
          </div>
        )}

        <div className="mapper-footer">
          <button type="button" className="btn btn-secondary mapper-btn" onClick={onCancel}>
            <ArrowLeft size={16} /> Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-primary-blue mapper-btn"
            onClick={() => setPaso(2)}
            disabled={!puedeAvanzarDelPaso1}
          >
            Siguiente <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  /* --------------------------- Paso 2: relacionar --------------------------- */
  if (paso === 2) {
    return (
      <div className="mapper">
        <div className="mapper-hero compact">
          <span className="mapper-hero-grid" aria-hidden />
          <div className="mapper-hero-icon"><ArrowLeftRight size={20} /></div>
          <div className="mapper-hero-text">
            <span className="mapper-kicker">Paso 2 de 4 · Relacionar columnas</span>
            <h4>Relaciona tus columnas con las de RepuesTop</h4>
            <p>
              Por cada dato que pide RepuesTop, elige la columna de tu archivo que lo contiene.
              Lo que quede sin usar decides si va a la descripción del producto o se deja fuera.
            </p>
          </div>
        </div>

        {renderPasos(2)}
        {chipArchivo}

        {reused && (
          <div className="mapper-alert info">
            Aplicamos la relación que guardaste antes para un Excel con estas mismas columnas.
            Revísala y ajústala si hace falta.
          </div>
        )}
        {parseError && <div className="mapper-alert error"><AlertTriangle size={15} /> {parseError}</div>}
        {bigFile && (
          <div className="mapper-alert info">
            Archivo grande ({plural(userRows.length, 'fila', 'filas')}): generar el Excel puede
            tardar unos segundos.
          </div>
        )}

        <div className="mapper-counts">
          <span><b>{counts.asignadas}</b>/{campos.length} datos relacionados</span>
          <span><b>{counts.sinAsignar}</b> columnas tuyas sin usar</span>
          <span><b>{counts.aDescripcion}</b> van a la descripción</span>
          <span><b>{counts.ignoradas}</b> quedan fuera</span>
        </div>

        {missingRequired.length > 0 && (
          <div className="mapper-alert warn">
            <AlertTriangle size={15} />
            <span>
              Todavía falta indicar: <b>{missingRequired.map((c) => c.label).join(', ')}</b>. Son
              datos que RepuesTop necesita para publicar. Elige la columna de tu archivo, o escribe
              al lado el mismo valor para todas las filas.
            </span>
          </div>
        )}

        {columnaAniosConRangos && (
          <label className="mapper-switch">
            <input
              type="checkbox"
              checked={mapping.dividirAnios ?? false}
              onChange={(e) => setDividirAnios(e.target.checked)}
            />
            <span>
              <b>Tu columna de años trae rangos en una sola celda.</b> Los separamos en "año desde"
              y "año hasta" por ti{ejemploRangoAnios ? `: ${ejemploRangoAnios}` : ''}.
            </span>
          </label>
        )}

        {/* Datos que pide RepuesTop */}
        <section className="mapper-section">
          <span className="bulk-purpose-label">Datos que pide RepuesTop</span>
          <div className="mapper-rows">
            {campos.map((campo) => {
              const value = mapping.oficial[campo.key] ?? '';
              const uses = value ? usageCount.get(value) ?? 0 : 0;
              const faltante = campo.required && !value;
              return (
                <div className={`mapper-row ${faltante ? 'falta' : ''}`} key={campo.key}>
                  <div className="mapper-row-label">
                    <span>
                      {campo.label}
                      {campo.required && <b className="req">*</b>}
                    </span>
                    {campo.enumHint && (
                      <span className="mapper-enum-chip">{campo.enumHint.join(' / ')}</span>
                    )}
                    {uses > 1 && <span className="mapper-enum-chip alt">usada {uses} veces</span>}
                  </div>
                  <div className="mapper-row-control">
                    <select
                      className="form-control"
                      value={value}
                      aria-label={campo.label}
                      onChange={(e) => setOficial(campo.key, e.target.value)}
                    >
                      <option value="">— no tengo esta columna —</option>
                      {userCols.map((c) => (
                        <option key={c.id} value={c.id}>{c.displayHeader}</option>
                      ))}
                    </select>
                    {!value && (campo.enumHint ? (
                      <select
                        className="form-control mapper-default-input"
                        value={mapping.defaults?.[campo.key] ?? ''}
                        aria-label={`Valor fijo para ${campo.label}`}
                        onChange={(e) => setDefault(campo.key, e.target.value)}
                      >
                        <option value="">o el mismo valor para todas las filas…</option>
                        {campo.enumHint.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="form-control mapper-default-input"
                        type="text"
                        value={mapping.defaults?.[campo.key] ?? ''}
                        placeholder="o el mismo valor para todas las filas"
                        aria-label={`Valor fijo para ${campo.label}`}
                        onChange={(e) => setDefault(campo.key, e.target.value)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Columnas que te sobran */}
        <section className="mapper-section">
          <span className="bulk-purpose-label">
            Columnas de tu Excel sin asignar ({unassignedCols.length})
          </span>
          {unassignedCols.length === 0 ? (
            <p className="mapper-empty">Todas las columnas de tu archivo están relacionadas con un dato de RepuesTop.</p>
          ) : (
            <div className="mapper-rows">
              {unassignedCols.map((c) => (
                <div className="mapper-row" key={c.id}>
                  <div className="mapper-row-label">
                    <span>{c.displayHeader}</span>
                    {sampleValue(c) && <span className="mapper-sample">ej: {sampleValue(c)}</span>}
                  </div>
                  <select
                    className="form-control"
                    value={mapping.extras[c.id] ?? 'descripcion'}
                    aria-label={`Qué hacer con ${c.displayHeader}`}
                    onChange={(e) => setExtra(c.id, e.target.value as 'descripcion' | 'ignore')}
                  >
                    <option value="descripcion">Añadir a la descripción</option>
                    <option value="ignore">Dejar fuera</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mapper-footer">
          <button type="button" className="btn btn-secondary mapper-btn" onClick={() => setPaso(1)}>
            <ArrowLeft size={16} /> Atrás
          </button>
          <button
            type="button"
            className="btn btn-primary btn-primary-blue mapper-btn"
            onClick={() => setPaso(3)}
            disabled={missingRequired.length > 0}
            title={missingRequired.length > 0 ? 'Falta indicar datos obligatorios' : undefined}
          >
            Siguiente <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------- Paso 3: revisar ---------------------------- */
  const filasListas = userRows.length;

  return (
    <div className="mapper">
      <div className="mapper-hero compact">
        <span className="mapper-hero-grid" aria-hidden />
        <div className="mapper-hero-icon"><ListChecks size={20} /></div>
        <div className="mapper-hero-text">
          <span className="mapper-kicker">Paso 3 de 4 · Revisar</span>
          <h4>Revisa antes de generar</h4>
          <p>
            Esto es lo que vamos a preparar con tu archivo. Todavía no se publica nada.
          </p>
        </div>
      </div>

      {renderPasos(generating ? 4 : 3)}
      {chipArchivo}
      {parseError && <div className="mapper-alert error"><AlertTriangle size={15} /> {parseError}</div>}

      <div className="mapper-counts">
        <span><b>{filasListas.toLocaleString('es-CL')}</b> repuestos en tu archivo</span>
        <span className="ok"><b>{(revision?.publicables ?? 0).toLocaleString('es-CL')}</b> se pueden publicar</span>
        {(revision?.conError ?? 0) > 0 && (
          <span className="mal"><b>{revision?.conError.toLocaleString('es-CL')}</b> con problemas</span>
        )}
        {(revision?.conAviso ?? 0) > 0 && (
          <span className="ojo"><b>{revision?.conAviso.toLocaleString('es-CL')}</b> para mirar</span>
        )}
      </div>

      {revision && revision.conError > 0 && (
        <div className="mapper-alert warn">
          <AlertTriangle size={15} />
          <span>
            Las filas con problemas no se van a publicar. Puedes generar igual y publicar el resto,
            o volver atrás, corregirlas en tu Excel y subirlo de nuevo.
          </span>
        </div>
      )}

      {arreglos.length > 0 && (
        <section className="mapper-section">
          <span className="bulk-purpose-label">
            Arreglos que hicimos por ti ({cambios.length.toLocaleString('es-CL')} en total)
          </span>
          <p className="mapper-hint">
            Dejamos tus datos como los espera RepuesTop. Tu archivo original no se toca.
          </p>
          <ul className="mapper-arreglos">
            {arreglos.map((a) => (
              <li key={`${a.columna}|${a.antes}|${a.despues}`}>
                <span className="mapper-arreglo-col">
                  {campos.find((c) => c.key === a.columna)?.label ?? a.columna}
                </span>
                <span className="mapper-arreglo-antes">{a.antes}</span>
                <ArrowRight size={14} aria-label="queda como" />
                <span className="mapper-arreglo-despues">{a.despues}</span>
                <span className="mapper-arreglo-filas">{plural(a.filas, 'fila', 'filas')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ficha && (
        <section className="mapper-section">
          <span className="bulk-purpose-label">Así se verá tu primer repuesto en RepuesTop</span>
          <article className="mapper-ficha">
            <div className="mapper-ficha-foto">
              <ImageIcon size={26} />
              <span>La foto se agrega después</span>
            </div>
            <div className="mapper-ficha-body">
              <h5>{ficha.nombre}</h5>
              <div className="mapper-ficha-chips">
                {ficha.marca && <span className="mapper-ficha-chip">{ficha.marca}</span>}
                {ficha.categoria && <span className="mapper-ficha-chip alt">{ficha.categoria}</span>}
                {ficha.subcategoria && <span className="mapper-ficha-chip alt">{ficha.subcategoria}</span>}
                <span className="mapper-ficha-chip cond">{ficha.condicion}</span>
              </div>
              <div className="mapper-ficha-precio">{ficha.precio}</div>
              <p className="mapper-ficha-compat">{ficha.compatibilidad}</p>
              <p className="mapper-ficha-meta">
                Código {ficha.sku || '—'}{ficha.stock ? ` · ${ficha.stock} en stock` : ''}
              </p>
              {ficha.descripcion && <p className="mapper-ficha-desc">{ficha.descripcion}</p>}
            </div>
          </article>
        </section>
      )}

      {revision && revision.filas.length > 0 && (
        <section className="mapper-section">
          <span className="bulk-purpose-label">
            Tus primeros {revision.filas.length} repuestos, ya con el formato de RepuesTop
          </span>
          <div className="mapper-preview-wrap">
            <table className="mapper-preview revisada">
              <thead>
                <tr>
                  <th>Fila</th>
                  {columnasVisibles.map((c) => (
                    <th key={c}>{campos.find((campo) => campo.key === c)?.label ?? c}</th>
                  ))}
                  <th className="motivo">Qué revisar</th>
                </tr>
              </thead>
              <tbody>
                {revision.filas.map((fila: FilaRevisada) => {
                  const porColumna = new Map(fila.problemas.map((p) => [p.columna, p]));
                  return (
                    <tr key={fila.numeroFila} className={fila.tieneError ? 'con-error' : fila.problemas.length ? 'con-aviso' : ''}>
                      <th scope="row">{fila.numeroFila}</th>
                      {columnasVisibles.map((c) => {
                        const problema = porColumna.get(c);
                        return (
                          <td key={c} className={problema ? `celda-${problema.severidad}` : ''} title={problema?.mensaje}>
                            {fila.valores[revision.columnas.indexOf(c)]}
                          </td>
                        );
                      })}
                      <td className="motivo">
                        {fila.problemas.map((p, i) => (
                          <span key={i} className={`mapper-motivo ${p.severidad}`}>{p.mensaje}</span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mapper-hint">
            {revision.total > revision.filas.length
              ? `Mostramos las primeras ${revision.filas.length} filas; los contadores de arriba miran las ${revision.total.toLocaleString('es-CL')}. `
              : ''}
            {columnasVisibles.length < revision.columnas.length
              ? 'No mostramos las columnas que quedaron vacías en todas estas filas.'
              : ''}
          </p>
        </section>
      )}

      <section className="mapper-section">
        <span className="bulk-purpose-label">Así estamos leyendo tu archivo</span>
        <ul className="mapper-resumen">
          <li><b>Archivo:</b> {userFile.name}</li>
          {hojas.length > 1 && <li><b>Hoja:</b> {hoja?.nombre}</li>}
          <li><b>Títulos:</b> fila {filaEncabezados + 1} de tu Excel</li>
          <li><b>Repuestos a preparar:</b> {filasListas.toLocaleString('es-CL')}</li>
        </ul>
      </section>

      {/* Traducir valores */}
      {enumColumns.length > 0 && (
        <section className="mapper-section">
          <span className="bulk-purpose-label">Traducir tus palabras a las de RepuesTop</span>
          <p className="mapper-hint">
            Estos datos se envían tal como los tienes, salvo que aquí elijas a qué valor de
            RepuesTop corresponde cada uno.
          </p>
          {enumColumns.map(({ campo, userColId }: { campo: CampoMeta; userColId: string }) => {
            const col = colById.get(userColId);
            if (!col) return null;
            // Los valores que la limpieza ya resuelve no se preguntan: una X que va a
            // quedar en SI no es una decisión pendiente, y pedirla haría pensar que falta algo.
            const distinct = distinctValuesForColumn(userRows, col.index, VALUE_MAP_CAP)
              .filter((val) => {
                const yaMapeado = mapping.valueMap[campo.key]?.[val];
                const limpio = (yaMapeado ?? normalizarCelda(campo.key, val).valor).toUpperCase();
                return !campo.enumHint?.some((opt) => opt.toUpperCase() === limpio);
              });
            if (distinct.length === 0) return null;
            const overflow = distinct.length > VALUE_MAP_CAP;
            return (
              <div className="mapper-values-block" key={campo.key}>
                <div className="mapper-values-title">
                  {campo.label} <span>← {col.displayHeader}</span>
                </div>
                {overflow ? (
                  <p className="mapper-hint">
                    Tu columna tiene demasiados valores distintos; se enviarán tal cual y el análisis
                    marcará los que no sean válidos.
                  </p>
                ) : (
                  <div className="mapper-rows">
                    {distinct.map((val) => (
                      <div className="mapper-row" key={val}>
                        <div className="mapper-row-label"><span>{val}</span></div>
                        <select
                          className="form-control"
                          value={mapping.valueMap[campo.key]?.[val] ?? ''}
                          aria-label={`${campo.label}: ${val}`}
                          onChange={(e) => setValue(campo.key, val, e.target.value)}
                        >
                          <option value="">dejar como está</option>
                          {campo.enumHint?.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <div className="mapper-footer">
        <button
          type="button"
          className="btn btn-secondary mapper-btn"
          onClick={() => setPaso(2)}
          disabled={generating}
        >
          <ArrowLeft size={16} /> Atrás
        </button>
        <button
          type="button"
          className="btn btn-secondary mapper-btn"
          onClick={handleDownloadGenerated}
          disabled={generating}
        >
          <Download size={16} /> Descargar Excel generado
        </button>
        <button
          type="button"
          className="btn btn-primary btn-primary-blue mapper-btn"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'Generando…' : 'Generar y continuar'}
        </button>
      </div>
    </div>
  );
};

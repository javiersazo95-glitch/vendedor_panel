import React, { useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, Wand2, AlertTriangle, ArrowLeft, Download, X,
  UploadCloud, ArrowLeftRight, ListChecks, Rocket, ShieldCheck,
} from 'lucide-react';
import {
  ESQUEMA_FALLBACK,
  camposDesdeEsquema,
  autoDetectMapping,
  reconcileMapping,
  buildOfficialAoA,
  buildOfficialXlsxFile,
  parseUserFile,
  headerSignature,
  loadSavedMapping,
  saveMapping,
  distinctValuesForColumn,
  mappedEnumColumns,
  getIsoTimestampString,
  type Mapping,
  type UserColumn,
  type EsquemaPlantilla,
} from '../utils/plantillaMapping';

interface PlantillaMapperProps {
  onGenerated: (file: File) => void;
  onCancel: () => void;
  /** Esquema vigente de la plantilla. Por defecto, el contrato de respaldo del panel. */
  esquema?: EsquemaPlantilla;
}

const BIG_FILE_ROWS = 5000;
const VALUE_MAP_CAP = 20;

export const PlantillaMapper: React.FC<PlantillaMapperProps> = ({
  onGenerated,
  onCancel,
  esquema = ESQUEMA_FALLBACK,
}) => {
  const [userFile, setUserFile] = useState<File | null>(null);
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

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setParsing(true);
    setParseError(null);
    try {
      const { cols, rows } = await parseUserFile(file);
      const sig = headerSignature(cols);
      const saved = loadSavedMapping(sig);
      setMapping(saved ? reconcileMapping(saved, cols, campos) : autoDetectMapping(cols, campos));
      setReused(!!saved);
      setUserCols(cols);
      setUserRows(rows);
      setUserFile(file);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'No se pudo leer el archivo.');
      setUserFile(null);
      setUserCols([]);
      setUserRows([]);
      setMapping(null);
    } finally {
      setParsing(false);
    }
  };

  const resetFile = () => {
    setUserFile(null);
    setUserCols([]);
    setUserRows([]);
    setMapping(null);
    setParseError(null);
    setReused(false);
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

  const missingRequired = useMemo(
    () => (mapping ? campos.filter((c) => c.required && !mapping.oficial[c.key]) : []),
    [mapping, campos],
  );

  const enumColumns = useMemo(
    () => (mapping ? mappedEnumColumns(mapping, campos) : []),
    [mapping, campos],
  );

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

  /* --------------------------- Paso 1: subir archivo --------------------------- */
  if (!userFile || !mapping) {
    const pasos = [
      { icon: <UploadCloud size={16} />, t: 'Sube tu Excel', d: 'Tu archivo .xlsx, .xls o .csv con los encabezados que ya usas.' },
      { icon: <ArrowLeftRight size={16} />, t: 'Empareja tus columnas', d: 'Indica qué columna tuya corresponde a cada campo oficial. Te proponemos coincidencias automáticas.' },
      { icon: <ListChecks size={16} />, t: 'Ajusta lo que sobra', d: 'Lo que no calce lo mandas a la descripción o lo ignoras. También traduces valores como “Nuevo → ORIGINAL”.' },
      { icon: <Rocket size={16} />, t: 'Genera y continúa', d: 'Creamos el Excel oficial y sigues con el análisis y la carga normal.' },
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

        <ol className="mapper-steps">
          {pasos.map((p, i) => (
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
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            <ArrowLeft size={14} /> Volver
          </button>
        </div>
      </div>
    );
  }

  /* --------------------------- Paso 2 y 3: mapear ---------------------------- */
  const bigFile = userRows.length > BIG_FILE_ROWS;

  return (
    <div className="mapper">
      <div className="mapper-hero compact">
        <span className="mapper-hero-grid" aria-hidden />
        <div className="mapper-hero-icon"><ArrowLeftRight size={20} /></div>
        <div className="mapper-hero-text">
          <span className="mapper-kicker">Paso 2 · Relacionar columnas</span>
          <h4>Relaciona tus columnas con las de RepuesTop</h4>
          <p>
            Por cada columna oficial elige la columna equivalente de tu archivo. Lo que quede sin
            asignar decides si va a la descripción del producto o se ignora.
          </p>
        </div>
      </div>

      <div className="mapper-file-chip">
        <FileSpreadsheet size={15} />
        <strong>{userFile.name}</strong>
        <span>{`${userRows.length.toLocaleString('es-CL')} ${userRows.length === 1 ? 'fila' : 'filas'} · ${userCols.length} ${userCols.length === 1 ? 'columna' : 'columnas'}`}</span>
        <button type="button" onClick={resetFile} title="Cambiar archivo"><X size={13} /></button>
      </div>

      {reused && (
        <div className="mapper-alert info">
          Aplicamos un mapeo que guardaste antes para un Excel con estas mismas columnas. Revísalo y
          ajústalo si hace falta.
        </div>
      )}
      {parseError && <div className="mapper-alert error"><AlertTriangle size={15} /> {parseError}</div>}
      {bigFile && (
        <div className="mapper-alert info">
          Archivo grande ({userRows.length.toLocaleString('es-CL')} filas): generar el Excel puede
          tardar unos segundos.
        </div>
      )}

      <div className="mapper-counts">
        <span><b>{counts.asignadas}</b>/{campos.length} asignadas</span>
        <span><b>{counts.sinAsignar}</b> sin asignar</span>
        <span><b>{counts.aDescripcion}</b> a la descripción</span>
        <span><b>{counts.ignoradas}</b> ignoradas</span>
      </div>

      {missingRequired.length > 0 && (
        <div className="mapper-alert warn">
          <AlertTriangle size={15} />
          Falta asignar columnas obligatorias: {missingRequired.map((c) => c.label).join(', ')}. Puedes
          continuar igual; el análisis marcará las filas afectadas.
        </div>
      )}

      {/* Sección A */}
      <section className="mapper-section">
        <span className="bulk-purpose-label">Columnas oficiales de RepuesTop</span>
        <div className="mapper-rows">
          {campos.map((campo) => {
            const value = mapping.oficial[campo.key] ?? '';
            const uses = value ? usageCount.get(value) ?? 0 : 0;
            return (
              <div className="mapper-row" key={campo.key}>
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
                <select
                  className="form-control"
                  value={value}
                  onChange={(e) => setOficial(campo.key, e.target.value)}
                >
                  <option value="">— sin dato —</option>
                  {userCols.map((c) => (
                    <option key={c.id} value={c.id}>{c.displayHeader}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      {/* Sección B */}
      <section className="mapper-section">
        <span className="bulk-purpose-label">
          Columnas de tu Excel sin asignar ({unassignedCols.length})
        </span>
        {unassignedCols.length === 0 ? (
          <p className="mapper-empty">Todas las columnas de tu archivo están asignadas a una columna oficial.</p>
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
                  onChange={(e) => setExtra(c.id, e.target.value as 'descripcion' | 'ignore')}
                >
                  <option value="descripcion">Añadir a la descripción</option>
                  <option value="ignore">Ignorar</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sección C */}
      {enumColumns.length > 0 && (
        <section className="mapper-section">
          <span className="bulk-purpose-label">Traducir valores</span>
          <p className="mapper-hint">
            Tus valores para estas columnas se enviarán como los tengas, salvo que aquí los traduzcas
            al valor oficial.
          </p>
          {enumColumns.map(({ campo, userColId }) => {
            const col = colById.get(userColId);
            if (!col) return null;
            const distinct = distinctValuesForColumn(userRows, col.index, VALUE_MAP_CAP);
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
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={generating}>
          <ArrowLeft size={14} /> Cancelar
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleDownloadGenerated}
          disabled={generating}
        >
          <Download size={14} /> Descargar Excel generado
        </button>
        <button
          type="button"
          className="btn btn-primary btn-primary-blue"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'Generando…' : 'Generar y continuar'}
        </button>
      </div>
    </div>
  );
};

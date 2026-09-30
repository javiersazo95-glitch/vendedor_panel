/**
 * "Mi propio Excel": el asistente de cuatro etapas para cargar el inventario desde el Excel que el
 * vendedor ya usa.
 *
 *   1. Sube tu archivo   — el Excel y, si las tiene, la carpeta con las fotos.
 *   2. Relaciona         — qué columna de su Excel trae cada dato de RepuesTop.
 *   3. Completa          — la tabla con todos sus repuestos; lo amarillo falta por completar.
 *   4. Revisa y publica  — cómo quedará cada publicación (lista o cuadrícula) y el botón de publicar.
 *
 * El progreso se guarda solo en la cuenta del vendedor (y con "Guardar progreso"), así que puede
 * salir y retomar otro día. Salir con cambios sin guardar pregunta antes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, CloudOff, Download, FileArchive, FolderOpen, History,
  Loader2, RotateCcw, Save, Trash2, Wand2, XCircle,
} from 'lucide-react';
import './miExcel.css';
import {
  autoDetectMapping,
  buildOfficialXlsxFile,
  camposDesdeEsquema,
  columnasDeHoja,
  detectarFilaEncabezados,
  elegirHojaInicial,
  etiquetaValor,
  getIsoTimestampString,
  headerSignature,
  leerLibro,
  reconcileMapping,
  type HojaUsuario,
  type Mapping,
  type UserColumn,
} from '../../utils/plantillaMapping';
import { useEsquemaPlantilla } from '../../utils/plantillaEsquema';
import { mapeoParaFirma, useMapeosGuardados } from '../../utils/plantillaMapeos';
import { excedeTamanoMaximoDatos, mensajeArchivoDemasiadoGrande, MENSAJE_EXCEL_INVALIDO, pareceExcelValido } from '../../utils/fileValidation';
import {
  autoDerivado, conArreglosPropuestos, detectar, marcasDelArchivo,
} from '../../utils/miExcelDetecciones';
import {
  aplicarATodasVacias, aplicarParche, camposACompletar, type RevisionServidorFilas, columnasVigiladas, columnasVisibles, construirTabla, transformar,
} from '../../utils/miExcelTabla';
import { useModelosVehiculo } from '../../utils/useModelosVehiculo';
import { useVersionesCatalogo } from '../../utils/useVersionesCatalogo';
import { rangoCompleto } from '../../utils/catalogoVersiones';
import {
  asignarPorCodigo, extractFolderImages, extractZipImages, subirFotosAProductos, MAX_IMAGES_PER_PRODUCT,
  type FotoUploadResultado,
} from '../../utils/fotosCarga';
import { descargarFotos, esUrlDeImagen, fotosPorSku } from '../../utils/plantillaFotos';
import { cargarExcel, validarExcel, type FilaResultado } from '../../utils/cargaExcelApi';
import { construirExcelSoloValidos } from '../../utils/excelSoloValidos';
import {
  deserializarBorrador, descargarArchivoBorrador, descargarImagenBorrador, eliminarBorrador, fechaYHora, fotosAsignadas,
  huellaArchivo, obtenerBorrador, type BorradorCarga, type EstadoBorrador, type PasoMiExcel,
} from '../../utils/miExcelBorrador';
import { useBorradorCarga } from '../../utils/useBorradorCarga';
import { useGuardiaDeSalida, type RegistrarGuardia } from '../../utils/guardiaSalida';
import { publicarContextoSoporte } from '../../utils/contextoSoporte';
import { getStoredSession } from '../../utils/session';
import { sanitizeAoaForExport } from '../../utils/xlsxSafety';
import { DialogoGuardarCambios } from '../DialogoGuardarCambios';
import { Modal } from './comunes';
import { PASOS_MI_EXCEL, plural } from './textos';
import { PasoSubir } from './PasoSubir';
import { PasoRelacionar } from './PasoRelacionar';
import { PasoCompletar, type CambioMasivo } from './PasoCompletar';
import { PasoVistaPrevia, type RevisionServidor } from './PasoVistaPrevia';

interface Props {
  onVolver: () => void;
  onClose: () => void;
  onUploadSuccess: () => void;
  onBusyChange?: (ocupado: boolean) => void;
  onRegistrarGuardia?: RegistrarGuardia;
  onAnchoCompletoChange?: (activo: boolean) => void;
  /** Se entró por "Retomar desde el punto guardado": se retoma sin preguntar. */
  retomarDirecto?: boolean;
}

type Fase = 'buscando' | 'retomar' | 'cargando' | 'trabajo' | 'publicando' | 'publicado';

interface ResultadoPublicacion {
  publicados: number;
  noPublicados: { fila: number; sku: string; nombre: string; motivos: string[] }[];
  fotos: FotoUploadResultado[];
  archivoRepetidoEl: string | null;
}

const REVISION_VACIA: RevisionServidor = { estado: 'sin-revisar', porClave: {}, error: null, avisosGenerales: [] };

/** "hace 2 min", para el indicador de guardado. */
function haceCuanto(iso: string | null, ahora: number): string {
  if (!iso) return '';
  const seg = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (seg < 45) return 'hace unos segundos';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const { fecha, hora } = fechaYHora(iso);
  return `el ${fecha} a las ${hora}`;
}

export function MiExcelWizard({
  onVolver, onClose, onUploadSuccess, onBusyChange, onRegistrarGuardia, onAnchoCompletoChange, retomarDirecto = false,
}: Props) {
  const { esquema } = useEsquemaPlantilla(true);
  const { mapeos, guardar: guardarMapeo } = useMapeosGuardados(true);
  const campos = useMemo(() => camposDesdeEsquema(esquema), [esquema]);

  const [fase, setFase] = useState<Fase>('buscando');
  const [borradorEncontrado, setBorradorEncontrado] = useState<{ borrador: BorradorCarga; estado: EstadoBorrador } | null>(null);
  const [errorRetomar, setErrorRetomar] = useState<string | null>(null);
  const [pedirMismoArchivo, setPedirMismoArchivo] = useState<{ borrador: BorradorCarga; estado: EstadoBorrador } | null>(null);
  const [confirmarDescarte, setConfirmarDescarte] = useState<'retomar' | 'boton' | null>(null);
  const [dialogoFotos, setDialogoFotos] = useState<{ guardadas: number; total: number } | null>(null);
  const [salirConfirmar, setSalirConfirmar] = useState(false);

  const [paso, setPaso] = useState<PasoMiExcel>(1);
  const [archivo, setArchivo] = useState<{ file: File; sha256: string } | null>(null);
  const [hojas, setHojas] = useState<HojaUsuario[]>([]);
  const [hojaIndex, setHojaIndex] = useState(0);
  const [filaEncabezados, setFilaEncabezados] = useState(0);
  const [userCols, setUserCols] = useState<UserColumn[]>([]);
  const [userRows, setUserRows] = useState<unknown[][]>([]);
  const [filasOriginales, setFilasOriginales] = useState<number[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [reutilizado, setReutilizado] = useState(false);
  const [opcionalesVacios, setOpcionalesVacios] = useState<string[]>([]);
  const [cambioMasivo, setCambioMasivo] = useState<CambioMasivo | null>(null);
  const [claveACorregir, setClaveACorregir] = useState<string | null>(null);

  const [imagenes, setImagenes] = useState<Record<string, Blob>>({});
  const [origenFotos, setOrigenFotos] = useState<'carpeta' | 'zip' | null>(null);
  const [nombreZip, setNombreZip] = useState<string | null>(null);
  const [totalFotos, setTotalFotos] = useState(0);
  const [leyendoFotos, setLeyendoFotos] = useState(false);
  const [errorFotos, setErrorFotos] = useState<string | null>(null);
  const [asignaciones, setAsignaciones] = useState<Record<string, string[]>>({});
  const [descargandoEnlaces, setDescargandoEnlaces] = useState<{ hechas: number; total: number } | null>(null);

  const [vista, setVista] = useState<'lista' | 'tarjetas'>('tarjetas');
  const [revision, setRevision] = useState<RevisionServidor>(REVISION_VACIA);
  const revisadoRef = useRef<{ firma: string; file: File; claves: string[]; filas: FilaResultado[] } | null>(null);
  /** El mapeo con que se hizo la última revisión: si cambió, la revisión quedó vieja. */
  const [firmaRevisada, setFirmaRevisada] = useState<string | null>(null);
  /** El resultado del servidor por fila y los valores que se revisaron, para marcar el dato exacto con problemas. */
  const [revisionFilas, setRevisionFilas] = useState<RevisionServidorFilas | null>(null);
  const [publicacionPendiente, setPublicacionPendiente] = useState<EstadoBorrador['publicacion']>(null);
  const [progreso, setProgreso] = useState<{ texto: string; hechas: number; total: number } | null>(null);
  const [errorPublicar, setErrorPublicar] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoPublicacion | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  const inputCarpeta = useRef<HTMLInputElement>(null);
  const inputZip = useRef<HTMLInputElement>(null);

  /* ------------------------------ Derivados ------------------------------ */

  const detecciones = useMemo(
    () => (mapping && paso >= 2 ? detectar(mapping, userCols, userRows, esquema) : null),
    [mapping, paso, userCols, userRows, esquema],
  );
  const auto = useCallback(
    (key: string) => (mapping && detecciones
      ? autoDerivado(key, mapping, userCols, userRows, detecciones)
      : { activo: false, descripcion: '' }),
    [mapping, detecciones, userCols, userRows],
  );
  const columnasACompletar = useMemo(
    () => (mapping ? camposACompletar(campos, mapping, (k) => { const a = auto(k); return a.activo && !a.parcial; }) : []),
    [campos, mapping, auto],
  );
  const marcas = useMemo(
    () => (mapping && paso >= 2 ? marcasDelArchivo(mapping, userCols, userRows, esquema) : []),
    [mapping, paso, userCols, userRows, esquema],
  );
  const { modelosDisponibles, catalogoCaido } = useModelosVehiculo(esquema, marcas, paso >= 2);
  const { versionesDe, pedirVersiones } = useVersionesCatalogo();

  const transformacion = useMemo(
    () => (mapping && paso >= 3
      ? transformar({ userRows, userCols, mapping, campos, esquema, modelosDisponibles, filasOriginales })
      : null),
    [mapping, paso, userRows, userCols, campos, esquema, modelosDisponibles, filasOriginales],
  );
  const tabla = useMemo(
    () => (transformacion && mapping
      ? construirTabla(transformacion, { campos, esquema, mapping, modelosDisponibles, columnasACompletar, opcionalesVacios })
      : null),
    [transformacion, mapping, campos, esquema, modelosDisponibles, columnasACompletar, opcionalesVacios],
  );
  const columnasTabla = useMemo(
    () => (tabla && mapping ? columnasVisibles(tabla, columnasVigiladas(campos, mapping, columnasACompletar)) : []),
    [tabla, mapping, campos, columnasACompletar],
  );

  /** Fotos que declara la columna de fotos del Excel, por SKU. */
  const declaradas = useMemo(() => {
    if (!mapping?.columnaFotos || !mapping.oficial.sku_proveedor) return {} as Record<string, string[]>;
    const colFotos = userCols.find((c) => c.id === mapping.columnaFotos);
    const colSku = userCols.find((c) => c.id === mapping.oficial.sku_proveedor);
    return colFotos && colSku ? fotosPorSku(userRows, colFotos.index, colSku.index) : {};
  }, [mapping, userCols, userRows]);
  const enlacesPendientes = useMemo(() => {
    if (!tabla) return {} as Record<string, string[]>;
    const pendientes: Record<string, string[]> = {};
    for (const f of tabla.filas) {
      if ((asignaciones[f.clave] ?? []).length > 0) continue;
      const urls = (declaradas[f.sku] ?? []).filter(esUrlDeImagen);
      if (urls.length) pendientes[f.sku] = urls;
    }
    return pendientes;
  }, [tabla, declaradas, asignaciones]);

  const hoja = hojas[hojaIndex];
  const estadoBorrador: EstadoBorrador = useMemo(() => ({
    v: 1,
    paso,
    archivo: archivo ? {
      nombre: archivo.file.name, sha256: archivo.sha256, hojaIndex, filaEncabezados, recortado: false, filas: userRows.length,
    } : null,
    mapping,
    opcionalesVacios,
    fotos: { asignaciones, origen: origenFotos, totalDisponibles: totalFotos },
    vistaPaso4: vista,
    publicacion: publicacionPendiente,
  }), [paso, archivo, hojaIndex, filaEncabezados, userRows.length, mapping, opcionalesVacios, asignaciones, origenFotos, totalFotos, vista, publicacionPendiente]);

  const borrador = useBorradorCarga({
    habilitado: (fase === 'trabajo' || fase === 'publicando') && !!archivo && !!mapping,
    estado: estadoBorrador,
    archivo: archivo && hoja ? { file: archivo.file, sha256: archivo.sha256, aoa: hoja.aoa, nombreHoja: hoja.nombre } : null,
    imagenes,
  });

  useGuardiaDeSalida(onRegistrarGuardia, {
    hayCambiosSinGuardar: borrador.hayCambiosSinGuardar,
    guardar: borrador.guardar,
  });

  /* ------------------------ Efectos hacia afuera ------------------------ */

  useEffect(() => {
    onAnchoCompletoChange?.(fase === 'trabajo' && paso === 3);
  }, [fase, paso, onAnchoCompletoChange]);
  useEffect(() => () => onAnchoCompletoChange?.(false), [onAnchoCompletoChange]);

  useEffect(() => { onBusyChange?.(fase === 'publicando'); }, [fase, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // El chat de soporte adjunta en qué etapa va el vendedor.
  useEffect(() => {
    publicarContextoSoporte({
      flujo: 'mi-excel',
      paso,
      pasoTitulo: PASOS_MI_EXCEL[paso - 1].titulo,
      archivoNombre: archivo?.file.name,
      filas: archivo ? userRows.length : undefined,
    });
  }, [paso, archivo, userRows.length]);
  useEffect(() => () => publicarContextoSoporte(null), []);

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  /* --------------------------- Leer el archivo --------------------------- */

  const aplicarSeleccion = useCallback((libro: HojaUsuario[], indice: number, fila: number, mappingPrevio?: Mapping | null) => {
    const h = libro[indice];
    const { cols, rows, filasOriginales: originales } = columnasDeHoja(h?.aoa ?? [], fila);
    const firma = cols.length ? headerSignature(cols) : '';
    const guardado = mappingPrevio ?? (firma ? mapeoParaFirma(mapeos, firma) : null);
    const reconciliado = guardado ? reconcileMapping(guardado, cols, campos) : autoDetectMapping(cols, campos);
    // Al retomar es el mismo archivo: las correcciones celda a celda y los autos agregados o
    // quitados siguen valiendo. `reconcileMapping` los descarta a propósito porque un mapeo
    // guardado se reutiliza con otros archivos, donde esas filas ya no son las mismas.
    const base: Mapping = mappingPrevio
      ? {
        ...reconciliado,
        parches: mappingPrevio.parches,
        compatibilidadesExtra: mappingPrevio.compatibilidadesExtra,
        compatibilidadesQuitadas: mappingPrevio.compatibilidadesQuitadas,
      }
      : reconciliado;
    setUserCols(cols);
    setUserRows(rows);
    setFilasOriginales(originales);
    setMapping(mappingPrevio ? base : conArreglosPropuestos(base, cols, rows, esquema));
    setReutilizado(!!guardado && !mappingPrevio);
    setHojaIndex(indice);
    setFilaEncabezados(fila);
  }, [mapeos, campos, esquema]);

  const leerArchivo = async (file: File): Promise<HojaUsuario[] | null> => {
    if (excedeTamanoMaximoDatos(file)) { setErrorArchivo(mensajeArchivoDemasiadoGrande(file)); return null; }
    if (!(await pareceExcelValido(file))) { setErrorArchivo(MENSAJE_EXCEL_INVALIDO); return null; }
    return leerLibro(file);
  };

  const handleArchivo = async (file: File) => {
    setLeyendo(true);
    setErrorArchivo(null);
    try {
      const libro = await leerArchivo(file);
      if (!libro) return;
      const indice = elegirHojaInicial(libro);
      setHojas(libro);
      aplicarSeleccion(libro, indice, detectarFilaEncabezados(libro[indice].aoa));
      setArchivo({ file, sha256: await huellaArchivo(file) });
      setAsignaciones({});
      setOpcionalesVacios([]);
      setRevision(REVISION_VACIA);
      setRevisionFilas(null);
    } catch (err) {
      setErrorArchivo(err instanceof Error ? err.message : 'No se pudo leer el archivo.');
    } finally {
      setLeyendo(false);
    }
  };

  const quitarArchivo = () => {
    setArchivo(null);
    setHojas([]);
    setUserCols([]);
    setUserRows([]);
    setMapping(null);
    setAsignaciones({});
    setErrorArchivo(null);
  };

  /* -------------------------------- Fotos -------------------------------- */

  const autoAsignar = useCallback((imgs: Record<string, Blob>, soloSinFotos = true): number => {
    if (!tabla) return 0;
    const filas = tabla.filas
      .filter((f) => !soloSinFotos || (asignaciones[f.clave] ?? []).length === 0)
      .map((f) => ({ clave: f.clave, sku: f.sku }));
    const nuevas = asignarPorCodigo(filas, Object.keys(imgs), declaradas);
    const n = Object.keys(nuevas).length;
    if (n > 0) setAsignaciones((prev) => ({ ...prev, ...nuevas }));
    return n;
  }, [tabla, asignaciones, declaradas]);

  // Con la tabla lista y fotos nuevas en memoria, se asignan solas por código (sólo a los que no tienen).
  const autoHechoRef = useRef<Record<string, Blob> | null>(null);
  useEffect(() => {
    if (!tabla || Object.keys(imagenes).length === 0 || autoHechoRef.current === imagenes) return;
    autoHechoRef.current = imagenes;
    autoAsignar(imagenes);
  }, [tabla, imagenes, autoAsignar]);

  const recibirCarpeta = (files: FileList) => {
    setErrorFotos(null);
    const mapa = extractFolderImages(files);
    if (Object.keys(mapa).length === 0) {
      setErrorFotos('En esa carpeta no encontramos fotos (jpg, png, webp o gif).');
      return;
    }
    setImagenes(mapa);
    setOrigenFotos('carpeta');
    setNombreZip(null);
    setTotalFotos(Object.keys(mapa).length);
    setDialogoFotos(null);
  };

  const recibirZip = async (file: File) => {
    setErrorFotos(null);
    setLeyendoFotos(true);
    try {
      const mapa = await extractZipImages(file);
      if (Object.keys(mapa).length === 0) { setErrorFotos('En ese ZIP no encontramos fotos (jpg, png, webp o gif).'); return; }
      setImagenes(mapa);
      setOrigenFotos('zip');
      setNombreZip(file.name);
      setTotalFotos(Object.keys(mapa).length);
      setDialogoFotos(null);
    } catch {
      setErrorFotos('No se pudo leer el archivo ZIP. Revisa que no esté dañado.');
    } finally {
      setLeyendoFotos(false);
    }
  };

  const traerEnlaces = async () => {
    const total = Object.values(enlacesPendientes).reduce((n, u) => n + u.length, 0);
    if (!tabla || total === 0) return;
    setDescargandoEnlaces({ hechas: 0, total });
    try {
      const { archivos, asignaciones: porSku } = await descargarFotos(enlacesPendientes, (hechas) => setDescargandoEnlaces({ hechas, total }));
      setImagenes((prev) => ({ ...prev, ...archivos }));
      autoHechoRef.current = null;
      setAsignaciones((prev) => {
        const sig = { ...prev };
        for (const f of tabla.filas) {
          const nombres = porSku[f.sku];
          if (nombres?.length && !(sig[f.clave] ?? []).length) sig[f.clave] = nombres.slice(0, MAX_IMAGES_PER_PRODUCT);
        }
        return sig;
      });
    } finally {
      setDescargandoEnlaces(null);
    }
  };

  /* --------------------------- Cambios al mapeo --------------------------- */

  const actualizar = (fn: (m: Mapping) => Mapping) => setMapping((prev) => (prev ? fn(prev) : prev));

  const setOficial = (key: string, valueId: string) => actualizar((prev) => {
    const oficial = { ...prev.oficial, [key]: valueId || null };
    const extras = { ...prev.extras };
    if (valueId) delete extras[valueId];
    const referenciadas = new Set(Object.values(oficial).filter(Boolean) as string[]);
    // La columna que se liberó vuelve a "sin asignar", a la descripción hasta que el vendedor decida.
    userCols.forEach((c) => { if (!referenciadas.has(c.id) && !(c.id in extras)) extras[c.id] = 'descripcion'; });
    return { ...prev, oficial, extras };
  });

  const etiquetaCampo = (key: string) => campos.find((c) => c.key === key)?.label ?? key;

  const aplicarATodas = (columna: string, valor: string) => {
    const anterior = mapping?.defaults?.[columna];
    const vacias = tabla?.faltantesPorColumna[columna] ?? 0;
    actualizar((m) => aplicarATodasVacias(m, columna, valor));
    setOpcionalesVacios((prev) => prev.filter((c) => c !== columna));
    setCambioMasivo({
      columna,
      descripcion: `Pusimos "${etiquetaValor(valor)}" en ${plural(vacias, 'fila vacía', 'filas vacías')} de ${etiquetaCampo(columna)}.`,
      deshacer: () => actualizar((m) => aplicarATodasVacias(m, columna, anterior ?? '')),
    });
  };

  /** Varios datos de una fila de una vez ("todos los años del modelo" pone el desde y el hasta). */
  const aplicarParches = (clave: string, valores: Record<string, string>) => actualizar((m) => (
    Object.entries(valores).reduce((acc, [col, v]) => aplicarParche(acc, clave, col, v), m)
  ));

  /**
   * "Todos los años del modelo" en todas las filas sin año: a cada repuesto, el rango completo de su
   * propio modelo en el catálogo. El backend exige un año para registrar el vehículo, así que "no
   * sé los años" se publica como "sirve para todos los años de ese modelo".
   */
  const completarVehiculo = (columna: 'anio_desde' | 'anio_hasta') => {
    if (!tabla) return;
    const i = (c: string) => tabla.columnas.indexOf(c);
    const leer = (f: { valores: string[] }, c: string) => String(f.valores[i(c)] ?? '').trim();
    const cambios: { clave: string; valores: Record<string, string> }[] = [];
    let sinCatalogo = 0;
    for (const f of tabla.filas) {
      if (leer(f, columna) || ['SI', 'SÍ', 'TRUE', '1', 'X'].includes(leer(f, 'compatibilidad_general').toUpperCase())) continue;
      const rango = rangoCompleto(versionesDe(leer(f, 'compatibilidad_marca'), leer(f, 'compatibilidad_modelo')) ?? []);
      if (!rango) { sinCatalogo += 1; continue; }
      const valores: Record<string, string> = columna === 'anio_desde'
        ? { anio_desde: rango.desde, ...(leer(f, 'anio_hasta') ? {} : { anio_hasta: rango.hasta }) }
        : { anio_hasta: rango.hasta };
      cambios.push({ clave: f.clave, valores });
    }
    if (cambios.length > 0) {
      actualizar((m) => cambios.reduce(
        (acc, c) => Object.entries(c.valores).reduce((a, [col, v]) => aplicarParche(a, c.clave, col, v), acc), m,
      ));
    }
    const extra = sinCatalogo > 0
      ? ` ${plural(sinCatalogo, 'repuesto quedó', 'repuestos quedaron')} sin años porque no tiene marca y modelo, o su modelo no está en el catálogo.`
      : '';
    setCambioMasivo({
      columna,
      descripcion: cambios.length > 0
        ? `${columna === 'anio_desde' ? 'Pusimos todos los años de su modelo' : 'Pusimos hasta el último año de su modelo'} en ${plural(cambios.length, 'repuesto', 'repuestos')}.${extra}`
        : `No pudimos completar ningún año.${extra}`,
      deshacer: () => actualizar((m) => {
        const parches = { ...(m.parches ?? {}) };
        for (const c of cambios) {
          const fila = { ...(parches[c.clave] ?? {}) };
          for (const [col, v] of Object.entries(c.valores)) if (fila[col] === v) delete fila[col];
          if (Object.keys(fila).length) parches[c.clave] = fila; else delete parches[c.clave];
        }
        return { ...m, parches };
      }),
    });
  };

  const dejarVacias = (columna: string) => {
    setOpcionalesVacios((prev) => [...new Set([...prev, columna])]);
    setCambioMasivo({
      columna,
      descripcion: `${etiquetaCampo(columna)} quedará vacío en los repuestos que no lo traen.`,
      deshacer: () => setOpcionalesVacios((prev) => prev.filter((c) => c !== columna)),
    });
  };

  const completarGrupo = (columna: string, grupo: string, valor: string) => actualizar((prev) => {
    const completar = { ...(prev.completar ?? {}) };
    const porGrupo = { ...(completar[columna] ?? {}) };
    if (valor) porGrupo[grupo] = valor; else delete porGrupo[grupo];
    completar[columna] = porGrupo;
    return { ...prev, completar };
  });

  /* ------------------------------ Revisión ------------------------------ */

  const firmaActual = useMemo(() => JSON.stringify(mapping), [mapping]);
  const revisionMostrada: RevisionServidor = revision.estado === 'lista' && firmaRevisada !== firmaActual
    ? { ...revision, estado: 'desactualizada' }
    : revision;

  const revisar = useCallback(async () => {
    if (!transformacion) return;
    const session = getStoredSession();
    if (!session?.sellerId || !session?.token) {
      setRevision({ ...REVISION_VACIA, estado: 'error', error: 'Tu sesión expiró. Vuelve a iniciar sesión.' });
      return;
    }
    const firma = firmaActual;
    setRevision((r) => ({ ...r, estado: 'revisando', error: null }));
    try {
      const file = await buildOfficialXlsxFile(
        transformacion.inventario, `mi-excel_${getIsoTimestampString()}.xlsx`, esquema.version, transformacion.compatibilidades ?? undefined,
      );
      const data = await validarExcel(session.sellerId, session.token, file);
      const porClave: Record<string, FilaResultado> = {};
      for (const f of data.filas) {
        const clave = transformacion.clavesInventario[f.fila - 2];
        if (clave !== undefined) porClave[clave] = f;
      }
      revisadoRef.current = { firma, file, claves: transformacion.clavesInventario, filas: data.filas };
      setFirmaRevisada(firma);
      const columnasRevisadas = (transformacion.inventario[0] ?? []).map(String);
      const valores: Record<string, string[]> = {};
      transformacion.clavesInventario.forEach((clave, i) => {
        valores[clave] = columnasRevisadas.map((_, c) => String(transformacion.inventario[i + 1]?.[c] ?? ''));
      });
      setRevisionFilas({ porClave, columnas: columnasRevisadas, valores });
      setRevision({ estado: 'lista', porClave, error: null, avisosGenerales: data.avisosGenerales ?? [] });
    } catch (err) {
      setRevision({ ...REVISION_VACIA, estado: 'error', error: err instanceof Error ? err.message : 'No pudimos revisar tu inventario.' });
    }
  }, [transformacion, esquema.version, firmaActual]);

  // Al llegar a la etapa 4 se revisa solo, si no hay una revisión al día.
  useEffect(() => {
    if (fase !== 'trabajo' || paso !== 4 || revisionMostrada.estado === 'revisando' || revisionMostrada.estado === 'lista') return;
    if (revisionMostrada.estado === 'error') return;
    // La revisión es un pedido al servidor: el estado "revisando" es parte de sincronizarse con él.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void revisar();
    // Sólo al entrar a la etapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase, paso]);

  /* ------------------------------ Publicar ------------------------------ */

  const obtenerImagen = async (nombre: string): Promise<Blob | null> => {
    if (imagenes[nombre]) return imagenes[nombre];
    const id = borrador.guardadas[nombre];
    return id !== undefined ? descargarImagenBorrador(id) : null;
  };

  /** Sube las fotos de los productos ya publicados. Si todo sale bien, borra el progreso guardado. */
  const subirFotosPublicadas = async (
    productoPorClave: Record<string, number>, skuPorClave: Record<string, string>,
  ): Promise<FotoUploadResultado[]> => {
    const session = getStoredSession();
    if (!session) return [];
    const productos = Object.entries(productoPorClave)
      .filter(([clave]) => (asignaciones[clave] ?? []).length > 0)
      .map(([clave, productoId]) => ({ clave, sku: skuPorClave[clave] ?? '', productoId }));
    if (productos.length === 0) return [];
    setProgreso({ texto: 'Subiendo las fotos de tus repuestos…', hechas: 0, total: productos.length });
    return subirFotosAProductos({
      sellerId: session.sellerId,
      token: session.token,
      productos,
      asignaciones,
      obtenerImagen,
      onProgreso: (hechas, total) => setProgreso({ texto: 'Subiendo las fotos de tus repuestos…', hechas, total }),
      onEspera: (s) => setProgreso((p) => (p ? { ...p, texto: `Pausa de ${s} s por el límite de envíos; seguimos solos…` } : p)),
    });
  };

  const terminarPublicacion = async (fotos: FotoUploadResultado[], base: Omit<ResultadoPublicacion, 'fotos'>) => {
    if (fotos.every((f) => f.ok)) {
      try { await borrador.descartar(); } catch { /* El progreso viejo se puede descartar a mano después. */ }
      setPublicacionPendiente(null);
    }
    setResultado({ ...base, fotos });
    setProgreso(null);
    setFase('publicado');
  };

  const publicar = async () => {
    const revisado = revisadoRef.current;
    const session = getStoredSession();
    if (!revisado || revisado.firma !== firmaActual || !session || !tabla) return;
    setErrorPublicar(null);
    setFase('publicando');
    setProgreso({ texto: 'Publicando tus repuestos…', hechas: 0, total: 0 });
    try {
      const excluidas = revisado.filas.filter((f) => f.estado === 'ERROR');
      const aSubir = revisado.filas.filter((f) => f.estado !== 'ERROR');
      const archivoASubir = excluidas.length === 0 ? revisado.file : await construirExcelSoloValidos(revisado.file, aSubir.map((f) => f.fila));
      const data = await cargarExcel(session.sellerId, session.token, archivoASubir, (hechas, total, mensaje) => {
        setProgreso({ texto: mensaje ?? `Publicando tus repuestos… ${hechas.toLocaleString('es-CL')} de ${total.toLocaleString('es-CL')}`, hechas, total });
      });
      const filas = excluidas.length === 0 ? data.filas : data.filas.map((f, i) => ({ ...f, fila: aSubir[i]?.fila ?? f.fila }));
      const productoPorClave: Record<string, number> = {};
      const skuPorClave: Record<string, string> = {};
      for (const f of filas) {
        const clave = revisado.claves[f.fila - 2];
        if (clave === undefined || f.estado === 'ERROR' || f.productoId == null) continue;
        productoPorClave[clave] = f.productoId;
        skuPorClave[clave] = f.sku;
      }
      const nombrePorClave = new Map(tabla.filas.map((f) => [f.clave, { nombre: f.nombre, numero: f.numeroFila }]));
      const noPublicados = [...excluidas, ...filas.filter((f) => f.estado === 'ERROR')].map((f) => {
        const info = nombrePorClave.get(revisado.claves[f.fila - 2]);
        return { fila: info?.numero ?? f.fila, sku: f.sku, nombre: info?.nombre ?? '', motivos: f.mensajes };
      });
      const publicados = Object.keys(productoPorClave).length;
      if (userCols.length && mapping) guardarMapeo(headerSignature(userCols), mapping, archivo?.file.name);
      if (publicados > 0) onUploadSuccess();

      const pendiente = { etapa: 'fotos' as const, productoPorClave, skuPorClave };
      setPublicacionPendiente(pendiente);
      // Si se corta la luz subiendo las fotos, retomar ofrece terminarlas en vez de volver a publicar.
      await borrador.guardarConEstado({ ...estadoBorrador, publicacion: pendiente });
      const fotos = await subirFotosPublicadas(productoPorClave, skuPorClave);
      await terminarPublicacion(fotos, { publicados, noPublicados, archivoRepetidoEl: data.archivoRepetido ? data.archivoYaCargadoEl ?? '' : null });
      if (fotos.some((f) => f.ok)) onUploadSuccess();
    } catch (err) {
      setProgreso(null);
      setErrorPublicar(err instanceof Error ? err.message : 'No se pudo publicar tu inventario.');
      setFase('trabajo');
    }
  };

  const terminarFotosPendientes = async () => {
    if (!publicacionPendiente) return;
    setFase('publicando');
    try {
      const fotos = await subirFotosPublicadas(publicacionPendiente.productoPorClave, publicacionPendiente.skuPorClave);
      await terminarPublicacion(fotos, { publicados: Object.keys(publicacionPendiente.productoPorClave).length, noPublicados: [], archivoRepetidoEl: null });
      if (fotos.some((f) => f.ok)) onUploadSuccess();
    } catch (err) {
      setProgreso(null);
      setErrorPublicar(err instanceof Error ? err.message : 'No se pudieron subir las fotos.');
      setFase('trabajo');
    }
  };

  /* ---------------------------- Retomar / descartar ---------------------------- */

  const reiniciar = () => {
    quitarArchivo();
    setPaso(1);
    setOpcionalesVacios([]);
    setImagenes({});
    setOrigenFotos(null);
    setNombreZip(null);
    setTotalFotos(0);
    setRevision(REVISION_VACIA);
    setRevisionFilas(null);
    revisadoRef.current = null;
    setPublicacionPendiente(null);
    setResultado(null);
    setCambioMasivo(null);
    setErrorPublicar(null);
  };

  const hidratar = async (b: BorradorCarga, e: EstadoBorrador, file: File) => {
    const libro = await leerLibro(file);
    const indice = b.archivoRecortado ? 0 : Math.min(e.archivo?.hojaIndex ?? 0, libro.length - 1);
    setHojas(libro);
    aplicarSeleccion(libro, indice, e.archivo?.filaEncabezados ?? detectarFilaEncabezados(libro[indice].aoa), e.mapping);
    setArchivo({ file, sha256: b.archivoSha256 ?? e.archivo?.sha256 ?? await huellaArchivo(file) });
    setPaso(e.paso);
    setOpcionalesVacios(e.opcionalesVacios);
    setAsignaciones(e.fotos.asignaciones);
    setOrigenFotos(e.fotos.origen);
    setTotalFotos(e.fotos.totalDisponibles);
    setVista(e.vistaPaso4);
    setPublicacionPendiente(e.publicacion);
    borrador.adoptar(b, e);
    const asignadas = fotosAsignadas(e.fotos.asignaciones).length;
    if (e.fotos.totalDisponibles > 0 || asignadas > 0) setDialogoFotos({ guardadas: b.imagenes.length, total: e.fotos.totalDisponibles });
    setFase('trabajo');
  };

  const retomar = async (b: BorradorCarga, e: EstadoBorrador) => {
    setErrorRetomar(null);
    setFase('cargando');
    try {
      if (!b.tieneArchivo) {
        setPedirMismoArchivo({ borrador: b, estado: e });
        setFase('trabajo');
        return;
      }
      await hidratar(b, e, await descargarArchivoBorrador(b.archivoNombre ?? e.archivo?.nombre ?? 'mi-inventario.xlsx'));
    } catch (err) {
      setErrorRetomar(err instanceof Error ? err.message : 'No pudimos retomar tu progreso.');
      setFase('retomar');
    }
  };

  const recibirMismoArchivo = async (file: File) => {
    if (!pedirMismoArchivo) return;
    const { borrador: b, estado: e } = pedirMismoArchivo;
    const huella = await huellaArchivo(file);
    if (e.archivo?.sha256 && huella !== e.archivo.sha256) {
      setErrorRetomar(`Ese archivo no es el mismo que estabas cargando (${e.archivo.nombre}). Elige ese mismo Excel, sin cambios.`);
      return;
    }
    setPedirMismoArchivo(null);
    setErrorRetomar(null);
    setFase('cargando');
    try {
      await hidratar(b, e, file);
    } catch (err) {
      setErrorRetomar(err instanceof Error ? err.message : 'No pudimos leer el archivo.');
      setFase('trabajo');
    }
  };

  // Al entrar: ¿hay un progreso guardado?
  const buscadoRef = useRef(false);
  useEffect(() => {
    if (buscadoRef.current) return;
    buscadoRef.current = true;
    obtenerBorrador()
      .then((b) => {
        const e = b ? deserializarBorrador(b.estadoJson) : null;
        if (!b || !e || !e.archivo) { setFase('trabajo'); return; }
        setBorradorEncontrado({ borrador: b, estado: e });
        if (retomarDirecto) void retomar(b, e);
        else setFase('retomar');
      })
      .catch(() => setFase('trabajo'));
    // Sólo al entrar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const descartarTodo = async () => {
    try {
      await borrador.descartar();
    } catch {
      try { await eliminarBorrador(); } catch { /* sin conexión: se reintenta al guardar de nuevo */ }
    }
    setConfirmarDescarte(null);
    setBorradorEncontrado(null);
    reiniciar();
    setFase('trabajo');
  };

  const irAPaso = (n: PasoMiExcel) => {
    setPaso(n);
    document.querySelector('.mx-cabecera')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const volverAlInicio = () => {
    if (borrador.hayCambiosSinGuardar()) setSalirConfirmar(true);
    else onVolver();
  };

  /* -------------------------------- Pantallas -------------------------------- */

  const indicadorGuardado = (() => {
    if (!archivo) return null;
    switch (borrador.estadoGuardado) {
      case 'guardando': return <span className="mx-guardado guardando"><Loader2 size={14} className="mx-girando" /> {borrador.progresoFotos ? `Guardando fotos ${borrador.progresoFotos.hechas}/${borrador.progresoFotos.total}…` : 'Guardando…'}</span>;
      case 'guardado': return <span className="mx-guardado ok"><Check size={14} /> Guardado {haceCuanto(borrador.ultimoGuardado, ahora)}</span>;
      case 'sin-guardar': return <span className="mx-guardado pendiente">Cambios sin guardar</span>;
      case 'error': return <span className="mx-guardado error"><CloudOff size={14} /> No se pudo guardar</span>;
      case 'conflicto': return <span className="mx-guardado error"><AlertTriangle size={14} /> Guardado desde otra pestaña</span>;
      default: return null;
    }
  })();

  const inputsFotos = (
    <>
      <input ref={inputCarpeta} type="file" multiple hidden {...{ webkitdirectory: '', directory: '' }} onChange={(e) => { if (e.target.files?.length) recibirCarpeta(e.target.files); e.target.value = ''; }} />
      <input ref={inputZip} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void recibirZip(f); e.target.value = ''; }} />
    </>
  );

  if (fase === 'buscando' || fase === 'cargando') {
    return (
      <div className="bulk-upload-page mx">
        <div className="mx-cargando"><Loader2 size={26} className="mx-girando" /> {fase === 'buscando' ? 'Revisando si tienes un progreso guardado…' : 'Retomando tu progreso…'}</div>
      </div>
    );
  }

  if (fase === 'retomar' && borradorEncontrado) {
    const { borrador: b, estado: e } = borradorEncontrado;
    const { fecha, hora } = fechaYHora(b.updatedAt);
    return (
      <div className="bulk-upload-page mx">
        <Modal titulo="Tienes un progreso guardado" icono={<History size={18} />} ancho={540}>
          {confirmarDescarte === 'retomar' ? (
            <>
              <p>¿Seguro que quieres <b>descartar todo lo que guardaste</b> y empezar de cero? Esto no se puede deshacer.</p>
              <div className="mx-botonera derecha">
                <button type="button" className="btn btn-secondary mx-btn" onClick={() => setConfirmarDescarte(null)}>No, volver</button>
                <button type="button" className="btn btn-secondary mx-btn mx-btn-peligro" onClick={descartarTodo}><Trash2 size={15} /> Sí, descartar y empezar de cero</button>
              </div>
            </>
          ) : (
            <>
              <p className="mx-retomar-texto">
                Hemos notado que tienes un progreso guardado el <b>{fecha}</b> a las <b>{hora}</b>. ¿Quieres retomarlo?
              </p>
              <ul className="mx-retomar-resumen">
                <li><span>Archivo</span><b>{e.archivo?.nombre}</b></li>
                <li><span>Ibas en</span><b>Paso {e.paso} de 4: {PASOS_MI_EXCEL[e.paso - 1].titulo}</b></li>
                {e.archivo?.filas ? <li><span>Repuestos</span><b>{e.archivo.filas.toLocaleString('es-CL')}</b></li> : null}
                <li><span>Fotos asignadas</span><b>{fotosAsignadas(e.fotos.asignaciones).length.toLocaleString('es-CL')}</b></li>
              </ul>
              {errorRetomar && <div className="mx-alerta error"><AlertTriangle size={16} /> {errorRetomar}</div>}
              <div className="mx-botonera derecha">
                <button type="button" className="btn btn-secondary mx-btn" onClick={() => setConfirmarDescarte('retomar')}><RotateCcw size={15} /> Descartar y empezar de cero</button>
                <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={() => void retomar(b, e)} autoFocus>
                  <History size={15} /> Retomar desde el punto guardado
                </button>
              </div>
            </>
          )}
        </Modal>
      </div>
    );
  }

  if (fase === 'publicando') {
    const pct = progreso && progreso.total > 0 ? Math.round((progreso.hechas / progreso.total) * 100) : null;
    return (
      <div className="bulk-upload-page mx">
        <section className="mx-tarjeta mx-publicando" role="status" aria-live="polite">
          <Loader2 size={34} className="mx-girando" />
          <h3>{progreso?.texto ?? 'Publicando…'}</h3>
          {pct !== null && (
            <>
              <div className="mx-barra"><span style={{ width: `${pct}%` }} /></div>
              <p>{progreso?.hechas.toLocaleString('es-CL')} de {progreso?.total.toLocaleString('es-CL')}</p>
            </>
          )}
          <p className="mx-nota">No cierres esta pestaña hasta que termine. Tu progreso queda guardado por si algo se corta.</p>
        </section>
      </div>
    );
  }

  if (fase === 'publicado' && resultado) {
    const fotosOk = resultado.fotos.filter((f) => f.ok).length;
    const fotosMal = resultado.fotos.filter((f) => !f.ok);
    const descargarNoPublicados = async () => {
      const XLSX = await import('xlsx');
      const aoa = [['Fila en tu Excel', 'Código', 'Nombre', 'Por qué no se publicó'], ...resultado.noPublicados.map((n) => [n.fila, n.sku, n.nombre, n.motivos.join(' ')])];
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(sanitizeAoaForExport(aoa)), 'No publicados');
      XLSX.writeFile(libro, `repuestos-no-publicados_${getIsoTimestampString()}.xlsx`);
    };
    return (
      <div className="bulk-upload-page mx">
        <section className="mx-tarjeta mx-resultado">
          <CheckCircle2 size={44} className={resultado.publicados > 0 ? 'ok' : 'mal'} />
          <h3>{resultado.publicados > 0 ? '¡Listo! Tu inventario está publicado' : 'No se publicó ningún repuesto'}</h3>
          {resultado.archivoRepetidoEl !== null && (
            <div className="mx-alerta info">Este mismo archivo ya se había cargado{resultado.archivoRepetidoEl ? ` el ${fechaYHora(resultado.archivoRepetidoEl).fecha}` : ''}: te mostramos esa carga.</div>
          )}
          <ul className="mx-resultado-lista">
            <li className="ok"><CheckCircle2 size={18} /> <b>{plural(resultado.publicados, 'repuesto publicado', 'repuestos publicados')}</b> en la web y la app.</li>
            {resultado.fotos.length > 0 && <li className={fotosMal.length ? 'aviso' : 'ok'}><CheckCircle2 size={18} /> {plural(fotosOk, 'repuesto con sus fotos', 'repuestos con sus fotos')}{fotosMal.length ? `; ${plural(fotosMal.length, 'no pudo recibir sus fotos', 'no pudieron recibir sus fotos')}` : ''}.</li>}
            {resultado.noPublicados.length > 0 && <li className="mal"><XCircle size={18} /> {plural(resultado.noPublicados.length, 'repuesto no se publicó', 'repuestos no se publicaron')} porque tenían algo por corregir.</li>}
          </ul>
          {fotosMal.length > 0 && (
            <div className="mx-alerta aviso">
              <AlertTriangle size={16} />
              <span>
                Algunas fotos no se subieron ({fotosMal.slice(0, 3).map((f) => f.sku).join(', ')}{fotosMal.length > 3 ? '…' : ''}). Dejamos tu progreso guardado para que
                puedas reintentarlo. <button type="button" className="mx-link" onClick={() => { setFase('trabajo'); void terminarFotosPendientes(); }}>Reintentar ahora</button>
              </span>
            </div>
          )}
          <div className="mx-botonera centro">
            {resultado.noPublicados.length > 0 && (
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => void descargarNoPublicados()}><Download size={15} /> Descargar lo que no se publicó</button>
            )}
            <button type="button" className="btn btn-secondary mx-btn" onClick={() => { reiniciar(); setFase('trabajo'); }}>Cargar otro archivo</button>
            <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={onClose}>Ir a mi inventario</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`bulk-upload-page mx ${paso === 3 ? 'mx-ancho' : ''}`}>
      {inputsFotos}
      <header className="mx-cabecera">
        <div className="mx-cabecera-titulo">
          <button type="button" className="mx-icono-btn" onClick={volverAlInicio} aria-label="Volver a ¿Qué tienes?" title="Volver"><ArrowLeft size={18} /></button>
          <div>
            <h2>Carga tu inventario desde tu propio Excel</h2>
            <p>Te guiamos en 4 pasos. Tu progreso se guarda solo y puedes retomarlo cuando quieras.</p>
          </div>
        </div>
        <div className="mx-cabecera-acciones">
          {indicadorGuardado}
          {archivo && (
            <>
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => void borrador.guardar()} disabled={borrador.estadoGuardado === 'guardando'}>
                <Save size={15} /> Guardar progreso
              </button>
              <button type="button" className="btn btn-secondary mx-btn mx-btn-peligro-suave" onClick={() => setConfirmarDescarte('boton')}>
                <Trash2 size={15} /> Descartar todo
              </button>
            </>
          )}
        </div>
      </header>

      <ol className="mx-pasos" aria-label="Pasos de la carga">
        {PASOS_MI_EXCEL.map((p) => {
          const estado = p.n < paso ? 'listo' : p.n === paso ? 'actual' : 'pendiente';
          const puede = p.n < paso;
          return (
            <li key={p.n} className={`mx-paso-item ${estado}`} aria-current={estado === 'actual' ? 'step' : undefined}>
              <button type="button" disabled={!puede} onClick={() => puede && irAPaso(p.n)} title={puede ? `Volver a "${p.titulo}"` : undefined}>
                <span className="mx-paso-num">{estado === 'listo' ? <Check size={15} /> : p.n}</span>
                <span className="mx-paso-texto"><b>{p.titulo}</b><small>{p.detalle}</small></span>
              </button>
            </li>
          );
        })}
      </ol>

      {borrador.estadoGuardado === 'error' && (
        <div className="mx-alerta error">
          <CloudOff size={16} />
          <span>No pudimos guardar tu progreso{borrador.errorGuardado ? `: ${borrador.errorGuardado}` : ''}. Seguimos intentando; también puedes reintentar ahora.</span>
          <button type="button" className="mx-link" onClick={() => void borrador.guardar()}>Reintentar</button>
        </div>
      )}
      {errorPublicar && <div className="mx-alerta error"><AlertTriangle size={16} /> {errorPublicar}</div>}
      {publicacionPendiente && paso === 4 && (
        <div className="mx-alerta aviso">
          <AlertTriangle size={16} />
          <span>Tus repuestos ya se publicaron, pero faltó subir algunas fotos.</span>
          <button type="button" className="btn btn-primary btn-primary-blue mx-btn mx-btn-chico" onClick={() => void terminarFotosPendientes()}>Terminar de subir fotos</button>
        </div>
      )}

      {paso === 1 && (
        <PasoSubir
          archivo={archivo?.file ?? null}
          hojas={hojas}
          hojaIndex={hojaIndex}
          filaEncabezados={filaEncabezados}
          columnas={userCols.length}
          filas={userRows.length}
          leyendo={leyendo}
          error={errorArchivo}
          onArchivo={(f) => void handleArchivo(f)}
          onQuitarArchivo={quitarArchivo}
          onElegirHoja={(i) => aplicarSeleccion(hojas, i, detectarFilaEncabezados(hojas[i].aoa))}
          onElegirFila={(f) => aplicarSeleccion(hojas, hojaIndex, f)}
          fotos={Object.keys(imagenes).length}
          origenFotos={origenFotos}
          nombreZip={nombreZip}
          leyendoFotos={leyendoFotos}
          errorFotos={errorFotos}
          fotosGuardadas={Object.keys(borrador.guardadas).length}
          onCarpeta={recibirCarpeta}
          onZip={(f) => void recibirZip(f)}
          onQuitarFotos={() => { setImagenes({}); setOrigenFotos(null); setNombreZip(null); setTotalFotos(0); }}
          onCancelar={volverAlInicio}
          onSiguiente={() => irAPaso(2)}
        />
      )}

      {paso === 2 && mapping && detecciones && (
        <PasoRelacionar
          campos={campos}
          mapping={mapping}
          userCols={userCols}
          userRows={userRows}
          detecciones={detecciones}
          auto={auto}
          columnasACompletar={columnasACompletar}
          reutilizado={reutilizado}
          onOficial={setOficial}
          onExtra={(id, politica) => actualizar((m) => ({ ...m, extras: { ...m.extras, [id]: politica } }))}
          onBandera={(b, v) => actualizar((m) => ({ ...m, [b]: v }))}
          onColumnaFotos={(id) => actualizar((m) => {
            const extras = { ...m.extras };
            if (id) extras[id] = 'ignore';
            return { ...m, columnaFotos: id, extras };
          })}
          onUniversal={(v) => actualizar((m) => aplicarATodasVacias(m, 'compatibilidad_general', v ? 'SI' : ''))}
          onVehiculoPorFila={() => actualizar((m) => ({ ...m, vehiculoPorFila: true }))}
          onAtras={() => irAPaso(1)}
          onSiguiente={() => irAPaso(3)}
        />
      )}

      {paso === 3 && tabla && mapping && transformacion && (
        <PasoCompletar
          key={claveACorregir ?? 'tabla'}
          tabla={tabla}
          columnas={columnasTabla}
          campos={campos}
          mapping={mapping}
          esquema={esquema}
          modelosDisponibles={modelosDisponibles}
          porCompletar={transformacion.porCompletar}
          opcionalesVacios={opcionalesVacios}
          catalogoModelosCaido={catalogoCaido}
          onParche={(clave, col, v) => actualizar((m) => aplicarParche(m, clave, col, v))}
          onParches={aplicarParches}
          versionesDe={versionesDe}
          pedirVersiones={pedirVersiones}
          onAplicarATodas={aplicarATodas}
          onDejarVacias={dejarVacias}
          onCompletarVehiculo={completarVehiculo}
          onCompletarGrupo={completarGrupo}
          cambioMasivo={cambioMasivo}
          onOlvidarCambioMasivo={() => setCambioMasivo(null)}
          imagenes={imagenes}
          guardadas={borrador.guardadas}
          asignaciones={asignaciones}
          onAsignarFotos={(clave, nombres) => setAsignaciones((prev) => {
            const sig = { ...prev };
            if (nombres.length) sig[clave] = nombres; else delete sig[clave];
            return sig;
          })}
          onAutoAsignar={() => autoAsignar(imagenes)}
          onAgregarFotos={() => inputCarpeta.current?.click()}
          enlacesPendientes={Object.values(enlacesPendientes).reduce((n, u) => n + u.length, 0)}
          descargandoEnlaces={descargandoEnlaces}
          onTraerEnlaces={() => void traerEnlaces()}
          claveInicial={claveACorregir}
          servidor={revisionFilas}
          onAtras={() => irAPaso(2)}
          onSiguiente={() => { setClaveACorregir(null); irAPaso(4); }}
        />
      )}

      {paso === 4 && tabla && mapping && (
        <PasoVistaPrevia
          tabla={tabla}
          campos={campos}
          mapping={mapping}
          esquema={esquema}
          modelosDisponibles={modelosDisponibles}
          vista={vista}
          onVista={setVista}
          revision={revisionMostrada}
          servidor={revisionMostrada.estado === 'lista' || revisionMostrada.estado === 'desactualizada' ? revisionFilas : null}
          onRevisar={() => void revisar()}
          onParche={(clave, col, v) => actualizar((m) => aplicarParche(m, clave, col, v))}
          onParches={aplicarParches}
          versionesDe={versionesDe}
          pedirVersiones={pedirVersiones}
          imagenes={imagenes}
          guardadas={borrador.guardadas}
          asignaciones={asignaciones}
          onAsignarFotos={(clave, nombres) => setAsignaciones((prev) => {
            const sig = { ...prev };
            if (nombres.length) sig[clave] = nombres; else delete sig[clave];
            return sig;
          })}
          onCorregir={(clave) => { setClaveACorregir(clave); irAPaso(3); }}
          onAtras={() => irAPaso(3)}
          onPublicar={() => void publicar()}
        />
      )}

      {/* ------------------------------ Diálogos ------------------------------ */}

      {pedirMismoArchivo && (
        <Modal titulo="Vuelve a elegir tu Excel" icono={<History size={18} />}>
          <p>
            Tu Excel <b>{pedirMismoArchivo.estado.archivo?.nombre}</b> era demasiado grande para guardarlo en tu cuenta, así que
            guardamos sólo tus decisiones. Para retomar, elige <b>ese mismo archivo</b> de tu computador.
          </p>
          {errorRetomar && <div className="mx-alerta error"><AlertTriangle size={16} /> {errorRetomar}</div>}
          <label className="btn btn-primary btn-primary-blue mx-btn">
            Elegir mi Excel
            <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void recibirMismoArchivo(f); e.target.value = ''; }} />
          </label>
          <div className="mx-botonera derecha">
            <button type="button" className="mx-link" onClick={() => { setPedirMismoArchivo(null); void descartarTodo(); }}>Mejor empezar de cero</button>
          </div>
        </Modal>
      )}

      {dialogoFotos && (
        <Modal
          titulo="Vuelve a elegir tus fotos"
          icono={<FolderOpen size={18} />}
          onCerrar={() => setDialogoFotos(null)}
          acciones={(
            <>
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => setDialogoFotos(null)}>Seguir sin elegir</button>
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => inputZip.current?.click()}><FileArchive size={15} /> Subir ZIP</button>
              <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={() => inputCarpeta.current?.click()}><FolderOpen size={15} /> Elegir carpeta</button>
            </>
          )}
        >
          <p>Retomaste tu carga desde donde la dejaste.</p>
          <p>
            Para ahorrar espacio y tiempo, <b>sólo guardamos las fotos que ya habías asignado a un repuesto</b>
            {dialogoFotos.guardadas > 0 ? ` (${plural(dialogoFotos.guardadas, 'foto', 'fotos')})` : ''}: esas siguen ahí.
            {dialogoFotos.total > 0 && <> Las demás fotos de tu {origenFotos === 'zip' ? 'ZIP' : 'carpeta'} (tenía {plural(dialogoFotos.total, 'foto', 'fotos')}) no se guardaron.</>}
          </p>
          <p>Si vas a seguir asignando fotos, vuelve a elegir la misma carpeta o ZIP. Si ya terminaste con las fotos, puedes seguir sin elegir.</p>
          {errorFotos && <div className="mx-alerta error"><AlertTriangle size={16} /> {errorFotos}</div>}
        </Modal>
      )}

      {confirmarDescarte === 'boton' && (
        <Modal
          titulo="¿Descartar todo y empezar de cero?"
          icono={<Trash2 size={18} />}
          tono="peligro"
          onCerrar={() => setConfirmarDescarte(null)}
          acciones={(
            <>
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => setConfirmarDescarte(null)}>No, seguir</button>
              <button type="button" className="btn btn-secondary mx-btn mx-btn-peligro" onClick={() => void descartarTodo()}>Sí, descartar todo</button>
            </>
          )}
        >
          <p>Se borra tu progreso guardado: el archivo, las relaciones de columnas, lo que completaste y las fotos asignadas. <b>No se puede deshacer.</b></p>
          <p>Lo que ya esté publicado en tu inventario no se toca.</p>
        </Modal>
      )}

      {borrador.conflicto && (
        <Modal titulo="Tu progreso cambió en otra pestaña" icono={<AlertTriangle size={18} />} tono="aviso">
          <p>
            Guardaste esta misma carga desde otra pestaña o ventana
            {borrador.conflicto.updatedAt ? ` (${fechaYHora(borrador.conflicto.updatedAt).hora})` : ''}. ¿Con cuál te quedas?
          </p>
          <div className="mx-botonera derecha">
            <button
              type="button"
              className="btn btn-secondary mx-btn"
              onClick={() => {
                void obtenerBorrador().then((b) => {
                  const e = b ? deserializarBorrador(b.estadoJson) : null;
                  if (b && e) void retomar(b, e);
                });
              }}
            >
              Usar lo de la otra pestaña
            </button>
            <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={() => void borrador.resolverConflictoConservando()}>
              <Wand2 size={15} /> Quedarme con lo de esta pestaña
            </button>
          </div>
        </Modal>
      )}

      {salirConfirmar && (
        <DialogoGuardarCambios
          onGuardarYSalir={async () => { const ok = await borrador.guardar(); if (ok) { setSalirConfirmar(false); onVolver(); } return ok; }}
          onSalirSinGuardar={() => { setSalirConfirmar(false); onVolver(); }}
          onQuedarse={() => setSalirConfirmar(false)}
        />
      )}
    </div>
  );
}

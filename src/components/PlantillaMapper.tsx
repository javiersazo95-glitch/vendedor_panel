import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, Wand2, AlertTriangle, ArrowLeft, ArrowRight, Download, X,
  UploadCloud, ArrowLeftRight, ListChecks, Rocket, ShieldCheck, Check, Image as ImageIcon,
} from 'lucide-react';
import {
  ESQUEMA_FALLBACK,
  SECCIONES_MAPPER,
  camposDesdeEsquema,
  autoDetectMapping,
  filasNoRepuesto,
  reconcileMapping,
  requiereValorEnPanel,
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
  limiteDeColumna,
  normalizarCelda,
  pareceColumnaDeRangos,
  partirRangoAnios,
  validarValorFijo,
} from '../utils/plantillaNormalizacion';
import { buscarEnCatalogo, buscarEnTexto } from '../utils/plantillaCatalogos';
import { detectarBandas, detectarSegundaTabla } from '../utils/plantillaFilas';
import { fotosPorSku, tipoColumnaFotos, type TipoColumnaFotos } from '../utils/plantillaFotos';
import {
  detectarSkusRepetidos,
  pareceColumnaDeAplicacion,
  parsearAplicacion,
  detectarAplicacionesMultiples,
  separarPorSku,
} from '../utils/plantillaCompatibilidad';
import { MARCAS_VEHICULO_BASE } from '../utils/marcasVehiculoBase';
import {
  contarValoresDeColumna,
  decisionesDeCatalogo,
  todasLasSubcategorias,
  type DecisionCatalogo,
} from '../utils/plantillaCatalogos';

interface PlantillaMapperProps {
  /**
   * `fotos` son las que el vendedor declaró en su Excel (URL o nombre de archivo), por
   * SKU: no van en el archivo oficial, van al paso de fotos.
   */
  onGenerated: (file: File, extras?: { fotos?: Record<string, string[]>; archivoOriginal?: File }) => void;
  onCancel: () => void;
  /** Esquema vigente de la plantilla. Por defecto, el contrato de respaldo del panel. */
  esquema?: EsquemaPlantilla;
  /** Mapeos guardados en la cuenta del vendedor, por firma de encabezados. */
  mapeosGuardados?: Record<string, Mapping>;
  /** Guarda el mapeo en la cuenta. Sin esto, sólo queda en este navegador. */
  onGuardarMapeo?: (firma: string, mapping: Mapping, archivoNombre?: string) => void;
  /** Archivo del vendedor con el que abrir, para volver al mapeo sin re-subirlo. */
  archivoInicial?: File | null;
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

/**
 * Busca la columna que trae la aplicación escrita de corrido. Mira primero las que ya
 * quedaron en compatibilidad y después las que el vendedor no asignó a nada: una columna
 * "Aplicación" es justamente la que no calzaba en ninguna parte y terminaba en la
 * descripción, perdiendo la compatibilidad.
 */
function buscarColumnaAplicacion(
  mapping: Mapping,
  userCols: UserColumn[],
  userRows: unknown[][],
  marcas: string[],
): { col: UserColumn; ejemplo?: string; partes: ReturnType<typeof parsearAplicacion>; necesitaAsignar: boolean } | null {
  const marcasEfectivas = marcas && marcas.length ? marcas : MARCAS_VEHICULO_BASE;
  if (marcasEfectivas.length === 0) return null;
  const asignadas = new Set(Object.values(mapping.oficial).filter(Boolean) as string[]);
  const candidatas = [
    ...['compatibilidad_modelo', 'compatibilidad_marca']
      .map((key) => userCols.find((c) => c.id === mapping.oficial[key]))
      .filter((c): c is UserColumn => !!c)
      .map((col) => ({ col, necesitaAsignar: false })),
    ...userCols.filter((c) => !asignadas.has(c.id)).map((col) => ({ col, necesitaAsignar: true })),
  ];

  for (const { col, necesitaAsignar } of candidatas) {
    const muestra = userRows.slice(0, 50).map((r) => String((r as unknown[])[col.index] ?? '')).filter(Boolean);
    if (!pareceColumnaDeAplicacion(muestra, marcasEfectivas)) continue;
    const ejemplo = muestra.find((v) => parsearAplicacion(v, marcasEfectivas));
    return { col, ejemplo, partes: ejemplo ? parsearAplicacion(ejemplo, marcasEfectivas) : null, necesitaAsignar };
  }
  return null;
}

const plural = (n: number, singular: string, plural_: string) =>
  `${n.toLocaleString('es-CL')} ${n === 1 ? singular : plural_}`;

export const PlantillaMapper: React.FC<PlantillaMapperProps> = ({
  onGenerated,
  onCancel,
  esquema = ESQUEMA_FALLBACK,
  mapeosGuardados,
  onGuardarMapeo,
  archivoInicial,
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
    const firma = cols.length ? headerSignature(cols) : '';
    const saved = firma ? (mapeosGuardados?.[firma] ?? loadSavedMapping(firma)) : null;
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

  // Reabrir el mapeo con el archivo que el vendedor ya habia subido: volver atras no
  // puede costarle buscar el Excel otra vez en su computador.
  const archivoInicialRef = useRef<File | null>(null);
  useEffect(() => {
    if (!archivoInicial || archivoInicialRef.current === archivoInicial) return;
    archivoInicialRef.current = archivoInicial;
    void handleFile(archivoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivoInicial]);

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



  const enumColumns = useMemo(
    () => (mapping ? mappedEnumColumns(mapping, campos) : []),
    [mapping, campos],
  );

  /**
   * Valores fijos que el vendedor escribió a mano y que el backend no aceptaría. Bloquean
   * igual que un obligatorio sin asignar: el valor se copia en cada fila, así que un error
   * acá no rompe una fila, rompe el archivo entero.
   */
  const defaultsInvalidos = useMemo(
    () => (mapping
      ? campos
        .map((c) => ({ campo: c, error: validarValorFijo(c.key, mapping.defaults?.[c.key] ?? '', c.label) }))
        .filter((x): x is { campo: CampoMeta; error: string } => !!x.error)
      : []),
    [mapping, campos],
  );

  /**
   * Revisión del archivo ya transformado. Se calcula sólo en el paso 3 porque transforma
   * todas las filas, y en los pasos anteriores no se muestra.
   */
  const { revision, cambios, separacion } = useMemo(() => {
    if (paso !== 3 || !mapping) return { revision: null, cambios: [], separacion: null };
    const { aoa, cambios: hechos } = buildOfficialAoADetallado(
      userRows, userCols, mapping, campos, esquema.catalogos,
    );
    // Con el SKU repetido, lo que se revisa es el archivo ya agrupado: es el que se sube.
    // Separar una celda con varios vehículos también genera códigos repetidos, así que
    // pasa por lo mismo: si no, el backend los rechazaría como duplicados.
    const separada = mapping.agruparPorSku || mapping.separarAplicaciones
      ? separarPorSku(aoa)
      : null;
    const paraRevisar = separada ? separada.inventario : aoa;
    return {
      separacion: separada,
      revision: revisarAoA(paraRevisar, campos, {
        maxFilas: 20,
        primeraFilaArchivo: filaEncabezados + 2,
        catalogos: esquema.catalogos,
      }),
      cambios: hechos,
    };
  }, [paso, mapping, userRows, userCols, campos, filaEncabezados, esquema]);

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

  /** El catálogo real que le corresponde a una columna, o vacío si no tiene. */
  const catalogoDe = useMemo(() => {
    const subcategorias = todasLasSubcategorias(esquema.catalogos.subcategoriasPorCategoria);
    return (key: string): string[] => {
      if (key === 'categoria') return esquema.catalogos.categorias;
      if (key === 'marca_repuesto') return esquema.catalogos.marcasRepuesto;
      if (key === 'subcategoria') return subcategorias;
      return [];
    };
  }, [esquema]);

  /**
   * Los valores del vendedor que no están en el catálogo, por columna y ordenados por
   * frecuencia: arreglar el que aparece en 43 filas vale 43 veces más que el de una sola.
   * El cálculo es pesado, así que depende de qué columna se mapeó y no del mapeo entero.
   */
  const bloquesCatalogo = useMemo(() => {
    if (paso !== 3 || !mapping) return [];
    return ['categoria', 'subcategoria', 'marca_repuesto']
      .map((key) => {
        const campo = campos.find((c) => c.key === key);
        const id = mapping.oficial[key];
        const col = id ? userCols.find((c) => c.id === id) : undefined;
        const catalogo = catalogoDe(key);
        if (!campo || !col || catalogo.length === 0) return null;
        const decisiones = decisionesDeCatalogo(contarValoresDeColumna(userRows, col.index), catalogo);
        return decisiones.length ? { campo, columna: col, catalogo, decisiones } : null;
      })
      .filter((b): b is { campo: CampoMeta; columna: UserColumn; catalogo: string[]; decisiones: DecisionCatalogo[] } => !!b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, userRows, userCols, campos, catalogoDe,
    mapping?.oficial.categoria, mapping?.oficial.subcategoria, mapping?.oficial.marca_repuesto]);

  /** Cuántas decisiones de catálogo siguen sin responder. */
  const pendientesCatalogo = useMemo(() => bloquesCatalogo.reduce(
    (total, b) => total + b.decisiones.filter((d) => !mapping?.valueMap[b.campo.key]?.[d.valor]).length,
    0,
  ), [bloquesCatalogo, mapping]);

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

  /** Aplica de una vez la mejor sugerencia de cada decisión que siga sin responder. */
  const aceptarSugerencias = () => {
    setMapping((prev) => {
      if (!prev) return prev;
      const valueMap = { ...prev.valueMap };
      for (const bloque of bloquesCatalogo) {
        const tabla = { ...(valueMap[bloque.campo.key] ?? {}) };
        for (const d of bloque.decisiones) {
          if (!tabla[d.valor] && d.sugerencias[0]) tabla[d.valor] = d.sugerencias[0];
        }
        valueMap[bloque.campo.key] = tabla;
      }
      return { ...prev, valueMap };
    });
  };

  /** ¿El archivo repite el mismo código una vez por vehículo? */
  const skusRepetidos = useMemo(() => {
    const id = mapping?.oficial.sku_proveedor;
    const col = id ? userCols.find((c) => c.id === id) : undefined;
    return col ? detectarSkusRepetidos(userRows, col.index) : null;
  }, [mapping, userCols, userRows]);

  /** ¿La columna de compatibilidad trae marca, modelo y años escritos de corrido? */
  const columnaAplicacion = useMemo(
    () => (mapping ? buscarColumnaAplicacion(mapping, userCols, userRows, esquema.catalogos.marcasVehiculo) : null),
    [mapping, userCols, userRows, esquema],
  );

  /** ¿Alguna columna sin asignar trae la foto de cada repuesto? */
  const columnaFotos = useMemo(() => {
    if (!mapping) return null;
    const elegida = mapping.columnaFotos ? userCols.find((c) => c.id === mapping.columnaFotos) : null;
    const asignadas = new Set(Object.values(mapping.oficial).filter(Boolean) as string[]);
    const candidatas = elegida ? [elegida] : userCols.filter((c) => !asignadas.has(c.id));
    for (const col of candidatas) {
      const muestra = userRows.slice(0, 50).map((r) => String((r as unknown[])[col.index] ?? '')).filter(Boolean);
      const tipo: TipoColumnaFotos = tipoColumnaFotos(muestra);
      if (tipo) return { col, tipo, ejemplo: muestra.find((v) => v.trim()) ?? '' };
    }
    return null;
  }, [mapping, userCols, userRows]);

  /**
   * ¿Más abajo empieza otra tabla? No hay interruptor: la segunda tabla tiene otras
   * columnas y no se puede leer con los títulos de arriba. Lo único que corresponde es
   * avisarlo antes de que el vendedor recorra el asistente con medio archivo mal leído.
   */
  const segundaTabla = useMemo(() => {
    const encabezado: string[] = [];
    for (const col of userCols) encabezado[col.index] = col.rawHeader;
    return detectarSegundaTabla(userRows, encabezado);
  }, [userCols, userRows]);

  /** ¿La hoja agrupa los repuestos con una fila de título en vez de una columna? */
  const bandas = useMemo(() => {
    if (!mapping || mapping.oficial.categoria) return null;
    const encontradas = detectarBandas(userRows, userCols.length);
    if (encontradas.length === 0) return null;
    // Una fila de una sola celda puede ser cualquier cosa: "PROVEEDOR: MONROE" también lo
    // es, y no es una categoría. Se ofrece sólo si los títulos son categorías de verdad,
    // contra el catálogo; si no, esto no es una lista agrupada por familia.
    const enCatalogo = encontradas.filter(
      (b) => buscarEnCatalogo(b.titulo, esquema.catalogos.categorias),
    );
    if (enCatalogo.length === 0 || enCatalogo.length * 2 < encontradas.length) return null;
    return { total: encontradas.length, titulos: encontradas.map((b) => b.titulo) };
  }, [mapping, userCols, userRows, esquema]);

  /** ¿La hoja trae subtotales, totales o el encabezado repetido entre los repuestos? */
  const filasDeTotales = useMemo(() => {
    if (!mapping) return null;
    const fuera = filasNoRepuesto(userRows, userCols, mapping);
    if (fuera.length === 0) return null;
    return {
      total: fuera.length,
      totales: fuera.filter((f) => f.motivo === 'totales').length,
      encabezados: fuera.filter((f) => f.motivo === 'encabezado').length,
      ejemplo: fuera[0].texto,
    };
  }, [mapping, userCols, userRows]);

  /**
   * ¿El nombre del repuesto trae escrita la marca o la categoría? Es la salida de la
   * lista de dos columnas —código y descripción— donde esos datos existen pero no tienen
   * columna propia.
   */
  const datosEnElNombre = useMemo(() => {
    const id = mapping?.oficial.nombre_publicado;
    const col = id ? userCols.find((c) => c.id === id) : null;
    if (!col) return null;
    const faltaMarca = !mapping?.oficial.marca_repuesto;
    const faltaCategoria = !mapping?.oficial.categoria;
    if (!faltaMarca && !faltaCategoria) return null;

    const { marcasRepuesto, categorias, marcasVehiculo } = esquema.catalogos;
    let conMarca = 0;
    let conCategoria = 0;
    let ejemplo: { texto: string; marca: string | null; categoria: string | null } | null = null;
    const muestra = userRows.slice(0, 50).map((r) => String((r as unknown[])[col.index] ?? ''));
    for (const texto of muestra) {
      if (!texto.trim()) continue;
      const marca = faltaMarca ? buscarEnTexto(texto, marcasRepuesto, marcasVehiculo) : null;
      const categoria = faltaCategoria ? buscarEnTexto(texto, categorias) : null;
      if (marca) conMarca += 1;
      if (categoria) conCategoria += 1;
      if (!ejemplo && (marca || categoria)) ejemplo = { texto, marca, categoria };
    }
    if (conMarca === 0 && conCategoria === 0) return null;
    return { col, conMarca, conCategoria, faltaMarca, faltaCategoria, filas: muestra.length, ejemplo };
  }, [mapping, userCols, userRows, esquema]);

  /** ¿La columna de compatibilidad mete varios vehículos en una misma celda? */
  const aplicacionesMultiples = useMemo(() => {
    const id = mapping?.oficial.compatibilidad_modelo ?? mapping?.oficial.compatibilidad_marca;
    const col = id ? userCols.find((c) => c.id === id) : null;
    if (!col) return null;
    const muestra = userRows.slice(0, 50).map((r) => String((r as unknown[])[col.index] ?? ''));
    const hallazgo = detectarAplicacionesMultiples(muestra, esquema.catalogos.marcasVehiculo);
    return hallazgo.celdas > 0 ? { col, ...hallazgo } : null;
  }, [mapping, userCols, userRows, esquema]);

  const setColumnaFotos = (id: string | null) => {
    setMapping((prev) => {
      if (!prev) return prev;
      const extras = { ...prev.extras };
      // Si se usa para fotos, deja de sumarse a la descripción: sería el mismo dato dos veces.
      if (id) extras[id] = 'ignore';
      return { ...prev, columnaFotos: id, extras };
    });
  };

  const setBandera = (
    clave: 'parsearAplicacion' | 'agruparPorSku' | 'dividirAnios' | 'separarAplicaciones'
      | 'deducirDelNombre' | 'quitarFilasDeTotales' | 'usarBandasComoCategoria',
    valor: boolean,
  ) => {
    setMapping((prev) => (prev ? { ...prev, [clave]: valor } : prev));
  };

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

  /** Detecta si un campo se completará automáticamente por un interruptor (ej. rangos de años o aplicación) */
  const getAutoDerivado = useCallback((key: string): {
    activo: boolean;
    descripcion: string;
    ejemplo?: string;
    /** Resuelve algunas filas, no todas: el valor fijo sigue haciendo falta para el resto. */
    parcial?: boolean;
  } => {
    if (!mapping) return { activo: false, descripcion: '' };

    // Categoría sacada de las filas de título que agrupan la lista.
    if (key === 'categoria' && mapping.usarBandasComoCategoria && bandas) {
      return {
        activo: true,
        descripcion: `Se toma de las ${bandas.total} filas de título que agrupan tu lista`,
        ejemplo: bandas.titulos[0],
        parcial: true,
      };
    }

    // Marca y categoría sacadas del nombre del repuesto.
    if (mapping.deducirDelNombre && datosEnElNombre) {
      if (key === 'marca_repuesto' && datosEnElNombre.conMarca > 0) {
        return {
          activo: true,
          descripcion: `Se saca del nombre del repuesto, en ${datosEnElNombre.conMarca} de las primeras ${datosEnElNombre.filas} filas`,
          ejemplo: datosEnElNombre.ejemplo?.marca ?? undefined,
          parcial: true,
        };
      }
      if (key === 'categoria' && datosEnElNombre.conCategoria > 0) {
        return {
          activo: true,
          descripcion: `Se saca del nombre del repuesto, en ${datosEnElNombre.conCategoria} de las primeras ${datosEnElNombre.filas} filas`,
          ejemplo: datosEnElNombre.ejemplo?.categoria ?? undefined,
          parcial: true,
        };
      }
    }

    // Año hasta derivado por división de rango en año_desde
    if (key === 'anio_hasta') {
      if (mapping.dividirAnios && mapping.oficial.anio_desde) {
        const col = userCols.find((c) => c.id === mapping.oficial.anio_desde);
        let ejHasta = '';
        if (col) {
          for (const r of userRows.slice(0, 30)) {
            const p = partirRangoAnios(String((r as unknown[])[col.index] ?? ''));
            if (p?.hasta) { ejHasta = p.hasta; break; }
          }
        }
        return {
          activo: true,
          descripcion: `Se completa automáticamente dividiendo el rango de tu columna "${col?.displayHeader ?? 'años'}"`,
          ejemplo: ejHasta ? `ej: ${ejHasta}` : undefined,
        };
      }
      if (mapping.parsearAplicacion && columnaAplicacion?.partes?.anioHasta) {
        return {
          activo: true,
          descripcion: `Se completa automáticamente extrayendo el año de tu columna "${columnaAplicacion.col.displayHeader}"`,
          ejemplo: `ej: ${columnaAplicacion.partes.anioHasta}`,
        };
      }
    }

    // Año desde derivado de columna aplicación
    if (key === 'anio_desde' && !mapping.oficial.anio_desde) {
      if (mapping.parsearAplicacion && columnaAplicacion?.partes?.anioDesde) {
        return {
          activo: true,
          descripcion: `Se completa automáticamente extrayendo el año de tu columna "${columnaAplicacion.col.displayHeader}"`,
          ejemplo: `ej: ${columnaAplicacion.partes.anioDesde}`,
        };
      }
    }

    // Marca del vehículo derivada de columna aplicación
    if (key === 'compatibilidad_marca' && !mapping.oficial.compatibilidad_marca) {
      if (mapping.parsearAplicacion && columnaAplicacion?.partes?.marca) {
        return {
          activo: true,
          descripcion: `Se completa automáticamente extrayendo la marca de tu columna "${columnaAplicacion.col.displayHeader}"`,
          ejemplo: `ej: ${columnaAplicacion.partes.marca}`,
        };
      }
    }

    // Modelo del vehículo derivado de columna aplicación
    if (key === 'compatibilidad_modelo' && !mapping.oficial.compatibilidad_modelo) {
      if (mapping.parsearAplicacion && columnaAplicacion?.partes?.modelo) {
        return {
          activo: true,
          descripcion: `Se completa automáticamente extrayendo el modelo de tu columna "${columnaAplicacion.col.displayHeader}"`,
          ejemplo: `ej: ${columnaAplicacion.partes.modelo}`,
        };
      }
    }

    return { activo: false, descripcion: '' };
  }, [mapping, userCols, userRows, columnaAplicacion, datosEnElNombre, bandas]);

  const counts = useMemo(() => {
    if (!mapping) return { asignadas: 0, sinAsignar: 0, aDescripcion: 0, ignoradas: 0 };
    const asignadas = campos.filter((c) => {
      if (mapping.oficial[c.key]) return true;
      if ((mapping.defaults?.[c.key] ?? '').trim()) return true;
      if (getAutoDerivado(c.key).activo) return true;
      return false;
    }).length;
    const ignoradas = unassignedCols.filter((c) => mapping.extras[c.id] === 'ignore').length;
    return {
      asignadas,
      sinAsignar: unassignedCols.length,
      aDescripcion: unassignedCols.length - ignoradas,
      ignoradas,
    };
  }, [mapping, unassignedCols, campos, getAutoDerivado]);

  const requiereValor = useCallback(
    (campo: CampoMeta): boolean => (mapping ? requiereValorEnPanel(campo, mapping) : campo.required),
    [mapping],
  );

  /**
   * Obligatorios que siguen sin resolver. Un valor fijo para todas las filas o una
   * derivación automática cuenta como resuelto.
   */
  const missingRequired = useMemo(
    () => (mapping
      ? campos.filter((c) => {
        if (!requiereValor(c)) return false;
        if (mapping.oficial[c.key]) return false;
        if ((mapping.defaults?.[c.key] ?? '').trim()) return false;
        if (getAutoDerivado(c.key).activo) return false;
        return true;
      })
      : []),
    [mapping, campos, getAutoDerivado, requiereValor],
  );

  const buildFile = async (): Promise<File> => {
    const aoa = buildOfficialAoA(
      userRows, userCols, mapping as Mapping, campos, esquema.catalogos,
    );
    const nombre = `plantilla-adaptada_${getIsoTimestampString()}.xlsx`;
    if (!mapping?.agruparPorSku && !mapping?.separarAplicaciones) {
      return buildOfficialXlsxFile(aoa, nombre, esquema.version);
    }
    const { inventario, compatibilidades } = separarPorSku(aoa);
    return buildOfficialXlsxFile(inventario, nombre, esquema.version, compatibilidades);
  };

  /**
   * Fotos declaradas por SKU. Se calculan sobre las filas del vendedor, con su columna de
   * SKU: son el insumo del paso de fotos, no del archivo oficial.
   */
  const fotosDeclaradas = useMemo(() => {
    if (!mapping?.columnaFotos || !columnaFotos) return null;
    const idSku = mapping.oficial.sku_proveedor;
    const colSku = idSku ? userCols.find((c) => c.id === idSku) : undefined;
    if (!colSku) return null;
    const mapa = fotosPorSku(userRows, columnaFotos.col.index, colSku.index);
    return Object.keys(mapa).length > 0 ? mapa : null;
  }, [mapping, columnaFotos, userCols, userRows]);

  const handleGenerate = () => {
    if (!mapping) return;
    setGenerating(true);
    // Deja pintar el spinner antes de un build potencialmente pesado.
    setTimeout(async () => {
      try {
        const file = await buildFile();
        const firma = headerSignature(userCols);
        saveMapping(firma, mapping);
        onGuardarMapeo?.(firma, mapping, userFile?.name);
        onGenerated(file, {
          fotos: fotosDeclaradas ?? undefined,
          // El archivo del vendedor viaja de vuelta para poder volver a relacionar sin
          // pedirle que lo suba de nuevo.
          archivoOriginal: userFile ?? undefined,
        });
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
    // Cuántas conversiones automáticas encontramos mirando el archivo. El interruptor de
    // inventario universal no cuenta: eso lo declara el vendedor, no lo detectamos nosotros.
    const ajustesDetectados = [
      Boolean(skusRepetidos && skusRepetidos.skus > 0),
      Boolean(columnaAplicacion),
      Boolean(aplicacionesMultiples),
      Boolean(datosEnElNombre),
      Boolean(filasDeTotales),
      Boolean(bandas),
      Boolean(columnaFotos),
      Boolean(columnaAniosConRangos),
    ].filter(Boolean).length;

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
        {segundaTabla && (
          <div className="mapper-alert warn">
            <AlertTriangle size={15} />
            <span>
              Parece que tu hoja tiene <b>más de una tabla</b>: más abajo empiezan otros
              títulos ({segundaTabla.titulos.slice(0, 4).join(', ')}). Sólo vamos a leer la
              primera; lo de abajo va a salir mal porque no tiene las mismas columnas.
              Conviene dejar cada tabla en su propia hoja y subirlas de a una.
            </span>
          </div>
        )}
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

        {defaultsInvalidos.length > 0 && (
          <div className="mapper-alert warn">
            <AlertTriangle size={15} />
            <span>
              Revisa lo que escribiste a mano: {defaultsInvalidos.map((d) => d.error).join(' ')}
            </span>
          </div>
        )}

        {missingRequired.length > 0 && (
          <div className="mapper-alert warn">
            <AlertTriangle size={15} />
            <span>
              Todavía falta indicar: <b>{missingRequired.map((c) => c.label).join(', ')}</b>. Son
              datos que RepuesTop necesita para publicar. Elige la columna de tu archivo, o escribe
              al lado el mismo valor para todas las filas.
              {missingRequired.some((c) => c.key === 'precio') && (
                <> Si tus repuestos se venden a pedido, pon <b>SOLO_COTIZAR</b> en "Tipo de precio"
                  y el precio deja de hacer falta.</>
              )}
            </span>
          </div>
        )}

        {/*
          * Los ajustes automaticos van juntos y con titulo: sueltos, el vendedor no
          * sabe de donde salieron ni que ya vienen decididos por el.
          */}
        <section className="mapper-section-group">
          <div className="mapper-section-header">
            <div className="mapper-section-title-wrap">
              <h5>Lo que detectamos en tu archivo</h5>
              {ajustesDetectados > 0 && (
                <span className="mapper-section-badge">
                  {plural(ajustesDetectados, "ajuste", "ajustes")}
                </span>
              )}
            </div>
            <p className="mapper-section-desc">
              Miramos tus datos y encontramos estas cosas que podemos arreglar por ti. Marca las
              que correspondan a tu inventario; si no marcas nada, tus datos van tal como están.
            </p>
          </div>
          {skusRepetidos && skusRepetidos.skus > 0 && (
            <label className="mapper-switch">
              <input
                type="checkbox"
                aria-label="Juntar las filas repetidas del mismo código"
                checked={mapping.agruparPorSku ?? false}
                onChange={(e) => setBandera('agruparPorSku', e.target.checked)}
              />
              <span>
                <b>Tu archivo repite el mismo código en varias filas</b>
                {skusRepetidos.ejemplo ? ` (${skusRepetidos.ejemplo.sku} aparece ${skusRepetidos.ejemplo.veces} veces)` : ''}.
                Si es porque el mismo repuesto sirve para varios autos, lo publicamos como{' '}
                <b>un repuesto con varias compatibilidades</b> en vez de {plural(skusRepetidos.filasExtra + skusRepetidos.skus, 'repuesto repetido', 'repuestos repetidos')}.
              </span>
            </label>
          )}

          {columnaAplicacion && (
            <label className="mapper-switch">
              <input
                type="checkbox"
                aria-label="Separar marca, modelo y años de la columna de compatibilidad"
                checked={mapping.parsearAplicacion ?? false}
                onChange={(e) => {
                  // Si la columna todavía no estaba asignada a nada, activarlo también la
                  // pone donde corresponde: no tiene sentido pedir dos gestos para una idea.
                  if (e.target.checked && columnaAplicacion.necesitaAsignar) {
                    setOficial('compatibilidad_modelo', columnaAplicacion.col.id);
                  }
                  setBandera('parsearAplicacion', e.target.checked);
                }}
              />
              <span>
                <b>Tu columna "{columnaAplicacion.col.displayHeader}" trae la marca, el modelo y los años juntos.</b>{' '}
                Los separamos por ti
                {columnaAplicacion.partes
                  ? `: "${columnaAplicacion.ejemplo}" queda como ${columnaAplicacion.partes.marca} · ${columnaAplicacion.partes.modelo}`
                    + `${columnaAplicacion.partes.anioDesde ? ` · ${columnaAplicacion.partes.anioDesde}${columnaAplicacion.partes.anioHasta ? `-${columnaAplicacion.partes.anioHasta}` : ''}` : ''}`
                  : ''}
                . Así el repuesto aparece cuando alguien busca por su auto.
              </span>
            </label>
          )}

          {bandas && (
            <label className="mapper-switch">
              <input
                type="checkbox"
                aria-label="Usar las filas de titulo como categoria"
                checked={mapping.usarBandasComoCategoria ?? false}
                onChange={(e) => setBandera('usarBandasComoCategoria', e.target.checked)}
              />
              <span>
                <b>Tu lista agrupa los repuestos con filas de título</b>{' '}
                ({bandas.titulos.slice(0, 3).join(', ')}
                {bandas.total > 3 ? ' y ' + (bandas.total - 3) + ' más' : ''}), y no tiene
                columna de categoría. Usamos cada título como la categoría de los repuestos
                que vienen debajo, y la fila del título no se publica.
              </span>
            </label>
          )}

          {filasDeTotales && (
            <label className="mapper-switch">
              <input
                type="checkbox"
                aria-label="Dejar fuera las filas que no son repuestos"
                checked={mapping.quitarFilasDeTotales ?? false}
                onChange={(e) => setBandera('quitarFilasDeTotales', e.target.checked)}
              />
              <span>
                <b>
                  Tu lista trae {plural(filasDeTotales.total, 'fila que no es un repuesto', 'filas que no son repuestos')}
                </b>
                {filasDeTotales.totales > 0 && filasDeTotales.encabezados > 0
                  ? ' (subtotales y los títulos repetidos a mitad de tabla)'
                  : filasDeTotales.totales > 0 ? ' (subtotales o totales)' : ' (los títulos repetidos a mitad de tabla)'}
                {filasDeTotales.ejemplo ? `, como "${filasDeTotales.ejemplo.slice(0, 45)}"` : ''}
                . Las dejamos fuera para que no aparezcan como repuestos con problemas.
              </span>
            </label>
          )}

          {datosEnElNombre && (
            <label className="mapper-switch">
              <input
                type="checkbox"
                aria-label="Sacar la marca y la categoria del nombre del repuesto"
                checked={mapping.deducirDelNombre ?? false}
                onChange={(e) => setBandera('deducirDelNombre', e.target.checked)}
              />
              <span>
                <b>Tu archivo no trae columna de {[
                  datosEnElNombre.faltaMarca && datosEnElNombre.conMarca > 0 ? 'marca' : '',
                  datosEnElNombre.faltaCategoria && datosEnElNombre.conCategoria > 0 ? 'categoría' : '',
                ].filter(Boolean).join(' ni de ')}, pero el nombre del repuesto lo dice.</b>{' '}
                Lo sacamos de ahí, fila por fila
                {datosEnElNombre.ejemplo
                  ? `: "${datosEnElNombre.ejemplo.texto.slice(0, 55)}" queda como ${[datosEnElNombre.ejemplo.marca, datosEnElNombre.ejemplo.categoria].filter(Boolean).join(' · ')}`
                  : ''}
                . Lo que no reconozcamos queda vacío y lo puedes completar con un valor común.
              </span>
            </label>
          )}

          {aplicacionesMultiples && (
            <label className="mapper-switch">
              <input
                type="checkbox"
                aria-label="Separar los varios autos que vienen en una misma celda"
                checked={mapping.separarAplicaciones ?? false}
                onChange={(e) => setBandera('separarAplicaciones', e.target.checked)}
              />
              <span>
                <b>Tu columna "{aplicacionesMultiples.col.displayHeader}" trae varios autos en la misma celda.</b>{' '}
                Publicamos un repuesto con sus {aplicacionesMultiples.vehiculos} compatibilidades en vez de
                uno con un modelo que no existe
                {aplicacionesMultiples.ejemplo
                  ? `: "${aplicacionesMultiples.ejemplo.texto}" son ${aplicacionesMultiples.ejemplo.vehiculos.length} autos`
                  : ''}
                . Sin esto el repuesto no aparece cuando alguien busca por su auto.
              </span>
            </label>
          )}

          {columnaFotos && (
            <label className="mapper-switch">
              <input
                type="checkbox"
                aria-label="Usar la columna de fotos de mi Excel"
                checked={!!mapping.columnaFotos}
                onChange={(e) => setColumnaFotos(e.target.checked ? columnaFotos.col.id : null)}
              />
              <span>
                <b>Tu columna "{columnaFotos.col.displayHeader}" trae las fotos</b>
                {columnaFotos.tipo === 'url'
                  ? ' como enlaces de internet. Las traemos por ti después de publicar'
                  : ' como nombres de archivo. Las buscamos en la carpeta de fotos que subas después'}
                {columnaFotos.ejemplo ? ` (${columnaFotos.ejemplo.slice(0, 60)})` : ''}.
              </span>
            </label>
          )}

          <label className="mapper-switch">
            <input
              type="checkbox"
              aria-label="Todo mi inventario es universal"
              checked={(mapping.defaults?.compatibilidad_general ?? '') === 'SI'}
              onChange={(e) => setDefault('compatibilidad_general', e.target.checked ? 'SI' : '')}
            />
            <span>
              <b>Todo mi inventario es universal.</b> Marca esto sólo si tus repuestos sirven para
              cualquier vehículo; se publican sin compatibilidad por auto.
            </span>
          </label>

          {columnaAniosConRangos && (
            <label className="mapper-switch">
              <input
                type="checkbox"
                aria-label="Separar el rango de años en año desde y año hasta"
                checked={mapping.dividirAnios ?? false}
                onChange={(e) => setDividirAnios(e.target.checked)}
              />
              <span>
                <b>Tu columna de años trae rangos en una sola celda.</b> Los separamos en "año desde"
                y "año hasta" por ti{ejemploRangoAnios ? `: ${ejemploRangoAnios}` : ''}.
              </span>
            </label>
          )}
          {ajustesDetectados === 0 && (
            <p className="mapper-empty">
              No encontramos nada más que convertir: tus columnas ya vienen como las espera
              RepuesTop.
            </p>
          )}
        </section>

        {/* Guía visual explicativa */}
        <div className="mapper-guide-box">
          <div className="mapper-guide-header">
            <h4>¿Cómo relacionar tus columnas con las de RepuesTop?</h4>
          </div>
          <p>
            A la <strong>izquierda</strong> ves el dato que pide RepuesTop y su significado. A la{' '}
            <strong>derecha</strong> eliges cuál columna de tu archivo contiene ese dato. Debajo de cada selector
            aparece un <strong>ejemplo real de tu archivo</strong> para que verifiques que coincida.
          </p>
          <div className="mapper-guide-columns-legend">
            <span className="legend-item repuestop">
              <strong>1. Dato en RepuesTop</strong> (Destino)
            </span>
            <span className="legend-arrow">se completa con</span>
            <span className="legend-item excel">
              <strong>2. Tu Columna de Excel</strong> (Origen)
            </span>
          </div>
        </div>

        {/* Grupos de campos por sección */}
        {SECCIONES_MAPPER.map((sec) => {
          const camposGrupo = campos.filter((c) => (c.seccion ?? 'opcionales') === sec.id);
          if (camposGrupo.length === 0) return null;
          const asignadosCount = camposGrupo.filter(
            (c) => Boolean(mapping.oficial[c.key] || mapping.defaults?.[c.key] || getAutoDerivado(c.key).activo)
          ).length;

          return (
            <section className="mapper-section-group" key={sec.id}>
              <div className="mapper-section-header">
                <div className="mapper-section-title-wrap">
                  <h5>{sec.titulo}</h5>
                  <span className="mapper-section-badge">
                    {asignadosCount}/{camposGrupo.length} asignados
                  </span>
                </div>
                <p className="mapper-section-desc">{sec.descripcion}</p>
              </div>

              <div className="mapper-rows">
                {camposGrupo.map((campo) => {
                  const value = mapping.oficial[campo.key] ?? '';
                  const uses = value ? usageCount.get(value) ?? 0 : 0;
                  const colElegida = value ? userCols.find((c) => c.id === value) : undefined;
                  const ejemploExcel = colElegida ? sampleValue(colElegida) : '';
                  const tieneDefault = Boolean(mapping.defaults?.[campo.key]);
                  const autoDerivado = getAutoDerivado(campo.key);
                  const esAuto = autoDerivado.activo && !value && !tieneDefault;
                  const listo = Boolean(value || tieneDefault || esAuto);
                  const obligatorio = requiereValor(campo);
                  const faltante = obligatorio && !listo;

                  return (
                    <div
                      className={`mapper-card-row mapper-row ${faltante ? 'falta' : ''} ${listo ? 'listo' : ''}`}
                      key={campo.key}
                    >
                      {/* Lado izquierdo: Dato RepuesTop */}
                      <div className="mapper-card-dest">
                        <div className="mapper-card-header-line mapper-row-label">
                          <span className="mapper-card-title">
                            {campo.label}
                            {obligatorio && <b className="req">*</b>}
                          </span>
                          {obligatorio ? (
                            <span className="mapper-pill mapper-pill-req">Requerido</span>
                          ) : (
                            <span className="mapper-pill mapper-pill-opt">Opcional</span>
                          )}
                          {listo && (
                            <span
                              className="mapper-pill mapper-pill-done"
                              title={esAuto ? autoDerivado.descripcion : 'Dato completado'}
                            >
                              {esAuto ? 'Automático' : 'Listo'}
                            </span>
                          )}
                          {uses > 1 && (
                            <span className="mapper-enum-chip alt">
                              columna usada {uses} veces
                            </span>
                          )}
                        </div>

                        {campo.descripcion && (
                          <p className="mapper-card-desc">{campo.descripcion}</p>
                        )}

                        {campo.ejemplo && (
                          <div className="mapper-card-hint">
                            <span className="mapper-hint-tag">{campo.ejemplo}</span>
                          </div>
                        )}

                        {campo.enumHint && !campo.ejemplo && (
                          <div className="mapper-card-hint">
                            <span className="mapper-hint-label">Valores válidos:</span>{' '}
                            <span className="mapper-hint-values">{campo.enumHint.join(' · ')}</span>
                          </div>
                        )}
                      </div>

                      {/* Conector central */}
                      <div className="mapper-card-connector" aria-hidden>
                        <span className="mapper-connector-badge">se toma de</span>
                      </div>

                      {/* Lado derecho: Selector de columna del Excel */}
                      <div className="mapper-card-origin mapper-row-control">
                        {esAuto && (
                          <div className="mapper-auto-info">
                            <span className="mapper-auto-desc">
                              {autoDerivado.descripcion} {autoDerivado.ejemplo ? `(${autoDerivado.ejemplo})` : ''}
                            </span>
                          </div>
                        )}

                        <label className="mapper-origin-label" htmlFor={`select-col-${campo.key}`}>
                          {esAuto ? 'O asigna una columna propia si la tienes:' : 'Columna en tu archivo Excel:'}
                        </label>
                        <select
                          id={`select-col-${campo.key}`}
                          className="form-control mapper-select-main"
                          value={value}
                          aria-label={campo.label}
                          onChange={(e) => setOficial(campo.key, e.target.value)}
                        >
                          <option value="">
                            {esAuto ? '— Se completará automáticamente desde tu columna —' : '— no tengo esta columna —'}
                          </option>
                          {userCols.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.displayHeader}
                            </option>
                          ))}
                        </select>

                        {/* Vista previa con dato real de la fila 1 */}
                        {colElegida && (
                          <div className="mapper-preview-pill">
                            <span className="mapper-preview-label">Ejemplo en tu archivo:</span>
                            {ejemploExcel ? (
                              <strong className="mapper-preview-text">"{ejemploExcel}"</strong>
                            ) : (
                              <span className="mapper-preview-empty">(celda vacía en las primeras filas)</span>
                            )}
                          </div>
                        )}

                        {/* Sin columna y sin derivación completa: valor fijo. Una
                            derivación parcial no lo reemplaza: las filas donde no
                            reconocimos nada se quedarían vacías y sin salida. */}
                        {!value && (!esAuto || autoDerivado.parcial) && (
                          <div className={`mapper-default-card ${faltante ? 'default-urgente' : ''}`}>
                            <span className="mapper-default-title">
                              {esAuto && autoDerivado.parcial ? (
                                <strong>Para las filas donde no lo encontremos, usa este valor:</strong>
                              ) : obligatorio ? (
                                <strong>Dato obligatorio: asigna un valor común para todas las filas:</strong>
                              ) : (
                                'O asigna el mismo valor fijo para todas las filas:'
                              )}
                            </span>
                            {campo.enumHint || catalogoDe(campo.key).length > 0 ? (
                              <select
                                className="form-control mapper-default-input"
                                value={mapping.defaults?.[campo.key] ?? ''}
                                aria-label={`Valor fijo para ${campo.label}`}
                                onChange={(e) => setDefault(campo.key, e.target.value)}
                              >
                                <option value="">o el mismo valor para todas las filas…</option>
                                {(campo.enumHint ?? catalogoDe(campo.key)).map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              (() => {
                                const limite = limiteDeColumna(campo.key);
                                const error = validarValorFijo(
                                  campo.key,
                                  mapping.defaults?.[campo.key] ?? '',
                                  campo.label,
                                );
                                return (
                                  <>
                                    <input
                                      className={`form-control mapper-default-input ${error ? 'con-error' : ''}`}
                                      type="text"
                                      // El tope es el de la columna real del backend: sin el,
                                      // un valor largo se corta recien en la base de datos y
                                      // el vendedor recibe un error incomprensible.
                                      maxLength={limite.maxLength}
                                      inputMode={limite.tipo === 'texto' ? undefined : 'numeric'}
                                      value={mapping.defaults?.[campo.key] ?? ''}
                                      placeholder={
                                        limite.tipo === 'anio' ? 'ej: 2014'
                                          : limite.tipo === 'numero' ? 'solo numeros'
                                            : 'o el mismo valor para todas las filas'
                                      }
                                      aria-label={`Valor fijo para ${campo.label}`}
                                      aria-invalid={error ? true : undefined}
                                      onChange={(e) => setDefault(campo.key, e.target.value)}
                                    />
                                    {error && <span className="mapper-campo-error">{error}</span>}
                                  </>
                                );
                              })()
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Campos extras si el backend agrega alguno que no esté en las 4 secciones */}
        {(() => {
          const secIds = new Set<string>(SECCIONES_MAPPER.map((s) => s.id));
          const otros = campos.filter((c) => c.seccion && !secIds.has(c.seccion));
          if (otros.length === 0) return null;
          return (
            <section className="mapper-section-group" key="otros">
              <div className="mapper-section-header">
                <div className="mapper-section-title-wrap">
                  <h5>Otros Datos</h5>
                </div>
              </div>
              <div className="mapper-rows">
                {otros.map((campo) => {
                  const value = mapping.oficial[campo.key] ?? '';
                  const colElegida = value ? userCols.find((c) => c.id === value) : undefined;
                  const ejemploExcel = colElegida ? sampleValue(colElegida) : '';
                  return (
                    <div className="mapper-card-row mapper-row" key={campo.key}>
                      <div className="mapper-card-dest">
                        <div className="mapper-card-header-line mapper-row-label">
                          <span className="mapper-card-title">{campo.label}</span>
                        </div>
                      </div>
                      <div className="mapper-card-origin mapper-row-control">
                        <select
                          className="form-control mapper-select-main"
                          value={value}
                          aria-label={campo.label}
                          onChange={(e) => setOficial(campo.key, e.target.value)}
                        >
                          <option value="">— no tengo esta columna —</option>
                          {userCols.map((c) => (
                            <option key={c.id} value={c.id}>{c.displayHeader}</option>
                          ))}
                        </select>
                        {colElegida && (
                          <div className="mapper-preview-pill">
                            <span className="mapper-preview-label">Ejemplo:</span>
                            <strong>"{ejemploExcel}"</strong>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* Columnas que te sobran */}
        <section className="mapper-section-group">
          <div className="mapper-section-header">
            <div className="mapper-section-title-wrap">
              <h5>Columnas de tu Excel sin asignar ({unassignedCols.length})</h5>
            </div>
            <p className="mapper-section-desc">
              Columnas de tu planilla que no corresponden a un dato directo de RepuesTop. Puedes sumarlas a la descripción o dejarlas fuera.
            </p>
          </div>
          {unassignedCols.length === 0 ? (
            <p className="mapper-empty">Todas las columnas de tu archivo están relacionadas con un dato de RepuesTop.</p>
          ) : (
            <div className="mapper-rows">
              {unassignedCols.map((c) => (
                <div className="mapper-card-row mapper-row" key={c.id}>
                  <div className="mapper-card-dest">
                    <div className="mapper-card-header-line mapper-row-label">
                      <span className="mapper-card-title">{c.displayHeader}</span>
                      <span className="mapper-pill mapper-pill-opt">Sin asignar</span>
                    </div>
                    {sampleValue(c) && (
                      <div className="mapper-preview-pill">
                        <span className="mapper-preview-label">Ejemplo en tu archivo:</span>
                        <strong className="mapper-preview-text">"{sampleValue(c)}"</strong>
                      </div>
                    )}
                  </div>
                  <div className="mapper-card-connector" aria-hidden>
                    <span className="mapper-connector-badge">va a</span>
                  </div>
                  <div className="mapper-card-origin mapper-row-control">
                    <label className="mapper-origin-label">¿Qué hacer con esta columna?</label>
                    <select
                      className="form-control mapper-select-main"
                      value={mapping.extras[c.id] ?? 'descripcion'}
                      aria-label={`Qué hacer con ${c.displayHeader}`}
                      onChange={(e) => setExtra(c.id, e.target.value as 'descripcion' | 'ignore')}
                    >
                      <option value="descripcion">Añadir a la descripción</option>
                      <option value="ignore">Dejar fuera</option>
                    </select>
                  </div>
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
            disabled={missingRequired.length > 0 || defaultsInvalidos.length > 0}
            title={
              missingRequired.length > 0 ? 'Falta indicar datos obligatorios'
                : defaultsInvalidos.length > 0 ? 'Hay un valor escrito a mano que hay que corregir'
                  : undefined
            }
          >
            Siguiente <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------- Paso 3: revisar ---------------------------- */
  const filasListas = userRows.length;
  /**
   * Filas de la hoja que se dejaron fuera por no ser repuestos. Sin este numero los
   * contadores no cuadran —"5 en tu archivo, 3 se pueden publicar" hace pensar que dos
   * fallaron— y el vendedor se queda buscando dos repuestos que nunca existieron.
   */
  const filasFuera = (mapping?.usarBandasComoCategoria && bandas ? bandas.total : 0)
    + (mapping?.quitarFilasDeTotales && filasDeTotales ? filasDeTotales.total : 0);

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

      {separacion && (
        <div className="mapper-alert info">
          <span>
            Juntamos las filas repetidas: <b>{plural(revision?.total ?? 0, 'repuesto', 'repuestos')}</b> con{' '}
            <b>{plural(separacion.compatibilidades.length - 1, 'compatibilidad extra', 'compatibilidades extra')}</b>.
            {separacion.advertencias.length > 0 ? ` ${separacion.advertencias.join(' ')}` : ''}
          </span>
        </div>
      )}

      <div className="mapper-counts">
        <span>
          <b>{filasListas.toLocaleString('es-CL')}</b>{' '}
          {separacion || filasFuera > 0 ? 'filas en tu archivo' : 'repuestos en tu archivo'}
        </span>
        {filasFuera > 0 && (
          <span><b>{filasFuera.toLocaleString('es-CL')}</b> no son repuestos, quedan fuera</span>
        )}
        <span className="ok"><b>{(revision?.publicables ?? 0).toLocaleString('es-CL')}</b> se pueden publicar</span>
        {(revision?.conError ?? 0) > 0 && (
          <span className="mal"><b>{revision?.conError.toLocaleString('es-CL')}</b> con problemas</span>
        )}
        {(revision?.conAviso ?? 0) > 0 && (
          <span className="ojo"><b>{revision?.conAviso.toLocaleString('es-CL')}</b> para mirar</span>
        )}
        {fotosDeclaradas && (
          <span><b>{Object.keys(fotosDeclaradas).length.toLocaleString('es-CL')}</b> con foto en tu Excel</span>
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
          <li>
            <b>Repuestos a preparar:</b> {(filasListas - filasFuera).toLocaleString('es-CL')}
            {filasFuera > 0
              ? ` (de ${filasListas.toLocaleString('es-CL')} filas; el resto son títulos o totales)`
              : ''}
          </li>
        </ul>
      </section>

      {/* Decisiones contra el catálogo real de RepuesTop */}
      {bloquesCatalogo.length > 0 && (
        <section className="mapper-section">
          <span className="bulk-purpose-label">
            Tus palabras y las de RepuesTop ({pendientesCatalogo} sin responder)
          </span>
          <p className="mapper-hint">
            Estos nombres no están en el catálogo de RepuesTop. Elige a cuál corresponde cada uno;
            empieza por los de arriba, que son los que aparecen en más repuestos.
          </p>
          {pendientesCatalogo > 0 && (
            <button type="button" className="btn btn-secondary mapper-btn mapper-btn-sugerencias" onClick={aceptarSugerencias}>
              <Wand2 size={16} /> Usar todas las sugerencias
            </button>
          )}
          {bloquesCatalogo.map((bloque) => (
            <div className="mapper-values-block" key={bloque.campo.key}>
              <div className="mapper-values-title">
                {bloque.campo.label} <span>← {bloque.columna.displayHeader}</span>
              </div>
              <div className="mapper-rows">
                {bloque.decisiones.map((d) => {
                  const elegido = mapping.valueMap[bloque.campo.key]?.[d.valor] ?? '';
                  return (
                    <div className={`mapper-row ${elegido ? 'resuelta' : ''}`} key={d.valor}>
                      <div className="mapper-row-label">
                        {elegido && <Check size={15} className="mapper-row-check" />}
                        <span>{d.valor}</span>
                        <span className="mapper-sample">{plural(d.filas, 'repuesto', 'repuestos')}</span>
                      </div>
                      <select
                        className="form-control"
                        value={elegido}
                        aria-label={`${bloque.campo.label}: ${d.valor}`}
                        onChange={(e) => setValue(bloque.campo.key, d.valor, e.target.value)}
                      >
                        <option value="">
                          {bloque.campo.key === 'categoria' ? 'dejar como está (no se va a publicar)' : 'dejar como está'}
                        </option>
                        {d.sugerencias.map((sug) => (
                          <option key={sug} value={sug}>{sug} — parecido</option>
                        ))}
                        {bloque.catalogo
                          .filter((c) => !d.sugerencias.includes(c))
                          .map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

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

/**
 * Etapa 3 · Completa. Todos los repuestos del archivo en una tabla tipo Excel, a lo ancho de la
 * pantalla (el menú lateral se oculta en esta etapa).
 *
 * - Las celdas AMARILLAS son datos que faltan por completar. Al completarlas pasan a blanco.
 * - Cada celda se corrige con un clic: una lista para los datos de catálogo, un campo para el resto.
 * - En el encabezado de una columna amarilla, "Completar todas" aplica un valor a todas las filas
 *   vacías de esa columna de una vez (o las deja vacías, si el dato es opcional).
 * - La columna "Fotos" asigna a cada repuesto las fotos que se subieron en la etapa 1.
 *
 * Para inventarios grandes la tabla se pagina y sólo la celda que se está editando monta su lista:
 * con miles de filas, un desplegable con el catálogo completo en cada celda congelaría el navegador.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Download, FolderOpen, ImagePlus, Info, Link2, Search, Sparkles,
  Undo2, Wand2, X,
} from 'lucide-react';
import { CeldaRevision } from '../CeldaRevision';
import {
  CAMPO_AGRUPADO_POR, etiquetaValor, requiereValorEnPanel,
  type CampoMeta, type CampoPorCompletar, type EsquemaPlantilla, type Mapping,
} from '../../utils/plantillaMapping';
import { validarValorFijo } from '../../utils/plantillaNormalizacion';
import {
  opcionesDeCelda, sugerenciasDeCelda, type ContextoDeFila,
} from '../../utils/miExcelDetecciones';
import { cierresAlCatalogo, modeloQueSigue,
  problemasDeFila, type FilaTabla, type ProblemaFila, type RevisionServidorFilas, type TablaMiExcel, type VersionesDe,
} from '../../utils/miExcelTabla';
import { COLUMNAS_DE_VERSION, type VersionCatalogo } from '../../utils/catalogoVersiones';
import { SelectVehiculo } from './SelectVehiculo';
import { MAX_IMAGES_PER_PRODUCT } from '../../utils/fotosCarga';
import { Miniatura, Modal } from './comunes';
import { plural } from './textos';
import { SelectorFotos } from './SelectorFotos';

type Filtro = 'todas' | 'faltan' | 'problemas' | 'sinfoto';
const TAMANOS = [50, 100, 200] as const;

export interface CambioMasivo {
  columna: string;
  descripcion: string;
  deshacer: () => void;
}

interface Props {
  tabla: TablaMiExcel;
  columnas: string[];
  campos: CampoMeta[];
  mapping: Mapping;
  esquema: EsquemaPlantilla;
  modelosDisponibles: Record<string, string[]>;
  porCompletar: CampoPorCompletar[];
  opcionalesVacios: string[];
  catalogoModelosCaido: boolean;
  onParche: (clave: string, columna: string, valor: string) => void;
  /** Varios datos de una fila a la vez ("todos los años del modelo" pone el desde y el hasta). */
  onParches: (clave: string, valores: Record<string, string>) => void;
  /** Versiones del catálogo por modelo: de ahí salen los años y motores que se pueden elegir. */
  versionesDe: VersionesDe;
  pedirVersiones: (marca: string, modelo: string) => void;
  /** "Todos los años del modelo" (o "hasta el último año") en todas las filas vacías de la columna. */
  onCompletarVehiculo: (columna: 'anio_desde' | 'anio_hasta') => void;
  onAplicarATodas: (columna: string, valor: string) => void;
  onDejarVacias: (columna: string) => void;
  onCompletarGrupo: (columna: string, grupo: string, valor: string) => void;
  cambioMasivo: CambioMasivo | null;
  onOlvidarCambioMasivo: () => void;

  imagenes: Record<string, Blob>;
  guardadas: Record<string, number>;
  asignaciones: Record<string, string[]>;
  onAsignarFotos: (clave: string, nombres: string[]) => void;
  onAutoAsignar: () => number;
  onAgregarFotos: () => void;
  /** Enlaces de fotos declarados en el Excel que se pueden traer, y cuántos. */
  enlacesPendientes: number;
  descargandoEnlaces: { hechas: number; total: number } | null;
  onTraerEnlaces: () => void;

  onAtras: () => void;
  onSiguiente: () => void;
  /** Fila a la que llevar al vendedor al entrar (el "Corregir" de la vista previa). */
  claveInicial?: string | null;
  /** La última revisión del servidor: sus objeciones también se marcan en el dato exacto. */
  servidor?: RevisionServidorFilas | null;
}

const etiquetaDe = (campos: CampoMeta[], key: string) => campos.find((c) => c.key === key)?.label ?? key;

/** Una celda que sólo monta su editor cuando el vendedor la toca. */
function Celda({
  valor, columna, amarilla, problema, mostrarMotivo, activa, onActivar, onCerrar, opciones, sugerencias, etiqueta, opcional, onCambio,
  vehiculo, onCambioVarios, destello,
}: {
  /** Año o motor: se elige sólo entre lo que el catálogo tiene para el modelo de la fila. */
  vehiculo?: { leer: (col: string) => string; versiones: VersionCatalogo[] | null | undefined; respaldo: string[] };
  onCambioVarios: (valores: Record<string, string>) => void;
  /** Recién se llegó a esta celda desde el aviso: parpadea para que se vea dónde está. */
  destello: boolean;
  valor: string; columna: string; amarilla: boolean; problema?: ProblemaFila;
  /** Escribe el motivo del problema dentro de la celda, no sólo al pasar el mouse. */
  mostrarMotivo: boolean;
  activa: boolean; onActivar: () => void; onCerrar: () => void; opciones: () => string[];
  sugerencias: (opciones: string[]) => string[]; etiqueta: string; opcional: boolean; onCambio: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activa) return;
    ref.current?.querySelector<HTMLElement>('select, input')?.focus();
  }, [activa]);

  const clase = `mx-celda ${amarilla ? 'amarilla' : ''} ${problema ? `con-${problema.severidad}` : ''}`;
  if (!activa) {
    return (
      <button
        type="button"
        className={`${clase} ${problema && mostrarMotivo ? 'con-motivo' : ''} ${destello ? 'mx-destello' : ''}`}
        onClick={onActivar}
        title={problema?.mensaje ?? `${etiqueta}. Haz clic para cambiarlo.`}
        aria-label={problema ? `${etiqueta}. Hay que corregirlo: ${problema.mensaje}` : etiqueta}
      >
        <span className="mx-celda-valor">
          {valor ? etiquetaValor(valor) : amarilla ? <span className="mx-celda-completar">Completar</span> : <span className="mx-celda-vacia">—</span>}
        </span>
        {problema && mostrarMotivo && (
          <span className={`mx-celda-motivo ${problema.severidad}`}><AlertTriangle size={12} /> {problema.mensaje}</span>
        )}
      </button>
    );
  }
  if (vehiculo) {
    return (
      <div
        ref={ref}
        className="mx-celda-editor"
        onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node | null)) setTimeout(onCerrar, 0); }}
        onKeyDown={(e) => { if (e.key === 'Escape') onCerrar(); }}
      >
        <SelectVehiculo
          columna={columna}
          valor={valor}
          etiqueta={etiqueta}
          leer={vehiculo.leer}
          versiones={vehiculo.versiones}
          respaldo={vehiculo.respaldo}
          onElegir={(valores) => { onCambioVarios(valores); onCerrar(); }}
        />
        {problema && <span className={`mx-celda-motivo ${problema.severidad}`}><AlertTriangle size={12} /> {problema.mensaje}</span>}
        <button type="button" className="mx-link" onMouseDown={(e) => e.preventDefault()} onClick={onCerrar}>Cerrar</button>
      </div>
    );
  }
  const lista = opciones();
  return (
    <div
      ref={ref}
      className="mx-celda-editor"
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node | null)) setTimeout(onCerrar, 0); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCerrar(); }}
    >
      <CeldaRevision
        valor={valor}
        columna={columna}
        opciones={lista}
        sugerencias={sugerencias(lista)}
        etiqueta={etiqueta}
        destacada
        onCambio={(v) => { onCambio(v); onCerrar(); }}
      />
      {problema && <span className={`mx-celda-motivo ${problema.severidad}`}><AlertTriangle size={12} /> {problema.mensaje}</span>}
      {opcional && lista.length === 0 && (
        <button type="button" className="mx-link" onMouseDown={(e) => e.preventDefault()} onClick={() => { onCambio(''); onCerrar(); }}>
          Dejar vacío
        </button>
      )}
    </div>
  );
}

/** Ventana para completar toda una columna de una vez. */
function CompletarColumna({
  columna, campos, mapping, esquema, modelos, vacias, porCompletar, onAplicar, onDejarVacias, onCompletarGrupo, onCerrar,
  onCompletarVehiculo,
}: {
  onCompletarVehiculo: (columna: 'anio_desde' | 'anio_hasta') => void;
  columna: string; campos: CampoMeta[]; mapping: Mapping; esquema: EsquemaPlantilla; modelos: Record<string, string[]>;
  vacias: number; porCompletar: CampoPorCompletar[];
  onAplicar: (valor: string) => void; onDejarVacias: () => void; onCompletarGrupo: (grupo: string, valor: string) => void;
  onCerrar: () => void;
}) {
  const campo = campos.find((c) => c.key === columna);
  const etiqueta = campo?.label ?? columna;
  const obligatorio = campo ? requiereValorEnPanel(campo, mapping) : false;
  const [valor, setValor] = useState('');
  const sinContexto: ContextoDeFila = { categoria: '', marcaVehiculo: '', anioDesde: '' };
  const opciones = opcionesDeCelda(columna, sinContexto, esquema, campos, modelos);
  const error = opciones.length === 0 && valor ? validarValorFijo(columna, valor, etiqueta) : null;
  const agrupado = CAMPO_AGRUPADO_POR[columna];
  const grupos = porCompletar.find((c) => c.columna === columna)?.grupos ?? [];

  return (
    <Modal titulo={`Completar "${etiqueta}"`} onCerrar={onCerrar} ancho={560}>
      {COLUMNAS_DE_VERSION.has(columna) ? (
        <>
          <p className="mx-ayuda">
            {columna === 'motor'
              ? <>El motor depende del modelo de cada repuesto: en cada celda te mostramos sólo los motores que el catálogo de RepuesTop tiene para ese modelo. Si no lo sabes, déjalo sin asignar: el repuesto se publica para todas las versiones del modelo.</>
              : <>Los años dependen del modelo de cada repuesto: en cada celda te mostramos sólo los años en que ese modelo existe en el catálogo de RepuesTop. Si no sabes los años exactos, podemos ponerle a cada repuesto <b>todos los años de su modelo</b>.</>}
          </p>
          <div className="mx-botonera">
            {columna !== 'motor' && (
              <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={() => { onCompletarVehiculo(columna as 'anio_desde' | 'anio_hasta'); onCerrar(); }}>
                <Wand2 size={15} /> {columna === 'anio_desde' ? 'Todos los años del modelo' : 'Hasta el último año del modelo'} en las {plural(vacias, 'fila vacía', 'filas vacías')}
              </button>
            )}
            {!obligatorio && (
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => { onDejarVacias(); onCerrar(); }}>
                {columna === 'motor' ? 'No asignar motor en las filas vacías' : 'Dejarlas vacías'}
              </button>
            )}
          </div>
        </>
      ) : columna === 'compatibilidad_modelo' ? (
        <p className="mx-ayuda">El modelo depende de la marca del auto de cada repuesto, así que se elige fila por fila: haz clic en cada celda amarilla.</p>
      ) : agrupado ? (
        <>
          <p className="mx-ayuda">
            La {etiqueta.toLowerCase()} depende de la {etiquetaDe(campos, agrupado).toLowerCase()}. Elígela <b>una vez por {etiquetaDe(campos, agrupado).toLowerCase()}</b> y
            se la ponemos a todos los repuestos de ese grupo que no la tengan.
          </p>
          {grupos.length === 0 && <p className="mx-nota">Primero completa la {etiquetaDe(campos, agrupado).toLowerCase()} de tus repuestos.</p>}
          <div className="mx-grupos">
            {grupos.map((g) => (
              <label key={g.clave} className="mx-grupo">
                <span><b>{g.clave}</b> · {plural(g.pendientes, 'sin dato', 'sin dato')}</span>
                <select className="form-control" value={g.elegido} onChange={(e) => onCompletarGrupo(g.clave, e.target.value)} aria-label={`${etiqueta} para ${g.clave}`}>
                  <option value="">— dejar sin este dato —</option>
                  {(esquema.catalogos.subcategoriasPorCategoria[g.clave] ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="mx-ayuda">
            Elige un valor y lo ponemos en las <b>{plural(vacias, 'fila que lo tiene vacío', 'filas que lo tienen vacío')}</b>. Las celdas que ya
            tienen un dato no se tocan, y después puedes cambiar cualquier fila por separado.
          </p>
          {opciones.length > 0 ? (
            <select className="form-control" value={valor} onChange={(e) => setValor(e.target.value)} aria-label={`Valor para todas las filas vacías de ${etiqueta}`}>
              <option value="">Elige un valor…</option>
              {opciones.map((o) => <option key={o} value={o}>{etiquetaValor(o)}</option>)}
            </select>
          ) : (
            <input
              className={`form-control ${error ? 'con-error' : ''}`}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="Escribe el valor"
              aria-label={`Valor para todas las filas vacías de ${etiqueta}`}
            />
          )}
          {error && <p className="mx-error-texto">{error}</p>}
          <div className="mx-botonera">
            <button type="button" className="btn btn-primary btn-primary-blue mx-btn" disabled={!valor.trim() || !!error} onClick={() => { onAplicar(valor); onCerrar(); }}>
              <Wand2 size={15} /> Aplicar a las filas vacías
            </button>
            {!obligatorio && (
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => { onDejarVacias(); onCerrar(); }}>
                Dejarlas vacías (es opcional)
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

export function PasoCompletar(p: Props) {
  const { tabla, columnas, campos } = p;
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [tamano, setTamano] = useState<number>(50);
  const [pagina, setPagina] = useState(1);
  const [activa, setActiva] = useState<{ clave: string; columna: string } | null>(null);
  const [columnaMasiva, setColumnaMasiva] = useState<string | null>(null);
  const [fotosDe, setFotosDe] = useState<FilaTabla | null>(null);
  const [avisoAuto, setAvisoAuto] = useState<string | null>(null);
  /** El repuesto que el vendedor está corrigiendo: se resalta y sus problemas se explican arriba. */
  const [foco, setFoco] = useState<string | null>(null);
  /** La celda a la que se acaba de llevar al vendedor: parpadea un momento. */
  const [destello, setDestello] = useState<{ clave: string; columna: string } | null>(null);

  const indice = useMemo(() => new Map(tabla.columnas.map((c, i) => [c, i])), [tabla.columnas]);

  /** Los problemas de cada fila con el dato al que corresponden: los del panel y los del servidor. */
  const problemasPorClave = useMemo(() => new Map(tabla.filas.map((f) => [
    f.clave, problemasDeFila(f, tabla.columnas, campos, p.servidor, p.versionesDe),
  ])), [tabla, campos, p.servidor, p.versionesDe]);

  // Se piden de entrada las versiones de todos los modelos del archivo: así los años y motores ya
  // están al abrir una celda, y lo que el catálogo no tiene se marca antes de publicar.
  const { pedirVersiones } = p;
  useEffect(() => {
    const iMarca = tabla.columnas.indexOf('compatibilidad_marca');
    const iModelo = tabla.columnas.indexOf('compatibilidad_modelo');
    if (iMarca < 0 || iModelo < 0) return;
    for (const f of tabla.filas) pedirVersiones(String(f.valores[iMarca] ?? ''), String(f.valores[iModelo] ?? ''));
  }, [tabla, pedirVersiones]);

  // H53: un "en adelante" que pasa del último año del catálogo se cierra en ese año apenas llegan
  // las versiones, y se avisa arriba de la tabla (no es un dato que cambie en silencio).
  const [cierres, setCierres] = useState<{ marca: string; modelo: string; hasta: string }[]>([]);
  const { onParches } = p;
  const cerradas = useRef(new Set<string>());
  useEffect(() => {
    const nuevos = cierresAlCatalogo(tabla.filas, tabla.columnas, p.versionesDe)
      .filter((c) => !cerradas.current.has(c.clave));
    if (nuevos.length === 0) return;
    for (const c of nuevos) cerradas.current.add(c.clave);
    for (const c of nuevos) onParches(c.clave, { anio_hasta: c.hasta });
    setCierres((previos) => [...previos, ...nuevos.map(({ marca, modelo, hasta }) => ({ marca, modelo, hasta }))]);
  }, [tabla, p.versionesDe, onParches]);
  const tieneError = (f: FilaTabla) => (problemasPorClave.get(f.clave) ?? []).some((x) => x.severidad === 'error');

  /** Columnas donde algún repuesto tiene un dato que impide publicar. */
  const columnasConError = useMemo(() => {
    const cols = new Set<string>();
    problemasPorClave.forEach((lista) => lista.forEach((x) => { if (x.columna && x.severidad === 'error') cols.add(x.columna); }));
    return cols;
  }, [problemasPorClave]);

  /** Un dato con problema siempre se ve, aunque la columna venga vacía en todo el archivo. */
  const columnasMostradas = useMemo(() => {
    const conProblema = new Set<string>();
    problemasPorClave.forEach((lista) => lista.forEach((x) => { if (x.columna) conProblema.add(x.columna); }));
    return tabla.columnas.filter((c) => columnas.includes(c) || conProblema.has(c));
  }, [tabla.columnas, columnas, problemasPorClave]);
  const hayFotos = Object.keys(p.imagenes).length > 0 || Object.keys(p.guardadas).length > 0;
  const conFoto = tabla.filas.filter((f) => (p.asignaciones[f.clave] ?? []).length > 0).length;

  const filasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return tabla.filas.filter((f) => {
      if (filtro === 'faltan' && f.faltantes.length === 0) return false;
      if (filtro === 'problemas' && (problemasPorClave.get(f.clave) ?? []).length === 0) return false;
      if (filtro === 'sinfoto' && (p.asignaciones[f.clave] ?? []).length > 0) return false;
      if (q && !f.sku.toLowerCase().includes(q) && !f.nombre.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tabla.filas, filtro, busqueda, p.asignaciones, problemasPorClave]);

  const paginas = Math.max(1, Math.ceil(filasFiltradas.length / tamano));
  const actual = Math.min(pagina, paginas);
  const filasPagina = filasFiltradas.slice((actual - 1) * tamano, actual * tamano);

  const irAProximaAmarilla = () => {
    const desde = activa ? filasFiltradas.findIndex((f) => f.clave === activa.clave) + 1 : 0;
    const orden = [...filasFiltradas.slice(desde), ...filasFiltradas.slice(0, desde)];
    const fila = orden.find((f) => f.faltantes.some((c) => columnas.includes(c)));
    if (!fila) return;
    const pos = filasFiltradas.indexOf(fila);
    setPagina(Math.floor(pos / tamano) + 1);
    setActiva({ clave: fila.clave, columna: fila.faltantes.find((c) => columnas.includes(c)) as string });
    setTimeout(() => document.getElementById(`mx-fila-${fila.clave}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 50);
  };

  const leerDe = (fila: FilaTabla) => (col: string) => {
    const i = indice.get(col);
    return i === undefined ? '' : String(fila.valores[i] ?? '').trim();
  };

  const autoAsignar = () => {
    const n = p.onAutoAsignar();
    setAvisoAuto(n > 0
      ? `Asignamos fotos a ${plural(n, 'repuesto', 'repuestos')} buscando su código en el nombre de cada foto.`
      : 'No encontramos fotos cuyo nombre coincida con el código de los repuestos que no tienen foto.');
  };


  const vigiladasAmarillas = columnas.filter((c) => (tabla.faltantesPorColumna[c] ?? 0) > 0);

  /* ---------------- Desplazamiento horizontal ----------------
   * Con muchas filas, la barra de desplazamiento horizontal de la tabla queda al fondo y el vendedor
   * no llega a ella. Por eso hay una barra y botones arriba de la tabla (que se quedan a la vista al
   * bajar), y un aviso de qué columnas con datos por completar siguen escondidas a la derecha. */
  const marcoRef = useRef<HTMLDivElement>(null);
  const barraRef = useRef<HTMLDivElement>(null);
  const sincronizando = useRef(false);
  const [vista, setVista] = useState({ izquierda: false, derecha: false, anchoTotal: 0, pendientesDerecha: [] as string[] });
  /* H50 (prueba del 30-sep): los títulos son sticky DENTRO de la tabla, pero lo que baja es la página;
   * al bajar se iban y la barra seguía arriba sola. Cuando salen de la vista se muestra una copia de
   * los nombres pegada bajo la barra, con los mismos anchos y movida a lo ancho con la tabla. */
  const desplazarRef = useRef<HTMLDivElement>(null);
  const pistaRef = useRef<HTMLDivElement | null>(null);
  const [anchos, setAnchos] = useState<number[]>([]);
  const [cabeceraFija, setCabeceraFija] = useState(false);
  /* H49: mientras se arrastra la barra no se le devuelve la posición de la tabla, que salta de
   * columna en columna (scroll-snap): sin esto barra y tabla se pelearían. */
  const arrastrandoBarra = useRef(false);
  const moverPista = () => {
    if (pistaRef.current) pistaRef.current.style.transform = `translateX(${-(marcoRef.current?.scrollLeft ?? 0)}px)`;
  };
  const revisarCabecera = () => {
    const marco = marcoRef.current;
    const thead = marco?.querySelector('thead');
    const barra = desplazarRef.current;
    if (!marco || !thead || !barra) return;
    const titulos = thead.getBoundingClientRect();
    const tope = barra.getBoundingClientRect().bottom;
    setCabeceraFija(titulos.top < tope - 2 && marco.getBoundingClientRect().bottom > tope + 48);
  };

  const medir = () => {
    const marco = marcoRef.current;
    if (!marco) return;
    const { scrollLeft, clientWidth, scrollWidth } = marco;
    const borde = scrollLeft + clientWidth - 8;
    const pendientes: string[] = [];
    marco.querySelectorAll<HTMLTableCellElement>('thead th[data-col]').forEach((th) => {
      const col = th.dataset.col as string;
      const pendiente = (tabla.faltantesPorColumna[col] ?? 0) > 0 || columnasConError.has(col);
      if (pendiente && th.offsetLeft + th.offsetWidth / 2 > borde) pendientes.push(col);
    });
    const nuevos = Array.from(marco.querySelectorAll<HTMLTableCellElement>('thead th')).map((th) => th.offsetWidth);
    setAnchos((a) => (a.join() === nuevos.join() ? a : nuevos));
    moverPista();
    revisarCabecera();
    setVista((v) => {
      const nueva = {
        izquierda: scrollLeft > 4,
        derecha: scrollLeft + clientWidth < scrollWidth - 4,
        anchoTotal: scrollWidth,
        pendientesDerecha: pendientes,
      };
      return v.izquierda === nueva.izquierda && v.derecha === nueva.derecha && v.anchoTotal === nueva.anchoTotal
        && v.pendientesDerecha.join() === nueva.pendientesDerecha.join() ? v : nueva;
    });
  };

  const alDesplazarTabla = () => {
    if (barraRef.current && !sincronizando.current && !arrastrandoBarra.current) {
      sincronizando.current = true;
      barraRef.current.scrollLeft = marcoRef.current?.scrollLeft ?? 0;
      requestAnimationFrame(() => { sincronizando.current = false; });
    }
    medir();
  };
  const alDesplazarBarra = () => {
    if (marcoRef.current && !sincronizando.current) {
      sincronizando.current = true;
      marcoRef.current.scrollLeft = barraRef.current?.scrollLeft ?? 0;
      requestAnimationFrame(() => { sincronizando.current = false; });
    }
  };
  /** La barra de abajo no existe (sólo la de arriba): la rueda o el trackpad hacia el lado mueven la tabla igual. */
  const alGirarRueda = (e: WheelEvent<HTMLDivElement>) => {
    const marco = marcoRef.current;
    if (!marco) return;
    const lateral = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (lateral) marco.scrollLeft += lateral;
  };
  const desplazar = (sentido: 1 | -1) => {
    const marco = marcoRef.current;
    if (!marco) return;
    marco.scrollBy?.({ left: sentido * Math.max(240, marco.clientWidth * 0.7), behavior: 'smooth' });
  };
  const irAColumna = (col: string) => {
    const marco = marcoRef.current;
    const th = marco?.querySelector<HTMLTableCellElement>(`thead th[data-col="${col}"]`);
    if (!marco || !th) return;
    // Queda a la vista justo después de las columnas fijas (Fila y Fotos).
    marco.scrollTo?.({ left: Math.max(0, th.offsetLeft - anchoFijas()), behavior: 'smooth' });
  };
  /** Ancho de Fila + Fotos, que quedan fijas a la izquierda. */
  const anchoFijas = () => (anchos[0] ?? 58) + (anchos[1] ?? 113);

  useEffect(() => {
    const soltarBarra = () => {
      if (!arrastrandoBarra.current) return;
      arrastrandoBarra.current = false;
      if (barraRef.current && marcoRef.current) barraRef.current.scrollLeft = marcoRef.current.scrollLeft;
    };
    window.addEventListener('pointerup', soltarBarra);
    window.addEventListener('scroll', revisarCabecera, true);
    window.addEventListener('resize', revisarCabecera);
    return () => {
      window.removeEventListener('pointerup', soltarBarra);
      window.removeEventListener('scroll', revisarCabecera, true);
      window.removeEventListener('resize', revisarCabecera);
    };
    // Sólo usa refs y setState: basta registrarlo una vez.
  }, []);

  // Se vuelve a medir cuando cambia lo que se muestra o el tamaño de la ventana.
  useEffect(() => {
    medir();
    const marco = marcoRef.current;
    if (!marco || typeof ResizeObserver === 'undefined') return undefined;
    const observador = new ResizeObserver(() => medir());
    observador.observe(marco);
    return () => observador.disconnect();
  });

  const filaFoco = foco ? tabla.filas.find((f) => f.clave === foco) ?? null : null;
  const problemasFoco = filaFoco ? problemasPorClave.get(filaFoco.clave) ?? [] : [];
  /** Lleva a la celda del dato con problema y abre su lista para corregirlo. */
  const irACampo = (fila: FilaTabla, columna: string) => {
    const pos = filasFiltradas.indexOf(fila);
    if (pos < 0) {
      setFiltro('todas');
      setBusqueda('');
      setPagina(Math.floor(tabla.filas.indexOf(fila) / tamano) + 1);
    } else {
      setPagina(Math.floor(pos / tamano) + 1);
    }
    setActiva({ clave: fila.clave, columna });
    setDestello({ clave: fila.clave, columna });
    setTimeout(() => {
      document.getElementById(`mx-fila-${fila.clave}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      irAColumna(columna);
    }, 60);
    setTimeout(() => setDestello((d) => (d?.clave === fila.clave && d.columna === columna ? null : d)), 1800);
  };

  /** Lo que hace el ⚠ de la columna Fila: explica arriba qué impide publicar y lleva al primer dato. */
  const abrirCorreccion = (fila: FilaTabla) => {
    setFoco(fila.clave);
    const lista = problemasPorClave.get(fila.clave) ?? [];
    const primero = lista.find((x) => x.severidad === 'error' && x.columna) ?? lista.find((x) => x.columna);
    if (primero?.columna) irACampo(fila, primero.columna);
  };

  // "Corregir" desde la vista previa hace lo mismo que tocar el ⚠ de esa fila.
  const claveInicialRef = useRef(p.claveInicial ?? null);
  useEffect(() => {
    const clave = claveInicialRef.current;
    claveInicialRef.current = null;
    const fila = clave ? tabla.filas.find((f) => f.clave === clave) : undefined;
    if (fila) abrirCorreccion(fila);
    // Sólo al entrar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al corregir un dato del repuesto en foco, se pasa solo al siguiente que falte corregir.
  const erroresFoco = problemasFoco.filter((x) => x.severidad === 'error' && x.columna);
  const erroresPrevios = useRef(erroresFoco.length);
  useEffect(() => {
    const antes = erroresPrevios.current;
    erroresPrevios.current = erroresFoco.length;
    if (!filaFoco || erroresFoco.length === 0 || erroresFoco.length >= antes) return;
    irACampo(filaFoco, erroresFoco[0].columna as string);
    // Sólo cuando baja la cantidad de errores del repuesto en foco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erroresFoco.length, foco]);

  return (
    <div className="mx-paso mx-paso-ancho">
      <div className="mx-explica">
        <Info size={18} />
        <p>
          Estos son tus repuestos tal como se van a publicar. <b>Las celdas en amarillo son datos que faltan por completar</b>:
          haz clic en una para elegir el dato de la lista. Cuando la completas se pone en blanco. Para llenar muchas de una
          vez, usa <b>"Completar todas"</b> en el título de la columna. En la columna <b>Fotos</b> eliges la foto de cada repuesto.
        </p>
      </div>

      <div className="mx-leyenda" aria-label="Qué significan los colores">
        <span><i className="mx-muestra amarilla" /> Falta completar</span>
        <span><i className="mx-muestra blanca" /> Listo</span>
        <span><i className="mx-muestra roja" /> Hay que revisar (no se publicaría así)</span>
      </div>

      <div className="mx-resumen-fila">
        <span><b>{tabla.total.toLocaleString('es-CL')}</b> repuestos</span>
        <span className={tabla.celdasFaltantes ? 'amarillo' : 'ok'}>
          {tabla.celdasFaltantes
            ? <><b>{tabla.celdasFaltantes.toLocaleString('es-CL')}</b> celdas por completar en {plural(tabla.filasConFaltantes, 'repuesto', 'repuestos')}</>
            : <><b>Todo completo</b></>}
        </span>
        <span className={tabla.conError ? 'mal' : 'ok'}><b>{tabla.publicables.toLocaleString('es-CL')}</b> se pueden publicar</span>
        {tabla.conError > 0 && <span className="mal"><b>{tabla.conError.toLocaleString('es-CL')}</b> con algo por revisar</span>}
        <span><b>{conFoto.toLocaleString('es-CL')}</b> con foto</span>
      </div>

      {p.catalogoModelosCaido && (
        <div className="mx-alerta aviso"><AlertTriangle size={16} /> No pudimos traer la lista de modelos de autos. Los modelos se revisarán al publicar.</div>
      )}

      {p.cambioMasivo && (
        <div className="mx-alerta info mx-deshacer" role="status">
          <Sparkles size={16} />
          <span>{p.cambioMasivo.descripcion}</span>
          <button type="button" className="mx-link" onClick={() => { p.cambioMasivo?.deshacer(); p.onOlvidarCambioMasivo(); }}>
            <Undo2 size={14} /> Deshacer
          </button>
          <button type="button" className="mx-icono-btn" onClick={p.onOlvidarCambioMasivo} aria-label="Cerrar aviso"><X size={14} /></button>
        </div>
      )}

      <div className="mx-herramientas">
        <div className="mx-segmentado" role="group" aria-label="Filtrar repuestos">
          {([
            ['todas', `Todos (${tabla.total.toLocaleString('es-CL')})`],
            ['faltan', `Por completar (${tabla.filasConFaltantes.toLocaleString('es-CL')})`],
            ['problemas', `Por revisar (${tabla.filas.filter((f) => (problemasPorClave.get(f.clave) ?? []).length).length.toLocaleString('es-CL')})`],
            ['sinfoto', `Sin foto (${(tabla.total - conFoto).toLocaleString('es-CL')})`],
          ] as [Filtro, string][]).map(([valor, texto]) => (
            <button key={valor} type="button" className={filtro === valor ? 'activo' : ''} aria-pressed={filtro === valor} onClick={() => { setFiltro(valor); setPagina(1); }}>
              {texto}
            </button>
          ))}
        </div>
        <label className="mx-buscador">
          <Search size={15} />
          <input type="search" placeholder="Buscar por código o nombre" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }} aria-label="Buscar repuesto" />
        </label>
        {tabla.celdasFaltantes > 0 && (
          <button type="button" className="btn btn-secondary mx-btn" onClick={irAProximaAmarilla}>
            <ArrowRight size={15} /> Ir a la próxima celda amarilla
          </button>
        )}
        <span className="mx-separador" />
        {hayFotos ? (
          <button type="button" className="btn btn-secondary mx-btn" onClick={autoAsignar}><Wand2 size={15} /> Asignar fotos por código</button>
        ) : null}
        <button type="button" className="btn btn-secondary mx-btn" onClick={p.onAgregarFotos}><FolderOpen size={15} /> {hayFotos ? 'Cambiar carpeta de fotos' : 'Agregar fotos'}</button>
        {p.enlacesPendientes > 0 && (
          <button type="button" className="btn btn-secondary mx-btn" onClick={p.onTraerEnlaces} disabled={!!p.descargandoEnlaces}>
            {p.descargandoEnlaces
              ? <><Download size={15} /> Trayendo {p.descargandoEnlaces.hechas}/{p.descargandoEnlaces.total}…</>
              : <><Link2 size={15} /> Traer {plural(p.enlacesPendientes, 'foto', 'fotos')} desde los enlaces de tu Excel</>}
          </button>
        )}
      </div>
      {avisoAuto && <p className="mx-nota" role="status"><ImagePlus size={14} /> {avisoAuto}</p>}

      {filaFoco && (
        <section className={`mx-foco ${problemasFoco.some((x) => x.severidad === 'error') ? 'error' : problemasFoco.length ? 'aviso' : 'ok'}`} aria-live="polite">
          <header>
            <strong>
              Corrigiendo la fila {filaFoco.numeroFila}{filaFoco.nombre ? ` · ${filaFoco.nombre}` : ''}{filaFoco.sku ? ` (${filaFoco.sku})` : ''}
            </strong>
            <button type="button" className="mx-icono-btn" onClick={() => setFoco(null)} aria-label="Dejar de corregir este repuesto"><X size={14} /></button>
          </header>
          {problemasFoco.length === 0 ? (
            <p className="mx-foco-listo">
              <CheckCircle2 size={16} /> ¡Listo! Este repuesto ya no tiene nada por corregir.
              <button type="button" className="btn btn-primary btn-primary-blue mx-btn mx-btn-chico" onClick={p.onSiguiente}>Volver a la vista previa</button>
            </p>
          ) : (
            <>
              <p>
                {problemasFoco.some((x) => x.severidad === 'error')
                  ? <><b>No se publicará</b> hasta que corrijas {problemasFoco.filter((x) => x.severidad === 'error').length === 1 ? 'esta columna' : 'estas columnas'}. Te llevamos a la celda (queda en rojo); al corregirla pasamos a la siguiente:</>
                  : <>Se publica, pero revisa {problemasFoco.length === 1 ? 'esta columna' : 'estas columnas'}:</>}
              </p>
              <ul className="mx-foco-lista">
                {problemasFoco.map((x, i) => (
                  <li key={i} className={`${x.severidad} ${activa?.clave === filaFoco.clave && activa.columna === x.columna ? 'actual' : ''}`}>
                    {x.columna ? (
                      <button type="button" className="mx-foco-campo" onClick={() => irACampo(filaFoco, x.columna as string)} title="Ir a esta celda">
                        Columna «{etiquetaDe(campos, x.columna)}»
                      </button>
                    ) : <span className="mx-foco-campo sin">Todo el repuesto</span>}
                    <span><b>Por qué:</b> {x.mensaje}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {cierres.length > 0 && (
        <div className="mx-alerta aviso" role="status">
          <AlertTriangle size={16} />
          <span>
            Cerramos «en adelante» en el último año que el catálogo tiene para el modelo en{' '}
            {plural(cierres.length, 'repuesto', 'repuestos')} (por ejemplo, {cierres[0].marca} {cierres[0].modelo} hasta{' '}
            {cierres[0].hasta}). Si tu repuesto sirve para un año más nuevo, cámbialo en la columna «Año hasta».
          </span>
        </div>
      )}

      <div ref={desplazarRef} className="mx-desplazar" role="group" aria-label="Moverse entre las columnas de la tabla">
        <button type="button" className="mx-icono-btn" onClick={() => desplazar(-1)} disabled={!vista.izquierda} aria-label="Ver las columnas de la izquierda" title="Columnas de la izquierda">
          <ChevronLeft size={18} />
        </button>
        <div
          ref={barraRef}
          className="mx-barra-h"
          onScroll={alDesplazarBarra}
          onPointerDown={() => { arrastrandoBarra.current = true; }}
          aria-hidden
          style={{ visibility: vista.izquierda || vista.derecha ? 'visible' : 'hidden' }}
        >
          <div style={{ width: vista.anchoTotal || '100%', height: 1 }} />
        </div>
        <button type="button" className="mx-icono-btn" onClick={() => desplazar(1)} disabled={!vista.derecha} aria-label="Ver las columnas de la derecha" title="Columnas de la derecha">
          <ChevronRight size={18} />
        </button>
        {cabeceraFija && anchos.length > 2 && (
          <div className="mx-cabecera-fija" aria-hidden="true" data-testid="mx-cabecera-fija">
            <div className="mx-cf-fijas">
              <span style={{ width: anchos[0] }}>Fila</span>
              <span style={{ width: anchos[1] }}>Fotos</span>
            </div>
            <div className="mx-cf-ventana">
              <div ref={(el) => { pistaRef.current = el; moverPista(); }} className="mx-cf-pista">
                {columnasMostradas.map((c, i) => (
                  <span key={c} className={(tabla.faltantesPorColumna[c] ?? 0) > 0 ? 'amarilla' : ''} style={{ width: anchos[i + 2] }}>
                    {etiquetaDe(campos, c)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {vista.pendientesDerecha.length > 0 && (
        <div className="mx-alerta aviso mx-pendientes-derecha" role="status">
          <ArrowRight size={16} />
          <span>
            <b>Hay más columnas a la derecha con datos por completar:</b>{' '}
            {vista.pendientesDerecha.map((c, i) => (
              <span key={c}>
                {i > 0 && ', '}
                <button type="button" className="mx-link" onClick={() => irAColumna(c)}>{etiquetaDe(campos, c)}</button>
              </span>
            ))}
            . No te olvides de completarlas.
          </span>
        </div>
      )}

      <div
        className={`mx-tabla-marco ${vista.izquierda ? 'con-izquierda' : ''} ${vista.derecha ? 'con-derecha' : ''}`}
        style={{ '--mx-fijas': `${anchoFijas()}px` } as CSSProperties}
      >
      <div ref={marcoRef} className="mx-tabla-wrap" role="region" aria-label="Tabla de tus repuestos" tabIndex={0} onScroll={alDesplazarTabla} onWheel={alGirarRueda}>
        <table className="mx-tabla">
          <thead>
            <tr>
              <th className="mx-col-fila">Fila</th>
              <th className="mx-col-fotos">Fotos</th>
              {columnasMostradas.map((c) => {
                const campo = campos.find((x) => x.key === c);
                const faltan = tabla.faltantesPorColumna[c] ?? 0;
                const obligatorio = campo ? requiereValorEnPanel(campo, p.mapping) : false;
                return (
                  <th key={c} data-col={c} className={`${faltan > 0 ? 'amarilla' : ''} ${columnasConError.has(c) ? 'con-error' : ''}`}>
                    <span className="mx-th-nombre">{campo?.label ?? c}{obligatorio && <b className="mx-req">*</b>}</span>
                    {faltan > 0 && (
                      <span className="mx-th-faltan">
                        {plural(faltan, 'por completar', 'por completar')}
                        <button type="button" className="mx-th-boton" onClick={() => setColumnaMasiva(c)}>Completar todas</button>
                      </span>
                    )}
                    {faltan === 0 && p.opcionalesVacios.includes(c) && <span className="mx-th-nota">vacía a propósito</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filasPagina.map((fila) => {
              const leer = leerDe(fila);
              const contexto: ContextoDeFila = { categoria: leer('categoria'), marcaVehiculo: leer('compatibilidad_marca'), anioDesde: leer('anio_desde') };
              const listaProblemas = problemasPorClave.get(fila.clave) ?? [];
              // Si un dato tiene un error y un aviso, se muestra el error: es el que impide publicar.
              const problemas = new Map<string, ProblemaFila>();
              for (const x of listaProblemas) {
                if (!x.columna) continue;
                const previo = problemas.get(x.columna);
                if (!previo || (previo.severidad === 'aviso' && x.severidad === 'error')) problemas.set(x.columna, x);
              }
              const conError = tieneError(fila);
              const enFoco = foco === fila.clave;
              const esUniversal = ['SI', 'SÍ', 'TRUE', '1', 'X'].includes(leer('compatibilidad_general').toUpperCase());
              const fotos = p.asignaciones[fila.clave] ?? [];
              return (
                <tr key={fila.clave} id={`mx-fila-${fila.clave}`} className={`${conError ? 'con-error' : ''} ${enFoco ? 'mx-fila-foco' : ''}`}>
                  <th scope="row" className="mx-col-fila">
                    {listaProblemas.length > 0 ? (
                      <button
                        type="button"
                        className="mx-fila-boton"
                        onClick={() => abrirCorreccion(fila)}
                        title="Ver qué impide publicar este repuesto e ir a corregirlo"
                        aria-label={`Fila ${fila.numeroFila}: ver qué hay que corregir`}
                      >
                        {fila.numeroFila}
                        <AlertTriangle size={13} className={`mx-fila-alerta ${conError ? '' : 'aviso'}`} />
                      </button>
                    ) : fila.numeroFila}
                  </th>
                  <td className="mx-col-fotos">
                    <button
                      type="button"
                      className={`mx-fotos-celda ${fotos.length ? '' : 'vacia'}`}
                      onClick={() => setFotosDe(fila)}
                      aria-label={`Fotos de ${fila.nombre || fila.sku || `la fila ${fila.numeroFila}`}`}
                      title={fotos.length ? `${fotos.length}/${MAX_IMAGES_PER_PRODUCT} fotos. Clic para cambiarlas.` : 'Elegir fotos'}
                    >
                      {fotos.length > 0
                        ? fotos.slice(0, 2).map((n) => <Miniatura key={n} nombre={n} blob={p.imagenes[n]} imagenId={p.guardadas[n]} tamano={32} />)
                        : <><ImagePlus size={15} /> Elegir</>}
                      {fotos.length > 2 && <span className="mx-fotos-mas">+{fotos.length - 2}</span>}
                    </button>
                  </td>
                  {columnasMostradas.map((c) => {
                    const i = indice.get(c) as number;
                    const valor = String(fila.valores[i] ?? '');
                    const campo = campos.find((x) => x.key === c);
                    const esActiva = activa?.clave === fila.clave && activa.columna === c;
                    const problema = problemas.get(c);
                    return (
                      <td
                        key={c}
                        className={`${fila.faltantes.includes(c) ? 'amarilla' : ''} ${problema ? `mx-td-${problema.severidad}` : ''} ${c === 'stock' && problema?.severidad === 'aviso' ? 'mx-stock-bajo' : ''}`}
                      >
                        <Celda
                          valor={valor}
                          columna={c}
                          amarilla={fila.faltantes.includes(c)}
                          problema={problema}
                          mostrarMotivo={enFoco}
                          activa={esActiva}
                          onActivar={() => {
                            if (COLUMNAS_DE_VERSION.has(c)) p.pedirVersiones(leer('compatibilidad_marca'), leer('compatibilidad_modelo'));
                            setActiva({ clave: fila.clave, columna: c });
                          }}
                          vehiculo={COLUMNAS_DE_VERSION.has(c) && !esUniversal ? {
                            leer,
                            versiones: p.versionesDe(leer('compatibilidad_marca'), leer('compatibilidad_modelo')),
                            respaldo: opcionesDeCelda(c, contexto, p.esquema, campos, p.modelosDisponibles),
                          } : undefined}
                          onCambioVarios={(valores) => p.onParches(fila.clave, valores)}
                          destello={destello?.clave === fila.clave && destello.columna === c}
                          onCerrar={() => setActiva((a) => (a?.clave === fila.clave && a.columna === c ? null : a))}
                          opciones={() => opcionesDeCelda(c, contexto, p.esquema, campos, p.modelosDisponibles)}
                          sugerencias={(lista) => sugerenciasDeCelda(valor, lista)}
                          etiqueta={`${campo?.label ?? c} de la fila ${fila.numeroFila}`}
                          opcional={campo ? !requiereValorEnPanel(campo, p.mapping) : true}
                          onCambio={(v) => {
                            const sigue = c === 'compatibilidad_marca'
                              ? modeloQueSigue(v, leer('compatibilidad_modelo'), p.modelosDisponibles) : undefined;
                            if (sigue) p.onParches(fila.clave, { compatibilidad_marca: v, compatibilidad_modelo: sigue });
                            else p.onParche(fila.clave, c, v);
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {filasPagina.length === 0 && (
              <tr><td colSpan={columnasMostradas.length + 2} className="mx-tabla-vacia">No hay repuestos que mostrar con este filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      <div className="mx-paginado">
        <span>
          {filasFiltradas.length === 0 ? '0' : `${((actual - 1) * tamano + 1).toLocaleString('es-CL')}–${Math.min(actual * tamano, filasFiltradas.length).toLocaleString('es-CL')}`}
          {' '}de {filasFiltradas.length.toLocaleString('es-CL')}
        </span>
        <button type="button" className="btn btn-secondary mx-btn" disabled={actual <= 1} onClick={() => setPagina(actual - 1)}><ArrowLeft size={15} /> Anteriores</button>
        <span>Página {actual} de {paginas}</span>
        <button type="button" className="btn btn-secondary mx-btn" disabled={actual >= paginas} onClick={() => setPagina(actual + 1)}>Siguientes <ArrowRight size={15} /></button>
        <label className="mx-tamano">
          Mostrar
          <select value={tamano} onChange={(e) => { setTamano(Number(e.target.value)); setPagina(1); }} aria-label="Filas por página">
            {TAMANOS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          por página
        </label>
      </div>

      {vigiladasAmarillas.length > 0 && (
        <div className="mx-alerta aviso">
          <AlertTriangle size={16} />
          <span>
            Todavía hay datos por completar en: <b>{vigiladasAmarillas.map((c) => etiquetaDe(campos, c)).join(', ')}</b>. Puedes seguir igual:
            los repuestos a los que les falte un dato obligatorio no se publicarán y te lo diremos en el paso 4.
          </span>
        </div>
      )}

      <footer className="mx-pie">
        <button type="button" className="btn btn-secondary mx-btn" onClick={p.onAtras}><ArrowLeft size={16} /> Atrás</button>
        <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={p.onSiguiente}>
          Siguiente: ver cómo quedará publicado <ArrowRight size={16} />
        </button>
      </footer>

      {columnaMasiva && (
        <CompletarColumna
          columna={columnaMasiva}
          campos={campos}
          mapping={p.mapping}
          esquema={p.esquema}
          modelos={p.modelosDisponibles}
          vacias={tabla.faltantesPorColumna[columnaMasiva] ?? 0}
          porCompletar={p.porCompletar}
          onAplicar={(v) => p.onAplicarATodas(columnaMasiva, v)}
          onDejarVacias={() => p.onDejarVacias(columnaMasiva)}
          onCompletarGrupo={(g, v) => p.onCompletarGrupo(columnaMasiva, g, v)}
          onCompletarVehiculo={p.onCompletarVehiculo}
          onCerrar={() => setColumnaMasiva(null)}
        />
      )}

      {fotosDe && (
        <SelectorFotos
          titulo={`Fotos de ${fotosDe.nombre || 'este repuesto'}${fotosDe.sku ? ` (${fotosDe.sku})` : ''}`}
          imagenes={p.imagenes}
          guardadas={p.guardadas}
          seleccion={p.asignaciones[fotosDe.clave] ?? []}
          onCerrar={() => setFotosDe(null)}
          onListo={(sel) => { p.onAsignarFotos(fotosDe.clave, sel); setFotosDe(null); }}
        />
      )}
    </div>
  );
}


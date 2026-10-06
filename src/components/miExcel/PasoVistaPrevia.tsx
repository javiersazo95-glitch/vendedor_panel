/**
 * Etapa 4 · Vista previa y publica. Muestra cada repuesto como va a quedar publicado, en dos
 * vistas: lista (tabla) y cuadrícula (tarjetas, como el menú Inventario). Desde una tarjeta, el ojo
 * y el lápiz abren "Así se verá en tu tienda" -la ficha que ve el comprador- y ahí mismo se puede
 * corregir cada dato (con la calculadora de lo que recibe el vendedor junto al precio); desde la ficha
 * se puede volver a la fila en la tabla del paso 3. Antes de publicar se revisa el archivo con el servidor, para que el vendedor sepa exactamente
 * qué se va a publicar y qué no. La papelera quita un repuesto de esta carga (no se publica); desde
 * "Quitados" se vuelve a incluir.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Eye, Info, Grid2X2, ImageOff, Images, List, Loader2, Pencil, Table2,
  RefreshCw, Rocket, ShieldCheck, Trash2, Undo2, XCircle,
} from 'lucide-react';
import { etiquetaValor, type CampoMeta, type EsquemaPlantilla, type Mapping } from '../../utils/plantillaMapping';
import { fichaDesdeFila } from '../../utils/plantillaRevision';
import {
  COLUMNAS_DE_CATALOGO, motivoSinOpciones, opcionesDeCelda, type ContextoDeFila,
} from '../../utils/miExcelDetecciones';
import {
  problemasDeFila, type FilaTabla, type ProblemaFila, type RevisionServidorFilas, type TablaMiExcel, type VersionesDe,
} from '../../utils/miExcelTabla';
import { COLUMNAS_DE_VERSION, type VersionCatalogo } from '../../utils/catalogoVersiones';
import { SelectVehiculo } from './SelectVehiculo';
import type { FilaResultado } from '../../utils/cargaExcelApi';
import { validarValorFijo, limiteDeColumna, normalizarNumero } from '../../utils/plantillaNormalizacion';
import { CalculadoraPrecio } from './CalculadoraPrecio';
import { liquidoDe } from '../../utils/pricing';
import { Miniatura, Modal } from './comunes';
import { plural } from './textos';
import { SelectorFotos } from './SelectorFotos';

export type EstadoRevision = 'sin-revisar' | 'revisando' | 'lista' | 'desactualizada' | 'error';

export interface RevisionServidor {
  estado: EstadoRevision;
  porClave: Record<string, FilaResultado>;
  error: string | null;
  /** Avisos que no son de una fila (compatibilidades con un código que no existe, etc.). */
  avisosGenerales: string[];
}

interface Props {
  tabla: TablaMiExcel;
  campos: CampoMeta[];
  mapping: Mapping;
  esquema: EsquemaPlantilla;
  modelosDisponibles: Record<string, string[]>;
  vista: 'lista' | 'tarjetas';
  onVista: (v: 'lista' | 'tarjetas') => void;
  revision: RevisionServidor;
  onRevisar: () => void;
  onParche: (clave: string, columna: string, valor: string) => void;
  imagenes: Record<string, Blob>;
  guardadas: Record<string, number>;
  asignaciones: Record<string, string[]>;
  onAsignarFotos: (clave: string, nombres: string[]) => void;
  onCorregir: (clave: string) => void;
  /** Repuestos que el vendedor quitó de esta carga: no se publican. */
  quitados: string[];
  onQuitar: (clave: string) => void;
  onVolverAIncluir: (clave: string) => void;
  onAtras: () => void;
  /**
   * Publica. Recibe los repuestos que no se publicarán (clave -> motivos): los que retiene el
   * panel también, no sólo los que objetó el servidor.
   */
  onPublicar: (retenidos: Record<string, string[]>) => void;
  nombreTienda?: string;
  /** La última revisión del servidor, para decir qué dato exacto impide publicar. */
  servidor?: RevisionServidorFilas | null;
  onParches: (clave: string, valores: Record<string, string>) => void;
  versionesDe: VersionesDe;
  pedirVersiones: (marca: string, modelo: string) => void;
  /** Tienda Fundadora: la calculadora de precio usa su tarifa (5% + IVA). */
  fundador?: boolean;
}

type EstadoFila = 'ok' | 'aviso' | 'error';

/** Un repuesto con datos cambiados después de la última revisión: lo que falta confirmar. */
interface CambioSinConfirmar {
  clave: string;
  nombre: string;
  columnas: string[];
}

/**
 * Qué datos cambió el vendedor desde la última revisión con RepuesTop: se comparan los valores que
 * se revisaron con los de ahora, repuesto por repuesto.
 */
function cambiosDesdeLaRevision(tabla: TablaMiExcel, servidor: RevisionServidorFilas | null | undefined): CambioSinConfirmar[] {
  if (!servidor) return [];
  const indice = new Map(tabla.columnas.map((c, i) => [c, i]));
  const cambios: CambioSinConfirmar[] = [];
  for (const fila of tabla.filas) {
    const antes = servidor.valores[fila.clave];
    if (!antes) continue;
    const columnas = servidor.columnas.filter((col, j) => {
      const i = indice.get(col);
      return i !== undefined && String(fila.valores[i] ?? '').trim() !== String(antes[j] ?? '').trim();
    });
    if (columnas.length > 0) cambios.push({ clave: fila.clave, nombre: fila.nombre || fila.sku || 'Repuesto', columnas });
  }
  return cambios;
}

/** "Cambiaste 3 datos en 2 repuestos", con el detalle de los primeros. */
function ResumenCambios({ cambios, campos, maximo = 4 }: { cambios: CambioSinConfirmar[]; campos: CampoMeta[]; maximo?: number }) {
  if (cambios.length === 0) return null;
  const datos = cambios.reduce((n, c) => n + c.columnas.length, 0);
  return (
    <>
      <p className="mx-cambios-total">
        Cambiaste <b>{plural(datos, 'dato', 'datos')}</b> en <b>{plural(cambios.length, 'repuesto', 'repuestos')}</b>:
      </p>
      <ul className="mx-cambios-lista">
        {cambios.slice(0, maximo).map((c) => (
          <li key={c.clave}><b>{c.nombre}</b>: {c.columnas.map((col) => etiquetaCampo(campos, col)).join(', ')}</li>
        ))}
        {cambios.length > maximo && <li>…y {plural(cambios.length - maximo, 'repuesto más', 'repuestos más')}.</li>}
      </ul>
    </>
  );
}

const POR_PAGINA = { lista: 50, tarjetas: 24 } as const;

interface EstadoConProblemas {
  estado: EstadoFila;
  problemas: ProblemaFila[];
}

/** Cómo queda un repuesto y por qué, dato por dato: lo que ve el panel más lo que objetó el servidor. */
function estadoDe(
  fila: FilaTabla, columnas: string[], campos: CampoMeta[], servidor?: RevisionServidorFilas | null, versionesDe?: VersionesDe,
): EstadoConProblemas {
  const problemas = problemasDeFila(fila, columnas, campos, servidor, versionesDe);
  const estado: EstadoFila = problemas.some((x) => x.severidad === 'error') ? 'error' : problemas.length ? 'aviso' : 'ok';
  // Los que impiden publicar, primero.
  problemas.sort((a, b) => (a.severidad === b.severidad ? 0 : a.severidad === 'error' ? -1 : 1));
  return { estado, problemas };
}

const etiquetaCampo = (campos: CampoMeta[], col: string | null) =>
  (col ? campos.find((c) => c.key === col)?.label ?? col : 'Repuesto');

/** Los problemas de un repuesto como etiquetas "Dato: motivo", en rojo lo que impide publicar. */
function ListaProblemas({ problemas, campos }: { problemas: ProblemaFila[]; campos: CampoMeta[] }) {
  if (problemas.length === 0) return <span className="mx-celda-vacia">—</span>;
  return (
    <ul className="mx-problemas">
      {problemas.map((x, i) => (
        <li key={i} className={x.severidad}>
          <b>{etiquetaCampo(campos, x.columna)}:</b> {x.mensaje}
        </li>
      ))}
    </ul>
  );
}

const ETIQUETA_ESTADO: Record<EstadoFila, string> = { ok: 'Listo para publicar', aviso: 'Se publica (revisa el aviso)', error: 'No se publicará' };
const ETIQUETA_QUITADO = 'Quitado de la carga';

function Estado({ estado, quitado = false }: { estado: EstadoFila; quitado?: boolean }) {
  if (quitado) return <span className="mx-estado quitado"><Trash2 size={14} /> {ETIQUETA_QUITADO}</span>;
  const Icono = estado === 'ok' ? CheckCircle2 : estado === 'aviso' ? AlertTriangle : XCircle;
  return <span className={`mx-estado ${estado}`}><Icono size={14} /> {ETIQUETA_ESTADO[estado]}</span>;
}

/** Un dato de la ficha que se corrige ahí mismo. */
function DatoEditable({
  columna, etiqueta, valor, opciones, onGuardar, children, problema, editando, onEditar, onDejarDeEditar, vehiculo, onGuardarVarios,
  soloLista = false, sinOpciones = null, ayuda,
}: {
  /** Ayuda bajo el campo mientras se edita, calculada con lo que se está escribiendo (la calculadora del precio). */
  ayuda?: (borrador: string) => ReactNode;
  /** Dato de catálogo: se elige de la lista (o se deja en blanco), nunca se escribe. */
  soloLista?: boolean;
  /** Por qué la lista viene vacía. */
  sinOpciones?: string | null;
  /** Año o motor: se elige sólo entre lo que el catálogo tiene para el modelo. */
  vehiculo?: { leer: (col: string) => string; versiones: VersionCatalogo[] | null | undefined; respaldo: string[] };
  onGuardarVarios: (valores: Record<string, string>) => void;
  columna: string; etiqueta: string; valor: string; opciones: string[]; onGuardar: (v: string) => void; children: ReactNode;
  /** El problema de este dato, si lo tiene: se marca en rojo y se dice qué pasa, junto al dato. */
  problema?: ProblemaFila;
  editando: boolean;
  onEditar: () => void;
  onDejarDeEditar: () => void;
}) {
  const [borrador, setBorrador] = useState(valor);
  const [valorPrevio, setValorPrevio] = useState(valor);
  if (valorPrevio !== valor) {
    setValorPrevio(valor);
    setBorrador(valor);
  }
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (editando) ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [editando]);
  const error = opciones.length === 0 && !soloLista && borrador ? validarValorFijo(columna, borrador, etiqueta) : null;
  const motivo = problema && (
    <span className={`mx-dato-motivo ${problema.severidad}`} role="note">
      <AlertTriangle size={12} /> {problema.mensaje}
    </span>
  );
  if (!editando) {
    return (
      <span ref={ref} className={`mx-dato-editable ${problema ? `con-${problema.severidad}` : ''}`} data-campo={columna}>
        {children}
        <button
          type="button"
          className="mx-lapiz"
          onClick={() => { setBorrador(valor); onEditar(); }}
          aria-label={problema ? `Corregir ${etiqueta}` : `Cambiar ${etiqueta}`}
          title={problema ? `Corregir ${etiqueta}: ${problema.mensaje}` : `Cambiar ${etiqueta}`}
        >
          <Pencil size={13} />
        </button>
        {motivo}
      </span>
    );
  }
  const guardar = () => { if (!error) { onGuardar(borrador); onDejarDeEditar(); } };
  if (vehiculo) {
    return (
      <span ref={ref} className={`mx-dato-editando ${problema ? `con-${problema.severidad}` : ''}`} data-campo={columna}>
        <span className="mx-dato-etiqueta">{etiqueta}</span>
        {motivo}
        <SelectVehiculo
          columna={columna}
          valor={valor}
          etiqueta={etiqueta}
          leer={vehiculo.leer}
          versiones={vehiculo.versiones}
          respaldo={vehiculo.respaldo}
          autoFocus
          onElegir={(valores) => { onGuardarVarios(valores); onDejarDeEditar(); }}
        />
        <span className="mx-botonera">
          <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" onClick={onDejarDeEditar}>Cancelar</button>
        </span>
      </span>
    );
  }
  return (
    <span ref={ref} className={`mx-dato-editando ${problema ? `con-${problema.severidad}` : ''}`} data-campo={columna}>
      <span className="mx-dato-etiqueta">{etiqueta}</span>
      {motivo}
      {opciones.length > 0 || soloLista ? (
        <select className="form-control" value={borrador} onChange={(e) => setBorrador(e.target.value)} aria-label={etiqueta} autoFocus>
          <option value="">Dejar en blanco</option>
          {opciones.length === 0 && sinOpciones && <option value="__sin_opciones__" disabled>{sinOpciones}</option>}
          {borrador && !opciones.includes(borrador) && <option value={borrador} disabled={soloLista}>{borrador}{soloLista ? ' (no está en la lista de RepuesTop)' : ''}</option>}
          {opciones.map((o) => <option key={o} value={o}>{etiquetaValor(o)}</option>)}
        </select>
      ) : columna === 'descripcion' ? (
        <textarea className="form-control" rows={4} value={borrador} onChange={(e) => setBorrador(e.target.value)} aria-label={etiqueta} autoFocus maxLength={limiteDeColumna(columna).maxLength} />
      ) : (
        <input className={`form-control ${error ? 'con-error' : ''}`} value={borrador} onChange={(e) => setBorrador(e.target.value)} aria-label={etiqueta} autoFocus maxLength={limiteDeColumna(columna).maxLength} onKeyDown={(e) => { if (e.key === 'Enter') guardar(); }} />
      )}
      {error && <span className="mx-error-texto">{error}</span>}
      {ayuda?.(borrador)}
      <span className="mx-botonera">
        <button type="button" className="btn btn-primary btn-primary-blue mx-btn mx-btn-chico" onClick={guardar} disabled={!!error}>Guardar</button>
        <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" onClick={onDejarDeEditar}>Cancelar</button>
      </span>
    </span>
  );
}

/** "Así se verá en tu tienda": la ficha que ve el comprador, con cada dato corregible. */
function VistaTienda({
  fila, tabla, campos, esquema, modelos, fotos, imagenes, guardadas, estado, onParche, onCambiarFotos, onCerrar, nombreTienda,
  versiones, onParches, cambiosSinConfirmar, onConfirmarCambios, fundador = false, onCorregirEnTabla,
}: {
  fundador?: boolean;
  /** Cierra la ficha y lleva a la fila en la tabla del paso 3. */
  onCorregirEnTabla: () => void;
  /** Hay cambios en la carga que todavía no se revisaron con RepuesTop. */
  cambiosSinConfirmar: boolean;
  /** Cierra la ficha y confirma los cambios (los revisa con RepuesTop). */
  onConfirmarCambios: () => void;
  versiones: VersionCatalogo[] | null | undefined;
  onParches: (valores: Record<string, string>) => void;
  fila: FilaTabla; tabla: TablaMiExcel; campos: CampoMeta[]; esquema: EsquemaPlantilla; modelos: Record<string, string[]>;
  fotos: string[]; imagenes: Record<string, Blob>; guardadas: Record<string, number>; estado: EstadoConProblemas;
  onParche: (col: string, v: string) => void; onCambiarFotos: () => void; onCerrar: () => void; nombreTienda?: string;
}) {
  const [fotoActiva, setFotoActiva] = useState(0);
  // Si el repuesto no se publicará, se abre directo el primer dato que lo impide.
  const [editando, setEditando] = useState<string | null>(
    () => (estado.estado === 'error' ? estado.problemas.find((x) => x.severidad === 'error' && x.columna)?.columna ?? null : null),
  );
  const ficha = fichaDesdeFila(tabla.columnas, fila.valores);
  const problemaDe = (col: string) => {
    const deEse = estado.problemas.filter((x) => x.columna === col);
    return deEse.find((x) => x.severidad === 'error') ?? deEse[0];
  };
  const indice = new Map(tabla.columnas.map((c, i) => [c, i]));
  const leer = (c: string) => String(fila.valores[indice.get(c) ?? -1] ?? '').trim();
  const universal = ['SI', 'SÍ', 'TRUE', '1', 'X'].includes(leer('compatibilidad_general').toUpperCase());
  const contexto: ContextoDeFila = {
    categoria: leer('categoria'), marcaVehiculo: leer('compatibilidad_marca'), anioDesde: leer('anio_desde'), universal,
  };
  const editable = (col: string, hijo: ReactNode, ayuda?: (borrador: string) => ReactNode) => (
    <DatoEditable
      ayuda={ayuda}
      columna={col}
      etiqueta={campos.find((c) => c.key === col)?.label ?? col}
      valor={leer(col)}
      opciones={opcionesDeCelda(col, contexto, esquema, campos, modelos)}
      soloLista={COLUMNAS_DE_CATALOGO.has(col)}
      sinOpciones={motivoSinOpciones(col, contexto, esquema, campos, modelos)}
      onGuardar={(v) => onParche(col, v)}
      onGuardarVarios={onParches}
      vehiculo={COLUMNAS_DE_VERSION.has(col) && !universal
        ? { leer, versiones, respaldo: opcionesDeCelda(col, contexto, esquema, campos, modelos) }
        : undefined}
      problema={problemaDe(col)}
      editando={editando === col}
      onEditar={() => setEditando(col)}
      onDejarDeEditar={() => setEditando((e) => (e === col ? null : e))}
    >
      {hijo}
    </DatoEditable>
  );
  /** Datos con problema que la ficha del comprador no muestra: igual se tienen que poder corregir. */
  const MOSTRADOS = new Set(['nombre_publicado', 'marca_repuesto', 'categoria', 'subcategoria', 'condicion', 'precio', 'tipo_precio',
    'stock', 'compatibilidad_general', 'compatibilidad_marca', 'compatibilidad_modelo', 'anio_desde', 'anio_hasta', 'motor',
    'descripcion', 'sku_proveedor', 'referencia_oem']);
  const otrosConProblema = [...new Set(estado.problemas.map((x) => x.columna).filter((c): c is string => !!c && !MOSTRADOS.has(c)))];
  const principal = fotos[Math.min(fotoActiva, Math.max(0, fotos.length - 1))];
  // La calculadora va con el precio que se muestra; si es "sólo cotizar" no hay precio que calcular.
  const muestraPrecio = (leer('tipo_precio') || 'MOSTRAR_PRECIO').toUpperCase() !== 'SOLO_COTIZAR';
  const calculadora = (valor: string, conAplicar: boolean) => (muestraPrecio ? (
    <CalculadoraPrecio
      precio={normalizarNumero(valor).numero ?? 0}
      fundador={fundador}
      onAplicarSugerido={conAplicar ? (sugerido) => onParche('precio', String(sugerido)) : undefined}
    />
  ) : null);

  return (
    <Modal
      titulo="Así se verá en tu tienda"
      ancho={980}
      onCerrar={onCerrar}
      icono={<Eye size={18} />}
      acciones={cambiosSinConfirmar ? (
        <>
          <span className="mx-nota">Tus cambios ya quedaron guardados. Falta confirmarlos para poder publicarlos.</span>
          <button type="button" className="btn btn-secondary mx-btn" onClick={onCerrar}>Seguir corrigiendo otros</button>
          <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={onConfirmarCambios}>
            <CheckCircle2 size={16} /> Confirmar cambios
          </button>
        </>
      ) : undefined}
    >
      <p className="mx-ayuda">
        Esta es la publicación que verán los compradores. Toca el lápiz <Pencil size={12} /> junto a cualquier dato para corregirlo
        y luego <b>Guardar</b>. Cuando termines, toca <b>Confirmar cambios</b> (abajo) para revisarlos con RepuesTop antes de publicar.
        {' '}
        <button type="button" className="mx-enlace" onClick={onCorregirEnTabla}>
          <Table2 size={13} /> Corregir en la tabla
        </button>
      </p>
      {estado.estado !== 'ok' && (
        <div className={`mx-corregir ${estado.estado}`} role="alert">
          <p>
            <AlertTriangle size={16} />
            {estado.estado === 'error'
              ? <><b>No se publicará</b> hasta que corrijas {estado.problemas.filter((x) => x.severidad === 'error').length === 1 ? 'este dato' : 'estos datos'}. Están marcados en rojo en la ficha:</>
              : <><b>Se publica</b>, pero revisa estos datos (marcados en la ficha):</>}
          </p>
          <ul>
            {estado.problemas.map((x, i) => (
              <li key={i} className={x.severidad}>
                {x.columna ? (
                  <button type="button" className="mx-foco-campo" onClick={() => setEditando(x.columna)}>
                    Corregir {etiquetaCampo(campos, x.columna)}
                  </button>
                ) : <span className="mx-foco-campo sin">Repuesto</span>}
                <span>{x.mensaje}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <article className="mx-tienda">
        <div className="mx-tienda-galeria">
          <div className="mx-tienda-foto">
            {principal
              ? <Miniatura nombre={principal} blob={imagenes[principal]} imagenId={guardadas[principal]} tamano={360} />
              : <span className="mx-tienda-sinfoto"><ImageOff size={40} /> Sin foto</span>}
          </div>
          <div className="mx-tienda-miniaturas">
            {fotos.map((n, i) => (
              <button type="button" key={n} className={i === fotoActiva ? 'activa' : ''} onClick={() => setFotoActiva(i)} aria-label={`Ver foto ${i + 1}`}>
                <Miniatura nombre={n} blob={imagenes[n]} imagenId={guardadas[n]} tamano={56} />
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-secondary mx-btn" onClick={onCambiarFotos}><Images size={15} /> {fotos.length ? 'Cambiar fotos' : 'Agregar fotos'}</button>
        </div>
        <div className="mx-tienda-datos">
          {nombreTienda && <span className="mx-tienda-vendedor">Vendido por {nombreTienda}</span>}
          <h2>{editable('nombre_publicado', ficha.nombre)}</h2>
          <div className="mx-tienda-chips">
            {editable('marca_repuesto', <span className="mx-chip">{ficha.marca || 'Sin marca'}</span>)}
            {editable('categoria', <span className="mx-chip alt">{ficha.categoria || 'Sin categoría'}</span>)}
            {editable('subcategoria', <span className="mx-chip alt">{ficha.subcategoria || 'Sin subcategoría'}</span>)}
            {editable('condicion', <span className="mx-chip cond">{ficha.condicion}</span>)}
          </div>
          <div className="mx-tienda-precio">{editable('precio', ficha.precio, (borrador) => calculadora(borrador, false))}</div>
          {editando !== 'precio' && calculadora(leer('precio'), true)}
          <p className="mx-tienda-linea">Tipo de precio: {editable('tipo_precio', etiquetaValor(leer('tipo_precio') || 'MOSTRAR_PRECIO'))}</p>
          <p className="mx-tienda-linea">{editable('stock', ficha.stock ? `${ficha.stock} disponibles` : 'Sin stock')}</p>
          <section className="mx-tienda-bloque">
            <h4>Compatibilidad</h4>
            <p>{ficha.compatibilidad}</p>
            <div className="mx-tienda-compat">
              {editable('compatibilidad_general', <>Universal: {etiquetaValor(leer('compatibilidad_general') || 'NO')}</>)}
              {editable('compatibilidad_marca', <>Marca: {leer('compatibilidad_marca') || '—'}</>)}
              {editable('compatibilidad_modelo', <>Modelo: {leer('compatibilidad_modelo') || '—'}</>)}
              {editable('anio_desde', <>Desde: {leer('anio_desde') || '—'}</>)}
              {editable('anio_hasta', <>Hasta: {leer('anio_hasta') || '—'}</>)}
              {editable('motor', <>Motor: {leer('motor') || '—'}</>)}
            </div>
          </section>
          <section className="mx-tienda-bloque">
            <h4>Descripción</h4>
            {editable('descripcion', <p className="mx-tienda-descripcion">{ficha.descripcion || 'Sin descripción'}</p>)}
          </section>
          <p className="mx-tienda-meta">
            Código {editable('sku_proveedor', ficha.sku || '—')} · OEM {editable('referencia_oem', leer('referencia_oem') || '—')}
          </p>
          {otrosConProblema.length > 0 && (
            <section className="mx-tienda-bloque">
              <h4>Otros datos por corregir</h4>
              <div className="mx-tienda-compat">
                {otrosConProblema.map((col) => (
                  <span key={col}>{editable(col, <>{etiquetaCampo(campos, col)}: {etiquetaValor(leer(col)) || '—'}</>)}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      </article>
    </Modal>
  );
}

export function PasoVistaPrevia(p: Props) {
  const [pagina, setPagina] = useState(1);
  const [filtroElegido, setFiltro] = useState<'todas' | EstadoFila | 'quitados'>('todas');
  const [enTienda, setEnTienda] = useState<string | null>(null);
  const [fotosDe, setFotosDe] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [aQuitar, setAQuitar] = useState<FilaTabla | null>(null);
  /** Publicar con cambios sin confirmar: primero se pide confirmarlos. */
  const [pedirConfirmarAntesDePublicar, setPedirConfirmarAntesDePublicar] = useState(false);
  /** Se confirmaron los cambios y, apenas termine la revisión, se sigue a publicar. */
  const [publicarAlConfirmar, setPublicarAlConfirmar] = useState(false);
  /** El vendedor confirmó sus cambios: se le dice que quedaron confirmados hasta que vuelva a cambiar algo. */
  const [confirmacion, setConfirmacion] = useState<'confirmando' | 'confirmada' | null>(null);

  const todas = useMemo(
    () => p.tabla.filas.map((fila) => ({ fila, ...estadoDe(fila, p.tabla.columnas, p.campos, p.servidor, p.versionesDe) })),
    [p.tabla.filas, p.tabla.columnas, p.campos, p.servidor, p.versionesDe],
  );
  // Lo quitado no cuenta para publicar: queda aparte, en "Quitados", para volver a incluirlo.
  const quitadosSet = useMemo(() => new Set(p.quitados), [p.quitados]);
  const conEstado = useMemo(() => todas.filter((x) => !quitadosSet.has(x.fila.clave)), [todas, quitadosSet]);
  const quitadas = useMemo(() => todas.filter((x) => quitadosSet.has(x.fila.clave)), [todas, quitadosSet]);
  // Si vuelve a incluir el último quitado, se vuelve a ver todo.
  const filtro = filtroElegido === 'quitados' && quitadas.length === 0 ? 'todas' : filtroElegido;
  // Las versiones de cada modelo: con ellas se sabe de antemano qué años y motores acepta el catálogo.
  const { pedirVersiones } = p;
  useEffect(() => {
    const iMarca = p.tabla.columnas.indexOf('compatibilidad_marca');
    const iModelo = p.tabla.columnas.indexOf('compatibilidad_modelo');
    if (iMarca < 0 || iModelo < 0) return;
    for (const f of p.tabla.filas) pedirVersiones(String(f.valores[iMarca] ?? ''), String(f.valores[iModelo] ?? ''));
  }, [p.tabla, pedirVersiones]);
  const cuenta = { ok: 0, aviso: 0, error: 0 } as Record<EstadoFila, number>;
  conEstado.forEach((x) => { cuenta[x.estado] += 1; });
  const publicables = cuenta.ok + cuenta.aviso;
  const conFotos = conEstado.filter((x) => x.estado !== 'error' && (p.asignaciones[x.fila.clave] ?? []).length > 0).length;
  const filtradas = filtro === 'quitados' ? quitadas : filtro === 'todas' ? conEstado : conEstado.filter((x) => x.estado === filtro);
  const tam = POR_PAGINA[p.vista];
  const paginas = Math.max(1, Math.ceil(filtradas.length / tam));
  const actual = Math.min(pagina, paginas);
  const visibles = filtradas.slice((actual - 1) * tam, actual * tam);
  const indice = new Map(p.tabla.columnas.map((c, i) => [c, i]));
  const leer = (fila: FilaTabla, c: string) => String(fila.valores[indice.get(c) ?? -1] ?? '').trim();
  const fundador = p.fundador === true;
  /** Precio a mostrar de la fila; null si es "sólo cotizar" o no es un número. */
  const precioDe = (fila: FilaTabla): number | null => (
    (leer(fila, 'tipo_precio') || 'MOSTRAR_PRECIO').toUpperCase() === 'SOLO_COTIZAR' ? null : normalizarNumero(leer(fila, 'precio')).numero
  );
  const puedePublicar = p.revision.estado === 'lista' && publicables > 0;
  const hayCambiosSinConfirmar = p.revision.estado === 'desactualizada';
  const cambios = useMemo(
    () => (hayCambiosSinConfirmar ? cambiosDesdeLaRevision(p.tabla, p.servidor) : []),
    [hayCambiosSinConfirmar, p.tabla, p.servidor],
  );
  /** Con cambios sin confirmar el botón Publicar sigue activo: al tocarlo se pide confirmarlos primero. */
  const publicarActivo = puedePublicar || (hayCambiosSinConfirmar && conEstado.length > 0);
  const confirmarCambios = () => {
    setConfirmacion('confirmando');
    p.onRevisar();
  };
  // Cómo terminó la confirmación: bien (se avisa y, si venía de "Publicar", se sigue a publicar) o con error.
  const estadoRevision = p.revision.estado;
  const [estadoAnterior, setEstadoAnterior] = useState(estadoRevision);
  if (estadoAnterior !== estadoRevision) {
    setEstadoAnterior(estadoRevision);
    if (estadoRevision === 'lista' && confirmacion === 'confirmando') {
      setConfirmacion('confirmada');
      if (publicarAlConfirmar) {
        setPublicarAlConfirmar(false);
        setPedirConfirmarAntesDePublicar(false);
        if (publicables > 0) setConfirmar(true);
      }
    } else if (estadoRevision === 'error') {
      setConfirmacion(null);
      setPublicarAlConfirmar(false);
    } else if (estadoRevision === 'desactualizada') {
      setConfirmacion(null);
    }
  }
  const motivoNoPublica = (() => {
    switch (p.revision.estado) {
      case 'revisando': return 'Estamos revisando tu inventario con RepuesTop…';
      case 'error': return 'No pudimos revisar tu inventario: toca «Reintentar» arriba.';
      case 'sin-revisar': return 'Primero revisamos tu inventario: toca «Revisar ahora» arriba.';
      case 'desactualizada': return 'Tienes cambios sin confirmar: toca «Confirmar cambios» arriba.';
      default:
        if (conEstado.length === 0) return 'Quitaste todos los repuestos de esta carga: vuelve a incluir alguno desde «Quitados».';
        return 'Ningún repuesto se puede publicar todavía: corrige los que dicen «No se publicará» (toca el lápiz de cada uno).';
    }
  })();
  const filaTienda = enTienda ? todas.find((x) => x.fila.clave === enTienda) : null;
  const fichaAQuitar = aQuitar ? fichaDesdeFila(p.tabla.columnas, aQuitar.valores) : null;
  const filaFotos = fotosDe ? p.tabla.filas.find((f) => f.clave === fotosDe) : null;

  return (
    <div className="mx-paso">
      <div className="mx-explica">
        <Info size={18} />
        <p>
          Así van a quedar publicados tus repuestos. Cambia entre <b>lista</b> y <b>cuadrícula</b>; en la cuadrícula, el ojo
          <Eye size={13} /> te muestra la publicación <b>como la verá un comprador en tu tienda</b> y ahí puedes corregir cualquier dato.
          Cuando esté todo como quieres, publica.
        </p>
      </div>

      <section className={`mx-tarjeta mx-revision mx-revision-${p.revision.estado}`}>
        {p.revision.estado === 'revisando' && (
          <p><Loader2 size={18} className="mx-girando" /> <b>Revisando tu inventario con RepuesTop…</b> Esto puede tardar un poco con archivos grandes.</p>
        )}
        {p.revision.estado === 'revisando' && confirmacion === 'confirmando' && (
          <p className="mx-nota">Estamos confirmando tus cambios: los revisamos con RepuesTop para decirte qué se puede publicar.</p>
        )}
        {p.revision.estado === 'lista' && (
          <>
            {confirmacion === 'confirmada' && (
              <p className="mx-cambios-confirmados" role="status">
                <CheckCircle2 size={18} /> <b>¡Listo! Tus cambios quedaron confirmados.</b>
              </p>
            )}
            <p>
              <ShieldCheck size={18} /> <b>Revisamos tu inventario:</b> {plural(publicables, 'repuesto se puede publicar', 'repuestos se pueden publicar')}
              {cuenta.error > 0 ? ` y ${plural(cuenta.error, 'no se publicará', 'no se publicarán')} hasta que lo corrijas` : ''}.
            </p>
          </>
        )}
        {p.revision.estado === 'desactualizada' && (
          <div className="mx-cambios-pendientes" role="alert">
            <div className="mx-cambios-cabecera">
              <RefreshCw size={20} />
              <div>
                <h4>Tienes cambios sin confirmar</h4>
                <p>
                  Tus cambios ya quedaron guardados en tu carga, pero todavía no los revisamos con RepuesTop. Toca
                  {' '}<b>Confirmar cambios</b> para revisarlos y ver si ya se pueden publicar.
                </p>
              </div>
            </div>
            <ResumenCambios cambios={cambios} campos={p.campos} />
            <button type="button" className="btn btn-primary btn-primary-blue mx-btn mx-btn-confirmar" onClick={confirmarCambios}>
              <CheckCircle2 size={17} /> Confirmar cambios
            </button>
          </div>
        )}
        {p.revision.estado === 'sin-revisar' && (
          <p>
            <ShieldCheck size={18} /> Antes de publicar revisamos tu inventario con RepuesTop.{' '}
            <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" onClick={p.onRevisar}>Revisar ahora</button>
          </p>
        )}
        {p.revision.estado === 'error' && (
          <p>
            <AlertTriangle size={18} /> {p.revision.error ?? 'No pudimos revisar tu inventario.'}{' '}
            <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" onClick={p.onRevisar}>Reintentar</button>
          </p>
        )}
        {p.revision.avisosGenerales.length > 0 && p.revision.estado === 'lista' && (
          <ul className="mx-avisos-generales">{p.revision.avisosGenerales.map((a) => <li key={a}>{a}</li>)}</ul>
        )}
      </section>

      <div className="mx-herramientas">
        <div className="mx-segmentado" role="group" aria-label="Filtrar por estado">
          {([
            ['todas', `Todos (${conEstado.length.toLocaleString('es-CL')})`],
            ['ok', `Listos (${cuenta.ok.toLocaleString('es-CL')})`],
            ['aviso', `Con aviso (${cuenta.aviso.toLocaleString('es-CL')})`],
            ['error', `No se publicarán (${cuenta.error.toLocaleString('es-CL')})`],
            ...(quitadas.length > 0 ? [['quitados', `Quitados (${quitadas.length.toLocaleString('es-CL')})`]] : []),
          ] as ['todas' | EstadoFila | 'quitados', string][]).map(([v, t]) => (
            <button key={v} type="button" className={filtro === v ? 'activo' : ''} aria-pressed={filtro === v} onClick={() => { setFiltro(v); setPagina(1); }}>{t}</button>
          ))}
        </div>
        <span className="mx-separador" />
        <div className="inventory-view-switch" role="group" aria-label="Cambiar vista">
          <button type="button" className={p.vista === 'lista' ? 'active' : ''} aria-pressed={p.vista === 'lista'} onClick={() => { p.onVista('lista'); setPagina(1); }}><List size={17} /> Lista</button>
          <button type="button" className={p.vista === 'tarjetas' ? 'active' : ''} aria-pressed={p.vista === 'tarjetas'} onClick={() => { p.onVista('tarjetas'); setPagina(1); }}><Grid2X2 size={17} /> Cuadrícula</button>
        </div>
      </div>

      {p.vista === 'lista' ? (
        <div className="mx-tabla-wrap">
          <table className="mx-tabla mx-tabla-lista">
            <thead>
              <tr>
                <th>Estado</th><th>Foto</th><th>Código</th><th>Nombre</th><th>Categoría</th><th>Marca</th><th>Precio</th><th>Stock</th><th>Vehículo</th><th>Qué pasa</th><th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {visibles.map(({ fila, estado, problemas }) => {
                const ficha = fichaDesdeFila(p.tabla.columnas, fila.valores);
                const fotos = p.asignaciones[fila.clave] ?? [];
                const quitado = quitadosSet.has(fila.clave);
                return (
                  <tr key={fila.clave} className={quitado ? 'quitado' : estado === 'error' ? 'con-error' : ''}>
                    <td><Estado estado={estado} quitado={quitado} /></td>
                    <td>{fotos[0] ? <Miniatura nombre={fotos[0]} blob={p.imagenes[fotos[0]]} imagenId={p.guardadas[fotos[0]]} tamano={40} /> : <span className="mx-celda-vacia">—</span>}</td>
                    <td>{ficha.sku || '—'}</td>
                    <td className="mx-td-nombre">{ficha.nombre}</td>
                    <td>{[ficha.categoria, ficha.subcategoria].filter(Boolean).join(' › ') || '—'}</td>
                    <td>{ficha.marca || '—'}</td>
                    <td>
                      {ficha.precio}
                      {liquidoDe(precioDe(fila), fundador) && <span className="mx-recibes">Recibes {liquidoDe(precioDe(fila), fundador)}</span>}
                    </td>
                    <td>{leer(fila, 'stock') || '—'}</td>
                    <td className="mx-td-compat">{ficha.compatibilidad}</td>
                    <td className="mx-td-motivo">{quitado ? <span className="mx-celda-vacia">No se publicará: lo quitaste de esta carga.</span> : <ListaProblemas problemas={problemas} campos={p.campos} />}</td>
                    <td className="mx-td-acciones">
                      {quitado ? (
                        <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" onClick={() => p.onVolverAIncluir(fila.clave)} aria-label={`Volver a incluir ${ficha.nombre}`}><Undo2 size={15} /> Volver a incluir</button>
                      ) : (
                        <>
                          <button type="button" className="mx-icono-btn" onClick={() => setEnTienda(fila.clave)} aria-label={`Ver ${ficha.nombre} como en tu tienda`} title="Ver como en tu tienda"><Eye size={16} /></button>
                          <button type="button" className="mx-icono-btn" onClick={() => setEnTienda(fila.clave)} aria-label={`Editar ${ficha.nombre}`} title="Editar"><Pencil size={16} /></button>
                          <button type="button" className="mx-icono-btn mx-icono-peligro" onClick={() => setAQuitar(fila)} aria-label={`Quitar ${ficha.nombre} de la carga`} title="Quitar de la carga"><Trash2 size={16} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="inventory-grid mx-grilla" aria-label="Tus repuestos en cuadrícula">
          {visibles.map(({ fila, estado, problemas }) => {
            const ficha = fichaDesdeFila(p.tabla.columnas, fila.valores);
            const fotos = p.asignaciones[fila.clave] ?? [];
            const quitado = quitadosSet.has(fila.clave);
            return (
              <article key={fila.clave} className={`inventory-grid-card mx-card ${quitado ? 'quitado' : estado}`}>
                <div className="inventory-grid-image mx-card-imagen">
                  {fotos[0]
                    ? <Miniatura nombre={fotos[0]} blob={p.imagenes[fotos[0]]} imagenId={p.guardadas[fotos[0]]} tamano={220} />
                    : <span className="mx-tienda-sinfoto"><ImageOff size={30} /> Sin foto</span>}
                  <span className={`mx-card-estado ${quitado ? 'quitado' : estado}`}>{quitado ? ETIQUETA_QUITADO : ETIQUETA_ESTADO[estado]}</span>
                </div>
                <div className="inventory-grid-content">
                  <span className="grid-sku">SKU {ficha.sku || '—'}</span>
                  <h3 title={ficha.nombre}>{ficha.nombre}</h3>
                  <div className="grid-details">
                    <span>{leer(fila, 'stock') ? `${leer(fila, 'stock')} unidades` : 'Sin stock'}</span>
                    <strong>{ficha.precio}</strong>
                  </div>
                  {liquidoDe(precioDe(fila), fundador) && (
                    <span className="mx-recibes">Recibes {liquidoDe(precioDe(fila), fundador)} líquido</span>
                  )}
                  {estado !== 'ok' && !quitado && (
                    <button type="button" className={`mx-card-corregir ${estado}`} onClick={() => setEnTienda(fila.clave)}>
                      <AlertTriangle size={13} />
                      <span>
                        {estado === 'error' ? 'Corrige: ' : 'Revisa: '}
                        <b>{[...new Set(problemas.filter((x) => x.severidad === estado).map((x) => etiquetaCampo(p.campos, x.columna)))].join(', ')}</b>
                      </span>
                    </button>
                  )}
                </div>
                {quitado ? (
                  <footer className="inventory-grid-actions mx-card-acciones-quitado">
                    <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" onClick={() => p.onVolverAIncluir(fila.clave)} aria-label={`Volver a incluir ${ficha.nombre}`}><Undo2 size={15} /> Volver a incluir</button>
                  </footer>
                ) : (
                  <footer className="inventory-grid-actions">
                    <button type="button" className="grid-action" onClick={() => setEnTienda(fila.clave)} title="Ver cómo se verá en tu tienda" aria-label={`Ver ${ficha.nombre} como en tu tienda`}><Eye size={16} /></button>
                    <button type="button" className="grid-action" onClick={() => setFotosDe(fila.clave)} title="Elegir fotos" aria-label={`Fotos de ${ficha.nombre}`}><Images size={16} /></button>
                    <button type="button" className="grid-action" onClick={() => setEnTienda(fila.clave)} title="Editar" aria-label={`Editar ${ficha.nombre}`}><Pencil size={16} /></button>
                    <button type="button" className="grid-action grid-action-danger" onClick={() => setAQuitar(fila)} title="Quitar de la carga" aria-label={`Quitar ${ficha.nombre} de la carga`}><Trash2 size={16} /></button>
                  </footer>
                )}
              </article>
            );
          })}
        </div>
      )}

      {paginas > 1 && (
        <div className="mx-paginado">
          <button type="button" className="btn btn-secondary mx-btn" disabled={actual <= 1} onClick={() => setPagina(actual - 1)}>Anteriores</button>
          <span>Página {actual} de {paginas}</span>
          <button type="button" className="btn btn-secondary mx-btn" disabled={actual >= paginas} onClick={() => setPagina(actual + 1)}>Siguientes</button>
        </div>
      )}

      <footer className="mx-pie">
        <button type="button" className="btn btn-secondary mx-btn" onClick={p.onAtras}><ArrowLeft size={16} /> Atrás</button>
        {/* Si no se puede publicar, se dice por qué al lado del botón: un botón apagado sin
            explicación deja al vendedor sin saber cómo seguir. */}
        {!puedePublicar && <span className="mx-pie-motivo" role="status">{motivoNoPublica}</span>}
        <button
          type="button"
          className="btn btn-primary btn-primary-blue mx-btn mx-btn-publicar"
          onClick={() => (hayCambiosSinConfirmar ? setPedirConfirmarAntesDePublicar(true) : setConfirmar(true))}
          disabled={!publicarActivo}
          title={!publicarActivo ? motivoNoPublica : undefined}
        >
          <Rocket size={17} /> Publicar {plural(publicables, 'repuesto', 'repuestos')}
        </button>
      </footer>

      {pedirConfirmarAntesDePublicar && (
        <Modal
          titulo="Antes de publicar, confirma tus cambios"
          icono={<RefreshCw size={18} />}
          tono="aviso"
          ancho={600}
          onCerrar={p.revision.estado === 'revisando' ? undefined : () => { setPedirConfirmarAntesDePublicar(false); setPublicarAlConfirmar(false); }}
          acciones={p.revision.estado === 'revisando' ? (
            <span className="mx-nota"><Loader2 size={15} className="mx-girando" /> Confirmando tus cambios con RepuesTop…</span>
          ) : (
            <>
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => setPedirConfirmarAntesDePublicar(false)}>Volver a revisar</button>
              <button
                type="button"
                className="btn btn-primary btn-primary-blue mx-btn"
                onClick={() => { setPublicarAlConfirmar(true); confirmarCambios(); }}
                autoFocus
              >
                <CheckCircle2 size={16} /> Confirmar cambios y publicar
              </button>
            </>
          )}
        >
          <p>
            Hiciste cambios después de la última revisión. Antes de publicar tenemos que <b>confirmarlos</b>: los revisamos con RepuesTop
            para asegurarnos de que se van a publicar bien.
          </p>
          <ResumenCambios cambios={cambios} campos={p.campos} />
          {p.revision.estado === 'error' && (
            <div className="mx-alerta error"><AlertTriangle size={16} /> {p.revision.error ?? 'No pudimos confirmar tus cambios.'} Intenta de nuevo.</div>
          )}
          <p className="mx-nota">Después de confirmar te mostramos cuántos repuestos se publicarán y te preguntamos una última vez.</p>
        </Modal>
      )}

      {confirmar && (
        <Modal
          titulo="¿Publicar tu inventario?"
          icono={<Rocket size={18} />}
          onCerrar={() => setConfirmar(false)}
          acciones={(
            <>
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => setConfirmar(false)}>Todavía no</button>
              <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={() => {
                setConfirmar(false);
                p.onPublicar(Object.fromEntries(conEstado
                  .filter((x) => x.estado === 'error')
                  .map((x) => [x.fila.clave, x.problemas.filter((pr) => pr.severidad === 'error').map((pr) => pr.mensaje)])));
              }}>Sí, publicar</button>
            </>
          )}
        >
          <ul className="mx-lista-confirmar">
            {confirmacion === 'confirmada' && <li><CheckCircle2 size={16} /> <b>Tus cambios quedaron confirmados.</b></li>}
            <li><CheckCircle2 size={16} /> Se publicarán <b>{plural(publicables, 'repuesto', 'repuestos')}</b> ({plural(conFotos, 'con foto', 'con foto')}).</li>
            {cuenta.error > 0 && <li><XCircle size={16} /> <b>{plural(cuenta.error, 'repuesto no se publicará', 'repuestos no se publicarán')}</b> porque tienen algo por corregir. Podrás cargarlos después.</li>}
            {quitadas.length > 0 && <li><Trash2 size={16} /> <b>{plural(quitadas.length, 'repuesto que quitaste', 'repuestos que quitaste')}</b> no se {quitadas.length === 1 ? 'publicará' : 'publicarán'}.</li>}
            <li><ShieldCheck size={16} /> Aparecerán en la web y en la app de RepuesTop. Después puedes editarlos desde tu Inventario.</li>
          </ul>
        </Modal>
      )}

      {aQuitar && fichaAQuitar && (
        <Modal
          titulo="¿Quitar este repuesto de la carga?"
          icono={<Trash2 size={18} />}
          tono="peligro"
          onCerrar={() => setAQuitar(null)}
          acciones={(
            <>
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => setAQuitar(null)}>No, dejarlo</button>
              <button type="button" className="btn btn-secondary mx-btn mx-btn-peligro" onClick={() => { p.onQuitar(aQuitar.clave); setAQuitar(null); }}>
                <Trash2 size={15} /> Sí, quitarlo
              </button>
            </>
          )}
        >
          <p>
            <b>{fichaAQuitar.nombre || 'Este repuesto'}</b>
            {fichaAQuitar.sku ? ` (código ${fichaAQuitar.sku})` : ''} no se publicará con esta carga.
          </p>
          <p>Tu Excel no cambia. Si te arrepientes, lo vuelves a incluir desde <b>«Quitados»</b>, arriba de la lista.</p>
        </Modal>
      )}

      {filaTienda && (
        <VistaTienda
          fila={filaTienda.fila}
          tabla={p.tabla}
          campos={p.campos}
          esquema={p.esquema}
          modelos={p.modelosDisponibles}
          fotos={p.asignaciones[filaTienda.fila.clave] ?? []}
          imagenes={p.imagenes}
          guardadas={p.guardadas}
          key={filaTienda.fila.clave}
          estado={{ estado: filaTienda.estado, problemas: filaTienda.problemas }}
          onParche={(col, v) => p.onParche(filaTienda.fila.clave, col, v)}
          onParches={(valores) => p.onParches(filaTienda.fila.clave, valores)}
          versiones={p.versionesDe(
            String(filaTienda.fila.valores[p.tabla.columnas.indexOf('compatibilidad_marca')] ?? ''),
            String(filaTienda.fila.valores[p.tabla.columnas.indexOf('compatibilidad_modelo')] ?? ''),
          )}
          onCambiarFotos={() => setFotosDe(filaTienda.fila.clave)}
          onCerrar={() => setEnTienda(null)}
          cambiosSinConfirmar={hayCambiosSinConfirmar}
          onConfirmarCambios={() => { setEnTienda(null); confirmarCambios(); }}
          nombreTienda={p.nombreTienda}
          fundador={fundador}
          onCorregirEnTabla={() => { const clave = filaTienda.fila.clave; setEnTienda(null); p.onCorregir(clave); }}
        />
      )}
      {filaFotos && (
        <SelectorFotos
          titulo={`Fotos de ${filaFotos.nombre || 'este repuesto'}`}
          imagenes={p.imagenes}
          guardadas={p.guardadas}
          seleccion={p.asignaciones[filaFotos.clave] ?? []}
          onCerrar={() => setFotosDe(null)}
          onListo={(sel) => { p.onAsignarFotos(filaFotos.clave, sel); setFotosDe(null); }}
        />
      )}
    </div>
  );
}

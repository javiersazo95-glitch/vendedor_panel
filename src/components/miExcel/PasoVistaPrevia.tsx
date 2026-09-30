/**
 * Etapa 4 · Vista previa y publica. Muestra cada repuesto como va a quedar publicado, en dos
 * vistas: lista (tabla) y cuadrícula (tarjetas, como el menú Inventario). Desde una tarjeta, el ojo
 * abre "Así se verá en tu tienda" -la ficha que ve el comprador- y ahí mismo se puede corregir cada
 * dato. Antes de publicar se revisa el archivo con el servidor, para que el vendedor sepa exactamente
 * qué se va a publicar y qué no.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Eye, Info, Grid2X2, ImageOff, Images, List, Loader2, Pencil,
  RefreshCw, Rocket, ShieldCheck, XCircle,
} from 'lucide-react';
import { etiquetaValor, type CampoMeta, type EsquemaPlantilla, type Mapping } from '../../utils/plantillaMapping';
import { fichaDesdeFila } from '../../utils/plantillaRevision';
import { opcionesDeCelda, type ContextoDeFila } from '../../utils/miExcelDetecciones';
import type { FilaTabla, TablaMiExcel } from '../../utils/miExcelTabla';
import type { FilaResultado } from '../../utils/cargaExcelApi';
import { validarValorFijo, limiteDeColumna } from '../../utils/plantillaNormalizacion';
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
  onAtras: () => void;
  onPublicar: () => void;
  nombreTienda?: string;
}

type EstadoFila = 'ok' | 'aviso' | 'error';

const POR_PAGINA = { lista: 50, tarjetas: 24 } as const;

function estadoDe(fila: FilaTabla, revision: RevisionServidor): { estado: EstadoFila; mensajes: string[] } {
  const delServidor = revision.estado === 'lista' ? revision.porClave[fila.clave] : undefined;
  if (delServidor) {
    return {
      estado: delServidor.estado === 'ERROR' ? 'error' : delServidor.estado === 'ADVERTENCIA' ? 'aviso' : 'ok',
      mensajes: delServidor.mensajes,
    };
  }
  return {
    estado: fila.tieneError ? 'error' : fila.problemas.length ? 'aviso' : 'ok',
    mensajes: fila.problemas.map((x) => x.mensaje),
  };
}

const ETIQUETA_ESTADO: Record<EstadoFila, string> = { ok: 'Listo para publicar', aviso: 'Se publica (revisa el aviso)', error: 'No se publicará' };

function Estado({ estado }: { estado: EstadoFila }) {
  const Icono = estado === 'ok' ? CheckCircle2 : estado === 'aviso' ? AlertTriangle : XCircle;
  return <span className={`mx-estado ${estado}`}><Icono size={14} /> {ETIQUETA_ESTADO[estado]}</span>;
}

/** Un dato de la ficha que se corrige ahí mismo. */
function DatoEditable({
  columna, etiqueta, valor, opciones, onGuardar, children,
}: {
  columna: string; etiqueta: string; valor: string; opciones: string[]; onGuardar: (v: string) => void; children: ReactNode;
}) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(valor);
  const error = opciones.length === 0 && borrador ? validarValorFijo(columna, borrador, etiqueta) : null;
  if (!editando) {
    return (
      <span className="mx-dato-editable">
        {children}
        <button type="button" className="mx-lapiz" onClick={() => { setBorrador(valor); setEditando(true); }} aria-label={`Cambiar ${etiqueta}`} title={`Cambiar ${etiqueta}`}>
          <Pencil size={13} />
        </button>
      </span>
    );
  }
  const guardar = () => { if (!error) { onGuardar(borrador); setEditando(false); } };
  return (
    <span className="mx-dato-editando">
      {opciones.length > 0 ? (
        <select className="form-control" value={borrador} onChange={(e) => setBorrador(e.target.value)} aria-label={etiqueta} autoFocus>
          <option value="">— sin dato —</option>
          {borrador && !opciones.includes(borrador) && <option value={borrador}>{borrador}</option>}
          {opciones.map((o) => <option key={o} value={o}>{etiquetaValor(o)}</option>)}
        </select>
      ) : columna === 'descripcion' ? (
        <textarea className="form-control" rows={4} value={borrador} onChange={(e) => setBorrador(e.target.value)} aria-label={etiqueta} autoFocus maxLength={limiteDeColumna(columna).maxLength} />
      ) : (
        <input className={`form-control ${error ? 'con-error' : ''}`} value={borrador} onChange={(e) => setBorrador(e.target.value)} aria-label={etiqueta} autoFocus maxLength={limiteDeColumna(columna).maxLength} onKeyDown={(e) => { if (e.key === 'Enter') guardar(); }} />
      )}
      {error && <span className="mx-error-texto">{error}</span>}
      <span className="mx-botonera">
        <button type="button" className="btn btn-primary btn-primary-blue mx-btn mx-btn-chico" onClick={guardar} disabled={!!error}>Guardar</button>
        <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" onClick={() => setEditando(false)}>Cancelar</button>
      </span>
    </span>
  );
}

/** "Así se verá en tu tienda": la ficha que ve el comprador, con cada dato corregible. */
function VistaTienda({
  fila, tabla, campos, esquema, modelos, fotos, imagenes, guardadas, estado, onParche, onCambiarFotos, onCerrar, nombreTienda,
}: {
  fila: FilaTabla; tabla: TablaMiExcel; campos: CampoMeta[]; esquema: EsquemaPlantilla; modelos: Record<string, string[]>;
  fotos: string[]; imagenes: Record<string, Blob>; guardadas: Record<string, number>; estado: { estado: EstadoFila; mensajes: string[] };
  onParche: (col: string, v: string) => void; onCambiarFotos: () => void; onCerrar: () => void; nombreTienda?: string;
}) {
  const [fotoActiva, setFotoActiva] = useState(0);
  const ficha = fichaDesdeFila(tabla.columnas, fila.valores);
  const indice = new Map(tabla.columnas.map((c, i) => [c, i]));
  const leer = (c: string) => String(fila.valores[indice.get(c) ?? -1] ?? '').trim();
  const contexto: ContextoDeFila = { categoria: leer('categoria'), marcaVehiculo: leer('compatibilidad_marca'), anioDesde: leer('anio_desde') };
  const editable = (col: string, hijo: ReactNode) => (
    <DatoEditable
      columna={col}
      etiqueta={campos.find((c) => c.key === col)?.label ?? col}
      valor={leer(col)}
      opciones={opcionesDeCelda(col, contexto, esquema, campos, modelos)}
      onGuardar={(v) => onParche(col, v)}
    >
      {hijo}
    </DatoEditable>
  );
  const principal = fotos[Math.min(fotoActiva, Math.max(0, fotos.length - 1))];

  return (
    <Modal titulo="Así se verá en tu tienda" ancho={980} onCerrar={onCerrar} icono={<Eye size={18} />}>
      <p className="mx-ayuda">
        Esta es la publicación que verán los compradores. Toca el lápiz <Pencil size={12} /> junto a cualquier dato para corregirlo;
        el cambio queda en tu carga.
      </p>
      {estado.estado !== 'ok' && (
        <div className={`mx-alerta ${estado.estado === 'error' ? 'error' : 'aviso'}`}>
          <AlertTriangle size={16} />
          <span><b>{ETIQUETA_ESTADO[estado.estado]}.</b> {estado.mensajes.join(' ')}</span>
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
          <div className="mx-tienda-precio">{editable('precio', ficha.precio)}</div>
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
        </div>
      </article>
    </Modal>
  );
}

export function PasoVistaPrevia(p: Props) {
  const [pagina, setPagina] = useState(1);
  const [filtro, setFiltro] = useState<'todas' | EstadoFila>('todas');
  const [enTienda, setEnTienda] = useState<string | null>(null);
  const [fotosDe, setFotosDe] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  const conEstado = useMemo(
    () => p.tabla.filas.map((fila) => ({ fila, ...estadoDe(fila, p.revision) })),
    [p.tabla.filas, p.revision],
  );
  const cuenta = { ok: 0, aviso: 0, error: 0 } as Record<EstadoFila, number>;
  conEstado.forEach((x) => { cuenta[x.estado] += 1; });
  const publicables = cuenta.ok + cuenta.aviso;
  const conFotos = conEstado.filter((x) => x.estado !== 'error' && (p.asignaciones[x.fila.clave] ?? []).length > 0).length;
  const filtradas = filtro === 'todas' ? conEstado : conEstado.filter((x) => x.estado === filtro);
  const tam = POR_PAGINA[p.vista];
  const paginas = Math.max(1, Math.ceil(filtradas.length / tam));
  const actual = Math.min(pagina, paginas);
  const visibles = filtradas.slice((actual - 1) * tam, actual * tam);
  const indice = new Map(p.tabla.columnas.map((c, i) => [c, i]));
  const leer = (fila: FilaTabla, c: string) => String(fila.valores[indice.get(c) ?? -1] ?? '').trim();
  const puedePublicar = p.revision.estado === 'lista' && publicables > 0;
  const filaTienda = enTienda ? conEstado.find((x) => x.fila.clave === enTienda) : null;
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
        {p.revision.estado === 'lista' && (
          <p>
            <ShieldCheck size={18} /> <b>Revisamos tu inventario:</b> {plural(publicables, 'repuesto se puede publicar', 'repuestos se pueden publicar')}
            {cuenta.error > 0 ? ` y ${plural(cuenta.error, 'no se publicará', 'no se publicarán')} hasta que lo corrijas` : ''}.
          </p>
        )}
        {p.revision.estado === 'desactualizada' && (
          <p>
            <RefreshCw size={18} /> Hiciste cambios después de la última revisión.{' '}
            <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" onClick={p.onRevisar}>Revisar de nuevo</button>
          </p>
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
          ] as ['todas' | EstadoFila, string][]).map(([v, t]) => (
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
              {visibles.map(({ fila, estado, mensajes }) => {
                const ficha = fichaDesdeFila(p.tabla.columnas, fila.valores);
                const fotos = p.asignaciones[fila.clave] ?? [];
                return (
                  <tr key={fila.clave} className={estado === 'error' ? 'con-error' : ''}>
                    <td><Estado estado={estado} /></td>
                    <td>{fotos[0] ? <Miniatura nombre={fotos[0]} blob={p.imagenes[fotos[0]]} imagenId={p.guardadas[fotos[0]]} tamano={40} /> : <span className="mx-celda-vacia">—</span>}</td>
                    <td>{ficha.sku || '—'}</td>
                    <td className="mx-td-nombre">{ficha.nombre}</td>
                    <td>{[ficha.categoria, ficha.subcategoria].filter(Boolean).join(' › ') || '—'}</td>
                    <td>{ficha.marca || '—'}</td>
                    <td>{ficha.precio}</td>
                    <td>{leer(fila, 'stock') || '—'}</td>
                    <td className="mx-td-compat">{ficha.compatibilidad}</td>
                    <td className="mx-td-motivo">{mensajes.join(' ') || '—'}</td>
                    <td className="mx-td-acciones">
                      <button type="button" className="mx-icono-btn" onClick={() => setEnTienda(fila.clave)} aria-label={`Ver ${ficha.nombre} como en tu tienda`} title="Ver como en tu tienda"><Eye size={16} /></button>
                      <button type="button" className="mx-icono-btn" onClick={() => p.onCorregir(fila.clave)} aria-label={`Corregir ${ficha.nombre} en la tabla`} title="Corregir en la tabla"><Pencil size={16} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="inventory-grid mx-grilla" aria-label="Tus repuestos en cuadrícula">
          {visibles.map(({ fila, estado }) => {
            const ficha = fichaDesdeFila(p.tabla.columnas, fila.valores);
            const fotos = p.asignaciones[fila.clave] ?? [];
            return (
              <article key={fila.clave} className={`inventory-grid-card mx-card ${estado}`}>
                <div className="inventory-grid-image mx-card-imagen">
                  {fotos[0]
                    ? <Miniatura nombre={fotos[0]} blob={p.imagenes[fotos[0]]} imagenId={p.guardadas[fotos[0]]} tamano={220} />
                    : <span className="mx-tienda-sinfoto"><ImageOff size={30} /> Sin foto</span>}
                  <span className={`mx-card-estado ${estado}`}>{ETIQUETA_ESTADO[estado]}</span>
                </div>
                <div className="inventory-grid-content">
                  <span className="grid-sku">SKU {ficha.sku || '—'}</span>
                  <h3 title={ficha.nombre}>{ficha.nombre}</h3>
                  <div className="grid-details">
                    <span>{leer(fila, 'stock') ? `${leer(fila, 'stock')} unidades` : 'Sin stock'}</span>
                    <strong>{ficha.precio}</strong>
                  </div>
                </div>
                <footer className="inventory-grid-actions">
                  <button type="button" className="grid-action" onClick={() => setEnTienda(fila.clave)} title="Ver cómo se verá en tu tienda" aria-label={`Ver ${ficha.nombre} como en tu tienda`}><Eye size={16} /></button>
                  <button type="button" className="grid-action" onClick={() => setFotosDe(fila.clave)} title="Elegir fotos" aria-label={`Fotos de ${ficha.nombre}`}><Images size={16} /></button>
                  <button type="button" className="grid-action" onClick={() => p.onCorregir(fila.clave)} title="Corregir en la tabla" aria-label={`Corregir ${ficha.nombre}`}><Pencil size={16} /></button>
                </footer>
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
        <button
          type="button"
          className="btn btn-primary btn-primary-blue mx-btn mx-btn-publicar"
          onClick={() => setConfirmar(true)}
          disabled={!puedePublicar}
          title={!puedePublicar ? (p.revision.estado === 'lista' ? 'No hay repuestos que se puedan publicar' : 'Primero revisamos tu inventario') : undefined}
        >
          <Rocket size={17} /> Publicar {plural(publicables, 'repuesto', 'repuestos')}
        </button>
      </footer>

      {confirmar && (
        <Modal
          titulo="¿Publicar tu inventario?"
          icono={<Rocket size={18} />}
          onCerrar={() => setConfirmar(false)}
          acciones={(
            <>
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => setConfirmar(false)}>Todavía no</button>
              <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={() => { setConfirmar(false); p.onPublicar(); }}>Sí, publicar</button>
            </>
          )}
        >
          <ul className="mx-lista-confirmar">
            <li><CheckCircle2 size={16} /> Se publicarán <b>{plural(publicables, 'repuesto', 'repuestos')}</b> ({plural(conFotos, 'con foto', 'con foto')}).</li>
            {cuenta.error > 0 && <li><XCircle size={16} /> <b>{plural(cuenta.error, 'repuesto no se publicará', 'repuestos no se publicarán')}</b> porque tienen algo por corregir. Podrás cargarlos después.</li>}
            <li><ShieldCheck size={16} /> Aparecerán en la web y en la app de RepuesTop. Después puedes editarlos desde tu Inventario.</li>
          </ul>
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
          estado={{ estado: filaTienda.estado, mensajes: filaTienda.mensajes }}
          onParche={(col, v) => p.onParche(filaTienda.fila.clave, col, v)}
          onCambiarFotos={() => setFotosDe(filaTienda.fila.clave)}
          onCerrar={() => setEnTienda(null)}
          nombreTienda={p.nombreTienda}
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

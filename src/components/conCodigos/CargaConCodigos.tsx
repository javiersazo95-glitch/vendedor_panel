/**
 * Carga masiva "Con códigos del fabricante". Dos pantallas propias y después el asistente de siempre:
 *
 *   1. Tus códigos  — Excel o CSV, pegados, o con pistola de código de barras.
 *   2. Lo que encontramos — reconocidos, por elegir marca y no encontrados; aquí se ponen precio y stock.
 *   3 y 4. "Completa" y "Revisa y publica" del asistente con Excel, con todo ya lleno.
 *
 * La búsqueda corre en el servidor: se puede salir y volver. Nada se publica desde aquí.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Car, CheckCircle2, ChevronDown, ClipboardPaste, Download, FileSpreadsheet, HelpCircle, Loader2,
  ScanBarcode, Search, Trash2, X,
} from 'lucide-react';
import '../miExcel/miExcel.css';
import './conCodigos.css';
import { esModoInvitado, getStoredSession } from '../../utils/session';
import { leerLibro } from '../../utils/plantillaMapping';
import { useEsquemaPlantilla } from '../../utils/plantillaEsquema';
import { excedeTamanoMaximoDatos, mensajeArchivoDemasiadoGrande } from '../../utils/fileValidation';
import { garantiaOpciones, normalizarGarantia } from '../../utils/garantia';
import { CONDICIONES_PRODUCTO, esUsadoOReacondicionado, etiquetaCondicion } from '../../utils/condicionProducto';
import {
  crearLote, elegirMarcaDeLote, leerUltimaEleccion, MAXIMO_CODIGOS, obtenerLote, textoGrupo,
  type EstadoCodigo, type ItemLote, type LoteCodigos,
} from '../../utils/fichaCodigoApi';
import {
  aoaDesdeTexto, construirExcelConCodigos, enteroDe, excelDeNoEncontrados, guardarLista, leerFilasDeCodigos, leerLista, olvidarLista, plantillaDeCodigos,
  type AjusteCodigo, type FilaArmada, type FilaCodigo,
} from '../../utils/cargaConCodigos';

interface Props {
  onVolver: () => void;
  /** El Excel armado: sigue en el asistente de siempre. */
  onListo: (archivo: File) => void;
}

type Vista = 'todos' | 'listos' | 'completar' | 'marca' | 'sin';

const POR_PAGINA = 50;
const CADA_MS = 2500;
function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-CL')} ${n === 1 ? uno : varios}`;

export function CargaConCodigos({ onVolver, onListo }: Props) {
  const sesion = getStoredSession();
  const sellerId = sesion?.sellerId;
  const { esquema, usandoRespaldo, fallo: listasCaidas, reintentar } = useEsquemaPlantilla(true);
  const invitado = esModoInvitado();
  const [guardado] = useState(() => leerLista(sellerId));
  const ultima = useMemo(() => leerUltimaEleccion(sellerId), [sellerId]);

  const [filas, setFilas] = useState<FilaCodigo[]>(guardado?.filas ?? []);
  const [lote, setLote] = useState<LoteCodigos | null>(null);
  const [loteId, setLoteId] = useState<string | null>(guardado?.loteId ?? null);
  const [ajustes, setAjustes] = useState<Record<number, AjusteCodigo>>(guardado?.ajustes ?? {});
  const [condicion, setCondicion] = useState(guardado?.condicion ?? ultima.condicion ?? '');
  const [garantia, setGarantia] = useState(guardado?.garantia ?? ultima.garantia ?? '');
  const [incluirNoEncontrados, setIncluirNoEncontrados] = useState(false);

  const [pegado, setPegado] = useState('');
  const [escaneado, setEscaneado] = useState('');
  const [avisoLectura, setAvisoLectura] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [vista, setVista] = useState<Vista>('todos');
  const [pagina, setPagina] = useState(0);
  const [abiertas, setAbiertas] = useState<Set<number>>(() => new Set());
  const [confirmarOtra, setConfirmarOtra] = useState(false);
  const inputArchivo = useRef<HTMLInputElement>(null);

  /* ----------------------------- Guardar y retomar ----------------------------- */

  useEffect(() => {
    if (!sellerId || !loteId) return;
    guardarLista(sellerId, { loteId, filas, ajustes, condicion, garantia });
  }, [sellerId, loteId, filas, ajustes, condicion, garantia]);

  const olvidar = useCallback(() => {
    olvidarLista(sellerId);
    setLote(null);
    setLoteId(null);
    setFilas([]);
    setAjustes({});
    setPagina(0);
    setVista('todos');
    setConfirmarOtra(false);
  }, [sellerId]);

  // Avance: mientras queden códigos por buscar, se pregunta cada poco.
  useEffect(() => {
    if (!loteId || !sesion?.sellerId || !sesion?.token) return undefined;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    let fallos = 0;
    const mirar = async () => {
      try {
        const l = await obtenerLote({ sellerId: sesion.sellerId, token: sesion.token }, loteId);
        if (!vivo) return;
        fallos = 0;
        setLote(l);
        setError(null);
        if (l.pendientes > 0) reloj = setTimeout(mirar, l.sinCupo ? 60_000 : CADA_MS);
      } catch (e) {
        if (!vivo) return;
        fallos += 1;
        if (/no encontrada/i.test(e instanceof Error ? e.message : '')) { olvidar(); return; }
        setError(e instanceof Error ? e.message : 'No pudimos leer el avance.');
        if (fallos < 6) reloj = setTimeout(mirar, CADA_MS * fallos * 2);
      }
    };
    void mirar();
    return () => { vivo = false; clearTimeout(reloj); };
  }, [loteId, sesion?.sellerId, sesion?.token, olvidar]);

  /* ------------------------------- Pantalla 1 ------------------------------- */

  const sumar = (aoa: unknown[][], limpiar = false) => {
    const lectura = leerFilasDeCodigos(aoa);
    if (lectura.filas.length === 0) {
      setError('No encontramos códigos. La columna del código debe llamarse "codigo" o ser la primera.');
      return;
    }
    const base = limpiar ? [] : filas;
    const clave = (f: FilaCodigo) => `${f.codigo.toUpperCase().replace(/[^A-Z0-9]/g, '')}|${f.marca.toLowerCase()}|${f.sku}`;
    const vistas = new Set(base.map(clave));
    const nuevas = lectura.filas.filter((f) => !vistas.has(clave(f)));
    if (base.length + nuevas.length > MAXIMO_CODIGOS) {
      setError(`Se pueden buscar hasta ${MAXIMO_CODIGOS.toLocaleString('es-CL')} códigos a la vez. Divide tu lista.`);
      return;
    }
    setError(null);
    setFilas([...base, ...nuevas]);
    const repetidas = lectura.repetidas + lectura.filas.length - nuevas.length;
    setAvisoLectura([
      `Leímos ${plural(nuevas.length, 'código', 'códigos')}.`,
      repetidas > 0 ? `${plural(repetidas, 'estaba repetido', 'estaban repetidos')} y no se sumó.` : '',
      lectura.sinCodigo > 0 ? `${plural(lectura.sinCodigo, 'fila no tenía código', 'filas no tenían código')}.` : '',
    ].filter(Boolean).join(' '));
  };

  const recibirArchivo = async (file: File) => {
    if (excedeTamanoMaximoDatos(file)) { setError(mensajeArchivoDemasiadoGrande(file)); return; }
    setOcupado(true);
    try {
      const hojas = await leerLibro(file);
      // La hoja con más códigos: hay listas con una portada primero.
      const mejor = hojas.map((h) => ({ h, n: leerFilasDeCodigos(h.aoa) }))
        .sort((a, b) => Number(b.n.conTitulos) - Number(a.n.conTitulos) || b.n.filas.length - a.n.filas.length)[0];
      sumar(mejor?.h.aoa ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    } finally {
      setOcupado(false);
    }
  };

  const buscar = async () => {
    if (!sesion?.sellerId || !sesion?.token) { setError('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
    setOcupado(true);
    setError(null);
    try {
      const l = await crearLote({ sellerId: sesion.sellerId, token: sesion.token }, filas.map((f) => ({
        codigo: f.codigo, marca: f.marca || undefined, usado: esUsadoOReacondicionado(f.condicion || condicion),
      })));
      setAjustes({});
      setPagina(0);
      setVista('todos');
      setLote(l);
      setLoteId(l.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos buscar tus códigos.');
    } finally {
      setOcupado(false);
    }
  };

  /* ------------------------------- Pantalla 2 ------------------------------- */

  const ajustar = (orden: number, cambio: AjusteCodigo) => setAjustes((a) => ({ ...a, [orden]: { ...a[orden], ...cambio } }));

  const armadas = useMemo(() => (lote?.items ?? []).map((item): FilaArmada & { fuera: boolean } => {
    const fila = filas[item.orden] ?? { codigo: item.codigo, marca: item.marca ?? '', precio: null, stock: null, sku: '', condicion: '', garantia: '' };
    const a = ajustes[item.orden] ?? {};
    const grupos = item.ficha?.compatibilidad.grupos ?? [];
    const elegidos = a.grupos ?? grupos.flatMap((g, i) => (g.segura && g.anioDesde ? [i] : []));
    return {
      fila, item,
      precio: a.precio !== undefined ? enteroDe(a.precio) : fila.precio,
      stock: a.stock !== undefined ? enteroDe(a.stock) : fila.stock,
      categoria: a.categoria ?? item.ficha?.categoria ?? '',
      subcategoria: a.categoria !== undefined && a.categoria !== item.ficha?.categoria ? '' : item.ficha?.subcategoria ?? '',
      grupos: elegidos.map((i) => grupos[i]).filter(Boolean),
      fuera: Boolean(a.fuera),
    };
  }), [lote, filas, ajustes]);

  const faltaDe = (f: FilaArmada): string[] => [
    !(f.precio && f.precio > 0) && 'precio',
    f.stock === null && 'stock',
    !f.categoria && 'categoría',
    f.grupos.length === 0 && 'vehículos',
  ].filter((x): x is string => Boolean(x));

  const reconocidas = armadas.filter((f) => f.item.estado === 'RECONOCIDO' && !f.fuera);
  const listas = reconocidas.filter((f) => faltaDe(f).length === 0);
  const porCompletar = reconocidas.filter((f) => faltaDe(f).length > 0);
  const porMarca = armadas.filter((f) => f.item.estado === 'ELEGIR_MARCA' && !f.fuera);
  const noEncontradas = armadas.filter((f) => (f.item.estado === 'NO_ENCONTRADO' || f.item.estado === 'NO_DISPONIBLE') && !f.fuera);
  const enVista = { todos: armadas, listos: listas, completar: porCompletar, marca: porMarca, sin: noEncontradas }[vista];
  const paginas = Math.max(1, Math.ceil(enVista.length / POR_PAGINA));
  const visibles = enVista.slice(Math.min(pagina, paginas - 1) * POR_PAGINA, (Math.min(pagina, paginas - 1) + 1) * POR_PAGINA);

  const elegirMarca = async (item: ItemLote, marca: string) => {
    if (!lote || !sesion?.sellerId || !sesion?.token) return;
    setOcupado(true);
    setError(null);
    try {
      setLote(await elegirMarcaDeLote({ sellerId: sesion.sellerId, token: sesion.token }, lote.id, item.id, marca));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos guardar la marca.');
    } finally {
      setOcupado(false);
    }
  };

  const aIncluir = [...reconocidas, ...(incluirNoEncontrados ? noEncontradas : [])];
  const faltaGeneral = !condicion && aIncluir.some((f) => !f.fila.condicion) ? 'la condición'
    : !normalizarGarantia(garantia) && aIncluir.some((f) => !f.fila.garantia) ? 'la garantía' : null;

  const continuar = async () => {
    if (aIncluir.length === 0 || faltaGeneral) return;
    setOcupado(true);
    setError(null);
    try {
      if (sellerId && loteId) {
        guardarLista(sellerId, { loteId, filas, ajustes, condicion, garantia, enviadas: aIncluir.map((f) => f.item.orden) });
      }
      const hoy = new Date().toISOString().slice(0, 10);
      onListo(await construirExcelConCodigos(aIncluir, esquema, { condicion, garantia: normalizarGarantia(garantia) }, `codigos_${hoy}.xlsx`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos armar tu carga.');
      setOcupado(false);
    }
  };

  /* -------------------------------- Vista -------------------------------- */

  const cabecera = (
    <header className="mx-cabecera">
      <div className="mx-cabecera-titulo">
        <button type="button" className="mx-icono-btn" onClick={onVolver} aria-label="Volver a ¿Qué tienes?"><ArrowLeft size={20} /></button>
        <div>
          <h2>Cargar con códigos del fabricante</h2>
          <p>{loteId ? 'Paso 2 de 4 · Lo que encontramos' : 'Paso 1 de 4 · Tus códigos'}</p>
        </div>
      </div>
      {loteId && (
        <div className="mx-cabecera-acciones">
          <button type="button" className="btn btn-secondary mx-btn" onClick={() => setConfirmarOtra(true)}>Empezar otra lista</button>
        </div>
      )}
    </header>
  );
  const alerta = error && <div className="mx-alerta error" role="alert"><AlertTriangle size={18} /> {error}</div>;

  if (!loteId) {
    return (
      <div className="bulk-upload-page mx cc">
        {cabecera}
        <div className="mx-explica">
          <ScanBarcode size={22} />
          <p>Danos el <b>código impreso en la caja</b>, la marca, el precio y el stock. Buscamos el nombre, la categoría y los vehículos a los que les sirve, y tú lo revisas antes de publicar.</p>
        </div>
        {alerta}
        <div className="cc-entradas">
          <section className="mx-tarjeta">
            <h3><FileSpreadsheet size={20} /> Sube tu lista</h3>
            <p>Excel o CSV con una columna llamada <b>codigo</b>. También leemos marca, precio, stock, sku, condición y garantía.</p>
            <div className="cc-botones">
              <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={() => inputArchivo.current?.click()} disabled={ocupado}>Elegir archivo</button>
              <button type="button" className="btn btn-secondary mx-btn" onClick={async () => descargar(await plantillaDeCodigos(), 'codigos-repuestop.xlsx')}><Download size={17} /> Plantilla corta</button>
            </div>
            <input
              ref={inputArchivo} type="file" accept=".xlsx,.xls,.csv" hidden aria-label="Archivo con códigos"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void recibirArchivo(f); e.target.value = ''; }}
            />
          </section>
          <section className="mx-tarjeta">
            <h3><ScanBarcode size={20} /> Escanea o escribe</h3>
            <p>Con una pistola de código de barras se agregan uno tras otro.</p>
            <div className="cc-botones">
              <input
                type="text" className="form-control" placeholder="Código y Enter" aria-label="Código para agregar" value={escaneado} maxLength={60}
                onChange={(e) => setEscaneado(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !escaneado.trim()) return;
                  e.preventDefault();
                  sumar([['codigo'], [escaneado.trim()]]);
                  setEscaneado('');
                }}
              />
            </div>
          </section>
          <section className="mx-tarjeta">
            <h3><ClipboardPaste size={20} /> Pega desde Excel</h3>
            <p>En este orden: código, marca, precio, stock.</p>
            <textarea className="form-control" rows={3} value={pegado} onChange={(e) => setPegado(e.target.value)} placeholder={'GDB3424\tTRW\t32990\t6'} aria-label="Códigos pegados" />
            <button type="button" className="btn btn-secondary mx-btn" disabled={!pegado.trim()} onClick={() => { sumar(aoaDesdeTexto(pegado)); setPegado(''); }}>Agregar</button>
          </section>
        </div>
        {avisoLectura && <div className="mx-alerta ok" role="status"><CheckCircle2 size={18} /> {avisoLectura}</div>}
        {filas.length > 0 && (
          <section className="mx-tarjeta">
            <div className="cc-lista-titulo">
              <h3>{plural(filas.length, 'código', 'códigos')} en tu lista</h3>
              <button type="button" className="mx-boton-texto" onClick={() => { setFilas([]); setAvisoLectura(null); }}><Trash2 size={16} /> Vaciar</button>
            </div>
            <div className="cc-tabla">
              <table>
                <thead><tr><th>Código</th><th>Marca</th><th>Precio</th><th>Stock</th><th aria-label="Quitar" /></tr></thead>
                <tbody>
                  {filas.slice(-100).map((f, i) => {
                    const indice = Math.max(0, filas.length - 100) + i;
                    return (
                      <tr key={`${f.codigo}-${f.marca}-${f.sku}`}>
                        <td><b>{f.codigo}</b></td>
                        <td>{f.marca || <span className="cc-gris">La buscamos</span>}</td>
                        <td>{f.precio !== null ? `$${f.precio.toLocaleString('es-CL')}` : <span className="cc-gris">Después</span>}</td>
                        <td>{f.stock ?? <span className="cc-gris">Después</span>}</td>
                        <td><button type="button" className="mx-icono-btn" onClick={() => setFilas((l) => l.filter((_, x) => x !== indice))} aria-label={`Quitar ${f.codigo}`}><X size={17} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filas.length > 100 && <p className="cc-gris">Se muestran los últimos 100.</p>}
            <div className="mx-botonera derecha">
              <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={() => void buscar()} disabled={ocupado}>
                {ocupado ? <Loader2 size={18} className="mx-girando" /> : <Search size={18} />} Buscar {plural(filas.length, 'repuesto', 'repuestos')}
              </button>
            </div>
          </section>
        )}
      </div>
    );
  }

  const hechos = lote ? lote.total - lote.pendientes : 0;
  const buscando = !lote || lote.pendientes > 0;
  const PESTANAS: { id: Vista; texto: string; n: number }[] = [
    { id: 'todos', texto: 'Todos', n: armadas.length },
    { id: 'listos', texto: 'Listos', n: listas.length },
    { id: 'completar', texto: 'Por completar', n: porCompletar.length },
    { id: 'marca', texto: 'Elegir marca', n: porMarca.length },
    { id: 'sin', texto: 'No encontrados', n: noEncontradas.length },
  ];

  return (
    <div className="bulk-upload-page mx cc">
      {cabecera}
      {confirmarOtra && (
        <div className="mx-alerta aviso" role="alertdialog" aria-label="Empezar otra lista">
          <AlertTriangle size={18} /> Se pierde lo que completaste en esta lista. Lo ya publicado no se toca.
          <button type="button" className="btn btn-secondary mx-btn" onClick={() => setConfirmarOtra(false)}>No, seguir</button>
          <button type="button" className="btn btn-secondary mx-btn mx-btn-peligro" onClick={olvidar}>Sí, empezar otra</button>
        </div>
      )}
      {alerta}
      {listasCaidas && (
        <div className="mx-alerta error"><AlertTriangle size={18} /> No pudimos cargar las categorías.
          <button type="button" className="btn btn-secondary mx-btn" onClick={reintentar}>Reintentar</button>
        </div>
      )}
      {buscando && (
        <section className="mx-tarjeta cc-avance" role="status">
          <p><Loader2 size={18} className="mx-girando" /> {lote?.sinCupo
            ? 'Se acabaron las búsquedas de hoy. Los que faltan siguen solos mañana: puedes salir y volver.'
            : `Buscando tus repuestos: ${hechos.toLocaleString('es-CL')} de ${(lote?.total ?? filas.length).toLocaleString('es-CL')}. Puedes salir y volver.`}</p>
          <progress max={lote?.total ?? 1} value={hechos} aria-label="Avance de la búsqueda" />
        </section>
      )}

      <section className="mx-tarjeta cc-generales">
        <label>Condición de los repuestos
          <select className="form-control" value={condicion} onChange={(e) => setCondicion(e.target.value)}>
            <option value="">Elige la condición</option>
            {CONDICIONES_PRODUCTO.filter((c) => !esUsadoOReacondicionado(c.valor)).map((c) => <option key={c.valor} value={c.valor}>{etiquetaCondicion(c.valor)}</option>)}
          </select>
        </label>
        <label>Garantía que ofreces
          <input className="form-control" list="cc-garantias" value={garantia} maxLength={80} onChange={(e) => setGarantia(e.target.value)} placeholder="Ej. 6 meses (garantía legal)" />
          <datalist id="cc-garantias">{garantiaOpciones().map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        <p>Vale para los que no la traen en tu lista.</p>
      </section>

      <div className="cc-pestanas" role="group" aria-label="Ver">
        {PESTANAS.map((p) => (
          <button type="button" key={p.id} aria-pressed={vista === p.id} className={vista === p.id ? 'activa' : ''} onClick={() => { setVista(p.id); setPagina(0); }}>
            {p.texto} <small>{p.n.toLocaleString('es-CL')}</small>
          </button>
        ))}
      </div>

      <ul className="cc-filas">
        {visibles.map((f) => (
          <FilaResultado
            key={f.item.id}
            fila={f}
            falta={f.item.estado === 'RECONOCIDO' ? faltaDe(f) : []}
            ajuste={ajustes[f.item.orden] ?? {}}
            categorias={esquema.catalogos.categorias}
            abierta={abiertas.has(f.item.orden)}
            ocupado={ocupado}
            onAlternar={() => setAbiertas((s) => { const n = new Set(s); if (n.has(f.item.orden)) n.delete(f.item.orden); else n.add(f.item.orden); return n; })}
            onAjustar={(c) => ajustar(f.item.orden, c)}
            onMarca={(m) => void elegirMarca(f.item, m)}
          />
        ))}
      </ul>
      {visibles.length === 0 && !buscando && <p className="cc-gris cc-vacio">No hay repuestos aquí.</p>}
      {paginas > 1 && (
        <div className="cc-paginas">
          <button type="button" className="btn btn-secondary mx-btn" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
          <span>Página {Math.min(pagina, paginas - 1) + 1} de {paginas}</span>
          <button type="button" className="btn btn-secondary mx-btn" disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => p + 1)}>Siguiente</button>
        </div>
      )}

      {noEncontradas.length > 0 && !buscando && (
        <section className="mx-tarjeta cc-noencontrados">
          <p><HelpCircle size={18} /> {plural(noEncontradas.length, 'código no se encontró', 'códigos no se encontraron')}.</p>
          <div className="cc-botones">
            <label className="cc-check">
              <input type="checkbox" checked={incluirNoEncontrados} onChange={(e) => setIncluirNoEncontrados(e.target.checked)} disabled={invitado} />
              Incluirlos para completarlos a mano
            </label>
            <button type="button" className="btn btn-secondary mx-btn" onClick={async () => descargar(await excelDeNoEncontrados(noEncontradas.map((f) => f.fila)), 'codigos-no-encontrados.xlsx')}><Download size={17} /> Descargarlos</button>
          </div>
        </section>
      )}

      <footer className="cc-pie">
        <div>
          <strong>{plural(aIncluir.length, 'repuesto', 'repuestos')}</strong>
          <span>{faltaGeneral ? `Elige ${faltaGeneral} para continuar.`
            : porMarca.length > 0 ? `${plural(porMarca.length, 'espera que elijas su marca y no irá', 'esperan que elijas su marca y no irán')}.`
              : porCompletar.length > 0 ? `${plural(porCompletar.length, 'tiene', 'tienen')} algo por completar${invitado ? '.' : '; también puedes hacerlo en el paso siguiente.'}` : 'Todo listo para revisar.'}</span>
        </div>
        <button type="button" className="btn btn-primary btn-primary-blue mx-btn" onClick={() => void continuar()} disabled={ocupado || aIncluir.length === 0 || Boolean(faltaGeneral) || usandoRespaldo}>
          Continuar <ArrowRight size={18} />
        </button>
      </footer>
    </div>
  );
}

const ESTADO: Record<EstadoCodigo, { texto: string; clase: string }> = {
  PENDIENTE: { texto: 'Buscando…', clase: 'gris' },
  RECONOCIDO: { texto: 'Listo', clase: 'ok' },
  ELEGIR_MARCA: { texto: 'Elige la marca', clase: 'aviso' },
  NO_ENCONTRADO: { texto: 'No encontrado', clase: 'mal' },
  NO_DISPONIBLE: { texto: 'No se pudo buscar', clase: 'mal' },
};

function FilaResultado({ fila, falta, ajuste, categorias, abierta, ocupado, onAlternar, onAjustar, onMarca }: {
  fila: FilaArmada & { fuera: boolean }; falta: string[]; ajuste: AjusteCodigo; categorias: string[]; abierta: boolean; ocupado: boolean;
  onAlternar: () => void; onAjustar: (c: AjusteCodigo) => void; onMarca: (marca: string) => void;
}) {
  const { item, fila: original } = fila;
  const ficha = item.ficha;
  const estado = falta.length > 0 ? { texto: `Falta ${falta.join(', ')}`, clase: 'aviso' } : ESTADO[item.estado];
  const grupos = ficha?.compatibilidad.grupos ?? [];
  const elegidos = new Set(fila.grupos.map((g) => grupos.indexOf(g)));
  const porRevisar = grupos.filter((g, i) => !g.segura && g.anioDesde && !elegidos.has(i)).length;
  const marcar = (i: number, si: boolean) => onAjustar({ grupos: si ? [...elegidos, i].sort((a, b) => a - b) : [...elegidos].filter((x) => x !== i) });
  return (
    <li className={`cc-fila${fila.fuera ? ' fuera' : ''}`}>
      <div className="cc-fila-principal">
        <div className="cc-fila-texto">
          <span className={`cc-estado ${estado.clase}`}>{fila.fuera ? 'No se cargará' : estado.texto}</span>
          <strong>{ficha ? ficha.nombre : original.codigo}</strong>
          <span>{[ficha?.marca ?? original.marca, ficha ? ficha.codigo : null, fila.categoria ? [fila.categoria, fila.subcategoria].filter(Boolean).join(' · ') : null].filter(Boolean).join(' · ')}</span>
        </div>
        {(item.estado === 'RECONOCIDO' || item.estado === 'ELEGIR_MARCA') && !fila.fuera && (
          <div className="cc-fila-numeros">
            <label>Precio
              <input inputMode="numeric" className={!(fila.precio && fila.precio > 0) ? 'falta' : ''} aria-label={`Precio de ${original.codigo}`}
                value={ajuste.precio ?? (original.precio ?? '')} onChange={(e) => onAjustar({ precio: e.target.value })} />
            </label>
            <label>Stock
              <input inputMode="numeric" className={fila.stock === null ? 'falta' : ''} aria-label={`Stock de ${original.codigo}`}
                value={ajuste.stock ?? (original.stock ?? '')} onChange={(e) => onAjustar({ stock: e.target.value })} />
            </label>
          </div>
        )}
        <button type="button" className="mx-icono-btn" onClick={() => onAjustar({ fuera: !fila.fuera })} aria-label={fila.fuera ? `Volver a incluir ${original.codigo}` : `No cargar ${original.codigo}`}>
          {fila.fuera ? <CheckCircle2 size={18} /> : <Trash2 size={18} />}
        </button>
      </div>
      {!fila.fuera && item.estado === 'ELEGIR_MARCA' && (
        <div className="cc-marcas" role="group" aria-label={`Marca de ${original.codigo}`}>
          {item.opciones.map((m) => <button type="button" key={m} disabled={ocupado} onClick={() => onMarca(m)}>{m}</button>)}
        </div>
      )}
      {!fila.fuera && ficha && (!ficha.categoria || ajuste.categoria !== undefined) && (
        <label className="cc-categoria">Categoría
          <select className={`form-control${fila.categoria ? '' : ' falta'}`} value={fila.categoria} onChange={(e) => onAjustar({ categoria: e.target.value })}>
            <option value="">Elige la categoría</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      {!fila.fuera && ficha && (
        <div className="cc-vehiculos">
          <button type="button" aria-expanded={abierta} onClick={onAlternar} disabled={grupos.length === 0}>
            <Car size={17} /> {fila.grupos.length === 0 ? 'Sin vehículos confirmados' : plural(fila.grupos.length, 'vehículo', 'vehículos')}
            {porRevisar > 0 && <em>{porRevisar} por revisar</em>}
            {grupos.length > 0 && <ChevronDown size={16} className={abierta ? 'abierta' : ''} />}
          </button>
          {abierta && (
            <ul>
              {grupos.map((g, i) => (
                <li key={textoGrupo(g)}>
                  <label className="cc-check">
                    <input type="checkbox" checked={elegidos.has(i)} disabled={!g.anioDesde} onChange={(e) => marcar(i, e.target.checked)} />
                    {textoGrupo(g)} {!g.anioDesde ? <em>sin años: complétalo después</em> : !g.segura && <em>no confirmado</em>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Etapa 2 · Relaciona. Por cada dato que pide RepuesTop, el vendedor elige la columna de su Excel
 * que lo trae, o dice "no tengo esta columna".
 *
 * Cambio clave frente al adaptador anterior: "no tengo esta columna" ya NO abre un segundo
 * desplegable de "valor fijo para todas las filas", que se prestaba a confusión. En su lugar se
 * avisa que ese dato lo va a completar él mismo en la etapa 3, en la tabla, donde puede llenarlo
 * celda por celda o aplicar un valor a todas las filas vacías de una vez.
 *
 * Las columnas de su Excel que no quedaron relacionadas se listan aparte, con dos botones claros:
 * sumarlas a la descripción o dejarlas fuera.
 */
import React, { useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Info, PencilLine, Sparkles, Trash2, FileText,
} from 'lucide-react';
import {
  SECCIONES_MAPPER,
  requiereValorEnPanel,
  type CampoMeta,
  type Mapping,
  type UserColumn,
} from '../../utils/plantillaMapping';
import type { AutoDerivado, Detecciones } from '../../utils/miExcelDetecciones';
import { plural } from './textos';

type Bandera = 'parsearAplicacion' | 'agruparPorSku' | 'dividirAnios' | 'separarAplicaciones'
  | 'deducirDelNombre' | 'quitarFilasDeTotales' | 'usarBandasComoCategoria';

interface Props {
  campos: CampoMeta[];
  mapping: Mapping;
  userCols: UserColumn[];
  userRows: unknown[][];
  detecciones: Detecciones;
  auto: (key: string) => AutoDerivado;
  /** Campos sin columna que se completan en la etapa 3. */
  columnasACompletar: string[];
  reutilizado: boolean;
  onOficial: (key: string, colId: string) => void;
  onExtra: (colId: string, politica: 'descripcion' | 'ignore') => void;
  onBandera: (bandera: Bandera, valor: boolean) => void;
  onColumnaFotos: (colId: string | null) => void;
  onUniversal: (valor: boolean) => void;
  onVehiculoPorFila: () => void;
  onAtras: () => void;
  onSiguiente: () => void;
}

const ejemploDe = (rows: unknown[][], col: UserColumn): string => {
  for (const row of rows) {
    const v = String((row as unknown[])[col.index] ?? '').trim();
    if (v) return v;
  }
  return '';
};

function Interruptor({ checked, onChange, etiqueta, children }: {
  checked: boolean; onChange: (v: boolean) => void; etiqueta: string; children: React.ReactNode;
}) {
  return (
    <label className="mx-interruptor">
      <input type="checkbox" checked={checked} aria-label={etiqueta} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function PasoRelacionar(p: Props) {
  const { mapping, detecciones: d, campos, userCols, userRows } = p;
  // H39: la pregunta "¿todo es universal?" va en la pantalla, no en un confirm del navegador
  // (un vendedor lo acepta sin leer, y el Audit Kit no admite alert/confirm nuevos).
  const [preguntarUniversal, setPreguntarUniversal] = useState(false);
  const aCompletar = new Set(p.columnasACompletar);
  const asignadas = new Set(Object.values(mapping.oficial).filter(Boolean) as string[]);
  const sinAsignar = userCols.filter((c) => !asignadas.has(c.id));
  const usos = new Map<string, number>();
  Object.values(mapping.oficial).forEach((id) => { if (id) usos.set(id, (usos.get(id) ?? 0) + 1); });

  const universal = (mapping.defaults?.compatibilidad_general ?? '') === 'SI';
  const tieneVehiculo = !!(mapping.oficial.compatibilidad_marca || mapping.oficial.compatibilidad_modelo);
  const faltaDecidirVehiculo = !tieneVehiculo && !universal && !mapping.vehiculoPorFila
    && !(mapping.parsearAplicacion && d.columnaAplicacion);

  const ajustes = [
    d.skusRepetidos && d.skusRepetidos.skus > 0, d.columnaAplicacion, d.aplicacionesMultiples, d.datosEnElNombre,
    d.filasDeTotales, d.bandas, d.columnaFotos, d.columnaAniosConRangos,
  ].filter(Boolean).length;

  const obligatoriosACompletar = campos.filter((c) => aCompletar.has(c.key) && requiereValorEnPanel(c, mapping));
  const opcionalesACompletar = campos.filter((c) => aCompletar.has(c.key) && !requiereValorEnPanel(c, mapping));
  const aDescripcion = sinAsignar.filter((c) => (mapping.extras[c.id] ?? 'descripcion') === 'descripcion').length;

  const tarjetaCampo = (campo: CampoMeta) => {
    const valor = mapping.oficial[campo.key] ?? '';
    const col = valor ? userCols.find((c) => c.id === valor) : undefined;
    const auto = p.auto(campo.key);
    const esAuto = auto.activo && !valor;
    const obligatorio = requiereValorEnPanel(campo, mapping);
    const manual = !valor && aCompletar.has(campo.key);
    const usos_ = valor ? usos.get(valor) ?? 0 : 0;
    const esUniversalDecidido = campo.key === 'compatibilidad_general' && universal && !valor;
    return (
      <div key={campo.key} className={`mx-campo ${valor || esAuto || esUniversalDecidido ? 'listo' : manual ? 'manual' : ''}`}>
        <div className="mx-campo-destino">
          <div className="mx-campo-nombre">
            <strong>{campo.label}</strong>
            {obligatorio ? <span className="mx-pill req">Obligatorio</span> : <span className="mx-pill opc">Opcional</span>}
            {(valor || esAuto || esUniversalDecidido) && <span className="mx-pill ok"><Check size={12} /> {esAuto ? 'Automático' : 'Listo'}</span>}
          </div>
          {campo.descripcion && <p className="mx-campo-desc">{campo.descripcion}</p>}
          {campo.ejemplo && <p className="mx-campo-ejemplo">{campo.ejemplo}</p>}
        </div>
        <div className="mx-campo-flecha" aria-hidden><ArrowLeft size={16} /></div>
        <div className="mx-campo-origen">
          <label htmlFor={`mx-col-${campo.key}`}>{esAuto ? 'O elige una columna tuya si la tienes:' : 'Columna en tu archivo Excel:'}</label>
          <select
            id={`mx-col-${campo.key}`}
            className="form-control"
            value={valor}
            aria-label={campo.label}
            onChange={(e) => p.onOficial(campo.key, e.target.value)}
          >
            <option value="">{esAuto ? '— Se completa solo —' : '— No tengo esta columna —'}</option>
            {userCols.map((c) => <option key={c.id} value={c.id}>{c.displayHeader}</option>)}
          </select>
          {col && (
            <p className="mx-ejemplo">
              Ejemplo en tu archivo: {ejemploDe(userRows, col) ? <b>"{ejemploDe(userRows, col)}"</b> : <i>(vacío en las primeras filas)</i>}
              {usos_ > 1 && <span className="mx-pill opc">usada {usos_} veces</span>}
            </p>
          )}
          {esAuto && <p className="mx-auto"><Sparkles size={14} /> {auto.descripcion}{auto.ejemplo ? ` (${auto.ejemplo})` : ''}</p>}
          {esUniversalDecidido && (
            <p className="mx-auto"><Sparkles size={14} /> Marcaste que todo tu inventario es universal.</p>
          )}
          {manual && !esUniversalDecidido && (
            <p className="mx-manual" role="status">
              <PencilLine size={15} />
              <span>
                {auto.activo && auto.parcial
                  ? <>Lo sacamos de tu archivo donde se pueda; <b>lo que falte lo completarás tú en el paso 3</b>.</>
                  : <>Este dato <b>lo completarás tú en el paso 3</b>, en la tabla de tus repuestos.</>}
                {' '}{obligatorio ? 'Es obligatorio para publicar.' : 'Es opcional: también podrás dejarlo vacío.'}
              </span>
            </p>
          )}
        </div>
      </div>
    );
  };

  const secIds = new Set<string>(SECCIONES_MAPPER.map((s) => s.id));
  const otros = campos.filter((c) => c.seccion && !secIds.has(c.seccion));

  return (
    <div className="mx-paso">
      <div className="mx-explica">
        <Info size={18} />
        <p>
          A la <b>izquierda</b> está el dato que pide RepuesTop; a la <b>derecha</b> eliges la columna de tu Excel
          que lo trae. Ya te propusimos una relación: revísala. Si tu archivo no tiene un dato, elige
          <b> "No tengo esta columna"</b> y lo completas tú en el paso 3.
        </p>
      </div>

      {p.reutilizado && (
        <div className="mx-alerta info"><Info size={16} /> Usamos la relación que guardaste la última vez para un Excel con estas mismas columnas.</div>
      )}
      {d.segundaTabla && (
        <div className="mx-alerta aviso">
          <AlertTriangle size={16} />
          <span>
            Parece que tu hoja tiene <b>más de una tabla</b> (más abajo empiezan otros títulos:{' '}
            {d.segundaTabla.titulos.slice(0, 4).join(', ')}). Sólo leemos la primera; conviene dejar cada tabla en su propia hoja.
          </span>
        </div>
      )}

      <div className="mx-resumen-fila">
        <span><b>{campos.length - p.columnasACompletar.length}</b>/{campos.length} datos relacionados</span>
        <span className={p.columnasACompletar.length ? 'amarillo' : ''}><b>{p.columnasACompletar.length}</b> los completarás en el paso 3</span>
        <span><b>{sinAsignar.length}</b> columnas tuyas sin asignar</span>
      </div>

      {faltaDecidirVehiculo && (
        <div className="mx-alerta aviso" role="alert">
          <AlertTriangle size={16} />
          <span>
            <b>Tu archivo no dice para qué vehículos sirve cada repuesto.</b> Sin eso no aparecen cuando alguien busca
            por su auto. Elige una opción:
            <span className="mx-botonera">
              <button type="button" className="btn btn-secondary mx-btn" onClick={() => p.onUniversal(true)}>Sirven para todos los vehículos</button>
              <button type="button" className="btn btn-secondary mx-btn" onClick={p.onVehiculoPorFila}>Algunos sí y otros no: lo completo en el paso 3</button>
            </span>
            O relaciona más abajo la columna de tu Excel que trae la marca y el modelo del auto.
          </span>
        </div>
      )}

      <details className="mx-tarjeta mx-plegable" open={ajustes > 0}>
        <summary>
          <Sparkles size={17} />
          <span><b>Ajustes que detectamos en tu archivo</b>{ajustes > 0 ? ` (${ajustes})` : ''}</span>
          <ChevronDown size={16} className="mx-plegable-flecha" />
        </summary>
        <p className="mx-ayuda">Los marcados los arreglamos por ti. Desmarca sólo lo que no corresponda a tu inventario.</p>
        {d.skusRepetidos && d.skusRepetidos.skus > 0 && (
          <Interruptor checked={mapping.agruparPorSku ?? false} onChange={(v) => p.onBandera('agruparPorSku', v)} etiqueta="Juntar las filas repetidas del mismo código">
            <b>Tu archivo repite el mismo código en varias filas</b>
            {d.skusRepetidos.ejemplo ? ` (${d.skusRepetidos.ejemplo.sku} aparece ${d.skusRepetidos.ejemplo.veces} veces)` : ''}.
            Lo publicamos como <b>un repuesto que sirve para varios autos</b>.
          </Interruptor>
        )}
        {d.columnaAplicacion && (
          <Interruptor
            checked={mapping.parsearAplicacion ?? false}
            etiqueta="Separar marca, modelo y años de la columna de compatibilidad"
            onChange={(v) => {
              if (v && d.columnaAplicacion?.necesitaAsignar) p.onOficial('compatibilidad_modelo', d.columnaAplicacion.col.id);
              p.onBandera('parsearAplicacion', v);
            }}
          >
            <b>Tu columna "{d.columnaAplicacion.col.displayHeader}" trae la marca, el modelo y los años juntos.</b> Los separamos
            {d.columnaAplicacion.partes
              ? `: "${d.columnaAplicacion.ejemplo}" queda como ${d.columnaAplicacion.partes.marca} · ${d.columnaAplicacion.partes.modelo}`
              : ''}.
          </Interruptor>
        )}
        {d.bandas && (
          <Interruptor checked={mapping.usarBandasComoCategoria ?? false} onChange={(v) => p.onBandera('usarBandasComoCategoria', v)} etiqueta="Usar las filas de titulo como categoria">
            <b>Tu lista agrupa los repuestos con filas de título</b> ({d.bandas.titulos.slice(0, 3).join(', ')}). Usamos cada título
            como la categoría de los repuestos de abajo.
          </Interruptor>
        )}
        {d.filasDeTotales && (
          <Interruptor checked={mapping.quitarFilasDeTotales ?? false} onChange={(v) => p.onBandera('quitarFilasDeTotales', v)} etiqueta="Dejar fuera las filas que no son repuestos">
            <b>Tu lista trae {plural(d.filasDeTotales.total, 'fila que no es un repuesto', 'filas que no son repuestos')}</b>
            {d.filasDeTotales.ejemplo ? ` (como "${d.filasDeTotales.ejemplo.slice(0, 45)}")` : ''}. Las dejamos fuera.
          </Interruptor>
        )}
        {d.datosEnElNombre && (
          <Interruptor checked={mapping.deducirDelNombre ?? false} onChange={(v) => p.onBandera('deducirDelNombre', v)} etiqueta="Sacar la marca y la categoria del nombre del repuesto">
            <b>El nombre del repuesto trae la {[
              d.datosEnElNombre.faltaMarca && d.datosEnElNombre.conMarca > 0 ? 'marca' : '',
              d.datosEnElNombre.faltaCategoria && d.datosEnElNombre.conCategoria > 0 ? 'categoría' : '',
            ].filter(Boolean).join(' y la ')}.</b> La sacamos de ahí; lo que no reconozcamos lo completas en el paso 3.
          </Interruptor>
        )}
        {d.aplicacionesMultiples && (
          <Interruptor checked={mapping.separarAplicaciones ?? false} onChange={(v) => p.onBandera('separarAplicaciones', v)} etiqueta="Separar los varios autos que vienen en una misma celda">
            <b>Tu columna "{d.aplicacionesMultiples.col.displayHeader}" trae varios autos en la misma celda.</b> Publicamos el
            repuesto con cada auto por separado para que aparezca en todas las búsquedas.
          </Interruptor>
        )}
        {d.columnaFotos && (
          <Interruptor checked={!!mapping.columnaFotos} onChange={(v) => p.onColumnaFotos(v ? d.columnaFotos!.col.id : null)} etiqueta="Usar la columna de fotos de mi Excel">
            <b>Tu columna "{d.columnaFotos.col.displayHeader}" trae las fotos</b>
            {d.columnaFotos.tipo === 'url' ? ' como enlaces de internet: podrás traerlas en el paso 3.' : ' como nombres de archivo: las buscamos en la carpeta que subas.'}
          </Interruptor>
        )}
        {d.columnaAniosConRangos && (
          <Interruptor checked={mapping.dividirAnios ?? false} onChange={(v) => p.onBandera('dividirAnios', v)} etiqueta="Separar el rango de años en año desde y año hasta">
            <b>Tu columna de años trae rangos en una sola celda.</b> Los separamos en "año desde" y "año hasta"
            {d.ejemploRangoAnios ? `: ${d.ejemploRangoAnios}` : ''}.
          </Interruptor>
        )}
        <Interruptor
          checked={universal}
          etiqueta="Todo mi inventario es universal"
          onChange={(v) => {
            if (v && d.filasConVehiculo > 0) {
              setPreguntarUniversal(true);
              return;
            }
            setPreguntarUniversal(false);
            p.onUniversal(v);
          }}
        >
          <b>Todo mi inventario es universal.</b> Márcalo sólo si tus repuestos sirven para cualquier vehículo.
        </Interruptor>
        {preguntarUniversal && (
          <div className="mx-alerta aviso" role="alertdialog" aria-label="¿Todo tu inventario es universal?">
            <span>
              Tu archivo trae el auto en {plural(d.filasConVehiculo, 'fila', 'filas')}. Si marcas todo como universal,
              esos repuestos se publican sin vehículo y el comprador no los encuentra por su auto.
            </span>
            <button type="button" className="btn btn-primary btn-primary-blue mx-btn mx-btn-chico" onClick={() => setPreguntarUniversal(false)} autoFocus>
              No, mis repuestos son para autos
            </button>
            <button type="button" className="btn btn-secondary mx-btn mx-btn-chico" onClick={() => { setPreguntarUniversal(false); p.onUniversal(true); }}>
              Sí, todo es universal
            </button>
          </div>
        )}
        {ajustes === 0 && <p className="mx-nota">No encontramos nada que convertir: tus columnas ya vienen como las espera RepuesTop.</p>}
      </details>

      {SECCIONES_MAPPER.map((sec) => {
        const grupo = campos.filter((c) => (c.seccion ?? 'opcionales') === sec.id);
        if (grupo.length === 0) return null;
        const listos = grupo.filter((c) => mapping.oficial[c.key] || !aCompletar.has(c.key)).length;
        return (
          <section className="mx-tarjeta" key={sec.id}>
            <header className="mx-seccion-cabecera">
              <h4>{sec.titulo}</h4>
              <span className="mx-pill opc">{listos}/{grupo.length} con columna</span>
            </header>
            <p className="mx-ayuda">{sec.descripcion}</p>
            <div className="mx-campos">{grupo.map(tarjetaCampo)}</div>
          </section>
        );
      })}
      {otros.length > 0 && (
        <section className="mx-tarjeta">
          <header className="mx-seccion-cabecera"><h4>Otros datos</h4></header>
          <div className="mx-campos">{otros.map(tarjetaCampo)}</div>
        </section>
      )}

      <section className="mx-tarjeta">
        <header className="mx-seccion-cabecera">
          <h4>Columnas de tu Excel sin asignar ({sinAsignar.length})</h4>
          {sinAsignar.length > 0 && <span className="mx-pill opc">{aDescripcion} a la descripción · {sinAsignar.length - aDescripcion} fuera</span>}
        </header>
        <p className="mx-ayuda">
          Estas columnas de tu Excel no corresponden a ningún dato de RepuesTop. Decide qué hacer con cada una:
          <b> agregarla a la descripción</b> del repuesto (se verá en la publicación) o <b>dejarla fuera</b> (no se publica).
        </p>
        {sinAsignar.length === 0 ? (
          <p className="mx-nota"><Check size={14} /> Todas las columnas de tu archivo están relacionadas.</p>
        ) : (
          <div className="mx-sin-asignar">
            {sinAsignar.map((c) => {
              const politica = mapping.extras[c.id] ?? 'descripcion';
              const ejemplo = ejemploDe(userRows, c);
              const esFotos = mapping.columnaFotos === c.id;
              return (
                <div className="mx-sin-asignar-fila" key={c.id}>
                  <div>
                    <strong>{c.displayHeader}</strong>
                    {ejemplo && <span className="mx-ejemplo">Ej: "{ejemplo.slice(0, 60)}"</span>}
                    {esFotos && <span className="mx-pill ok">se usa para las fotos</span>}
                  </div>
                  <div className="mx-segmentado" role="group" aria-label={`Qué hacer con ${c.displayHeader}`}>
                    <button type="button" className={politica === 'descripcion' ? 'activo' : ''} aria-pressed={politica === 'descripcion'} onClick={() => p.onExtra(c.id, 'descripcion')} disabled={esFotos}>
                      <FileText size={14} /> Agregar a la descripción
                    </button>
                    <button type="button" className={politica === 'ignore' ? 'activo' : ''} aria-pressed={politica === 'ignore'} onClick={() => p.onExtra(c.id, 'ignore')}>
                      <Trash2 size={14} /> Dejar fuera
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {p.columnasACompletar.length > 0 && (
        <section className="mx-tarjeta mx-por-completar">
          <header className="mx-seccion-cabecera">
            <h4><PencilLine size={17} /> Datos que completarás en el paso 3</h4>
          </header>
          <p className="mx-ayuda">
            En el paso 3 verás tus repuestos en una tabla. Las celdas de estos datos aparecerán en <span className="mx-amarillo-muestra">amarillo</span>:
            las completas eligiendo de una lista, una por una o todas las vacías de una vez.
          </p>
          {obligatoriosACompletar.length > 0 && (
            <p><b>Obligatorios:</b> {obligatoriosACompletar.map((c) => c.label).join(', ')}</p>
          )}
          {opcionalesACompletar.length > 0 && (
            <p><b>Opcionales</b> (puedes dejarlos vacíos): {opcionalesACompletar.map((c) => c.label).join(', ')}</p>
          )}
        </section>
      )}

      <footer className="mx-pie">
        <button type="button" className="btn btn-secondary mx-btn" onClick={p.onAtras}><ArrowLeft size={16} /> Atrás</button>
        <button
          type="button"
          className="btn btn-primary btn-primary-blue mx-btn"
          onClick={p.onSiguiente}
          disabled={faltaDecidirVehiculo}
          title={faltaDecidirVehiculo ? 'Falta decidir para qué vehículos sirven los repuestos' : undefined}
        >
          Siguiente: completar tus datos <ArrowRight size={16} />
        </button>
      </footer>
    </div>
  );
}

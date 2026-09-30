/**
 * Elegir el año o el motor de un vehículo sólo entre lo que el catálogo de RepuesTop tiene para ese
 * modelo. Es lo que acepta el backend al publicar: un año en que el modelo no existe deja el
 * repuesto sin publicar, y un motor que no está no acota nada.
 *
 * Siempre hay una salida para quien cree que los años o motores no le corresponden:
 * "Todos los años del modelo" (se publica para todo el rango del catálogo) o "No asignar motor".
 */
import { etiquetaValor } from '../../utils/plantillaMapping';
import {
  aniosPermitidos, motoresPermitidos, rangoCompleto, type VersionCatalogo,
} from '../../utils/catalogoVersiones';

const ESPECIAL = '__especial__';

interface Props {
  columna: string;
  valor: string;
  etiqueta: string;
  leer: (col: string) => string;
  /** undefined: cargando · null: el catálogo no respondió · []: el modelo no tiene versiones. */
  versiones: VersionCatalogo[] | null | undefined;
  /** Opciones de siempre, para cuando el catálogo no respondió. */
  respaldo: string[];
  /** Uno o más datos a la vez ("todos los años" pone el desde y el hasta). */
  onElegir: (valores: Record<string, string>) => void;
  autoFocus?: boolean;
}

export function SelectVehiculo({ columna, valor, etiqueta, leer, versiones, respaldo, onElegir, autoFocus }: Props) {
  const marca = leer('compatibilidad_marca');
  const modelo = leer('compatibilidad_modelo');

  const que = columna === 'motor' ? 'los motores' : 'los años';
  /** Sin opciones que ofrecer: igual es una lista, con "Dejar en blanco" y el porqué. */
  const listaVacia = (motivo: string, clase = '') => (
    <select
      className={`form-control ${clase}`}
      value=""
      aria-label={etiqueta}
      autoFocus={autoFocus}
      onChange={(e) => { if (e.target.value === '') onElegir({ [columna]: '' }); }}
    >
      <option value="">Dejar en blanco</option>
      <option value="__motivo__" disabled>{motivo}</option>
    </select>
  );
  if (!marca || !modelo) {
    return listaVacia(`Primero elige la marca y el modelo del vehículo: ${que} dependen de ellos`);
  }
  if (versiones === undefined) {
    return (
      <select className="form-control" disabled aria-label={etiqueta} autoFocus={autoFocus}>
        <option>Buscando en el catálogo…</option>
      </select>
    );
  }
  if (versiones !== null && versiones.length === 0) {
    return listaVacia(`El ${marca} ${modelo} no tiene versiones en el catálogo de RepuesTop: cambia el modelo o márcalo universal`, 'con-error');
  }

  const todos = versiones ? rangoCompleto(versiones) : null;
  let opciones: string[];
  let especial: { etiqueta: string; valores: Record<string, string> } | null = null;
  if (columna === 'motor') {
    opciones = versiones ? motoresPermitidos(versiones, leer('anio_desde'), leer('anio_hasta')) : respaldo;
    especial = { etiqueta: 'No asignar motor (sirve para todas sus versiones)', valores: { motor: '' } };
  } else if (columna === 'anio_desde') {
    opciones = versiones ? aniosPermitidos(versiones) : respaldo;
    if (todos) especial = { etiqueta: `Todos los años del modelo (${todos.desde} a ${todos.hasta})`, valores: { anio_desde: todos.desde, anio_hasta: todos.hasta } };
  } else {
    const desde = leer('anio_desde');
    opciones = (versiones ? aniosPermitidos(versiones) : respaldo).filter((a) => !desde || a >= desde);
    if (todos) especial = { etiqueta: `Hasta el último año del modelo (${todos.hasta})`, valores: { anio_hasta: todos.hasta } };
  }
  const fueraDeLista = valor && !opciones.includes(valor) ? valor : '';

  return (
    <select
      className="form-control"
      value={valor}
      aria-label={etiqueta}
      autoFocus={autoFocus}
      onChange={(e) => {
        const v = e.target.value;
        if (v === ESPECIAL && especial) onElegir(especial.valores);
        // "Dejar en blanco" en "desde" también vacía el "hasta", que sin "desde" no significa nada.
        else if (v === '' && columna === 'anio_desde') onElegir({ anio_desde: '', anio_hasta: '' });
        else onElegir({ [columna]: v });
      }}
    >
      <option value="">Dejar en blanco</option>
      {especial && <option value={ESPECIAL}>{especial.etiqueta}</option>}
      {fueraDeLista && (
        <optgroup label="Tu dato (no está en el catálogo)">
          <option value={fueraDeLista} disabled>{fueraDeLista}</option>
        </optgroup>
      )}
      <optgroup label={versiones ? `Según el catálogo para el ${marca} ${modelo}` : 'Todos'}>
        {opciones.map((o) => <option key={o} value={o}>{etiquetaValor(o)}</option>)}
      </optgroup>
    </select>
  );
}

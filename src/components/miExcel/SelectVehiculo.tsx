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

  if (!marca || !modelo) {
    return <span className="mx-vehiculo-nota">Primero elige la marca y el modelo del vehículo: {columna === 'motor' ? 'los motores' : 'los años'} dependen de ellos.</span>;
  }
  if (versiones === undefined) {
    return (
      <select className="form-control" disabled aria-label={etiqueta} autoFocus={autoFocus}>
        <option>Buscando en el catálogo…</option>
      </select>
    );
  }
  if (versiones !== null && versiones.length === 0) {
    return <span className="mx-vehiculo-nota error">El {marca} {modelo} no tiene versiones en el catálogo de RepuesTop. Cambia el modelo o marca el repuesto como universal.</span>;
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
        else onElegir({ [columna]: v });
      }}
    >
      {!valor && <option value="">{columna === 'motor' ? '— Elige el motor —' : '— Elige el año —'}</option>}
      {especial && <option value={ESPECIAL}>{especial.etiqueta}</option>}
      {fueraDeLista && (
        <optgroup label="Lo que tenías (no está en el catálogo)">
          <option value={fueraDeLista}>{fueraDeLista}</option>
        </optgroup>
      )}
      <optgroup label={versiones ? `Según el catálogo para el ${marca} ${modelo}` : 'Todos'}>
        {opciones.map((o) => <option key={o} value={o}>{etiquetaValor(o)}</option>)}
      </optgroup>
    </select>
  );
}

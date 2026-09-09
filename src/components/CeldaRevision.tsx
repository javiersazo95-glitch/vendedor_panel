/**
 * Una celda de la tabla del paso 3, corregible sin volver al Excel.
 *
 * Todas las celdas se pueden corregir, no sólo las que están vacías: el vendedor puede ver
 * en la tabla que un dato suyo quedó mal y arreglarlo ahí mismo. Las que piden atención
 * —vacías, con problema, o rellenadas por nosotros— se marcan; el resto se ve como texto
 * normal hasta que se usa, para que la tabla se siga leyendo de un vistazo y no como una
 * planilla.
 */
import { useState } from 'react';

import {
  limiteDeColumna,
  validarValorFijo,
  type LimiteColumna,
} from '../utils/plantillaNormalizacion';

/**
 * Recorta lo que no puede ir en la columna mientras se escribe. Un año son cuatro cifras y
 * nada más; un precio o un stock admiten el punto y la coma con que se escriben en Chile.
 */
const soloLoQueCabe = (texto: string, tipo: LimiteColumna['tipo']): string => {
  if (tipo === 'anio') return texto.replace(/\D/g, '');
  // El stock admite el punto de miles ("1.000") pero no la coma: con ella el vendedor
  // estaría escribiendo un decimal, y de unidades no hay medias.
  if (tipo === 'entero') return texto.replace(/[^\d.]/g, '');
  if (tipo === 'numero') return texto.replace(/[^\d.,]/g, '');
  return texto;
};

interface Props {
  valor: string;
  /** Columna oficial: de ella salen el largo máximo y el tipo de dato. */
  columna: string;
  /** Opciones del catálogo o de la lista fija; vacío si el dato es texto libre. */
  opciones: string[];
  /**
   * Los pocos nombres del catálogo que se parecen a lo que trae la celda. Van arriba, en su
   * propio grupo: el catálogo de marcas pasa de las cien y buscar ahí el que ya sabemos que
   * corresponde es trabajo de más.
   */
  sugerencias?: string[];
  /** Se llama con el valor final; vacío significa "esta fila va sin el dato". */
  onCambio: (valor: string) => void;
  etiqueta: string;
  /** La celda pide atención: está vacía, tiene un problema, o el valor lo pusimos nosotros. */
  destacada: boolean;
}

export const CeldaRevision = ({
  valor, columna, opciones, sugerencias = [], onCambio, etiqueta, destacada,
}: Props) => {
  const [borrador, setBorrador] = useState(valor);
  // Si el valor cambia por fuera —otra corrección, otro interruptor del paso 2— el
  // borrador se pone al día en el mismo render, sin efecto de por medio.
  const [valorPrevio, setValorPrevio] = useState(valor);
  const [editando, setEditando] = useState(false);
  if (valorPrevio !== valor) {
    setValorPrevio(valor);
    setBorrador(valor);
  }

  const clases = `form-control mapper-celda-edit ${destacada ? 'destacada' : ''}`;

  if (opciones.length > 0) {
    // Los parecidos van en su propio grupo, arriba, y el catálogo entero debajo. Una lista
    // corta con un "ver todas" obligaba a abrir el desplegable dos veces —una para pedirlo
    // y otra para elegir—: así el que sabe lo que busca baja, y el que no, elige arriba.
    const conocidas = new Set(sugerencias);
    const resto = opciones.filter((o) => !conocidas.has(o));
    // El valor actual va siempre, aunque no esté en el catálogo: es justo el caso de la
    // marca que todavía no existe, y sin él el selector se vería vacío.
    const propio = valor && !opciones.includes(valor) ? valor : '';

    return (
      <select
        className={clases}
        value={valor}
        aria-label={etiqueta}
        onChange={(e) => onCambio(e.target.value)}
      >
        <option value="">— sin dato —</option>
        {/* El contexto va en el título del grupo y no en el texto de la opción: la celda
            cerrada muestra la opción elegida, y un texto largo ahí se ve cortado. */}
        {propio && (
          <optgroup label="Tu archivo dice">
            <option value={propio}>{propio}</option>
          </optgroup>
        )}
        {sugerencias.length > 0 ? (
          <>
            <optgroup label="Se parece a">
              {sugerencias.map((o) => <option key={o} value={o}>{o}</option>)}
            </optgroup>
            <optgroup label="Todas">
              {resto.map((o) => <option key={o} value={o}>{o}</option>)}
            </optgroup>
          </>
        ) : (
          resto.map((o) => <option key={o} value={o}>{o}</option>)
        )}
      </select>
    );
  }

  const { maxLength, tipo } = limiteDeColumna(columna);
  const error = validarValorFijo(columna, borrador);

  // El texto que ya está bien se muestra como texto y se vuelve campo al usarlo. Dentro de
  // un input, un nombre largo se ve cortado y la tabla deja de servir para lo que es: mirar
  // cómo quedó el archivo. Con un valor que no sirve el campo se queda: si volviera a
  // texto, lo escrito desaparecería sin decir nada y el vendedor creería que se guardó.
  if (!destacada && !editando && !error) {
    return (
      <span
        className="mapper-celda-texto"
        role="button"
        tabIndex={0}
        title={`${etiqueta}. Haz clic para corregirlo.`}
        onClick={() => setEditando(true)}
        onFocus={() => setEditando(true)}
      >
        {valor}
      </span>
    );
  }

  return (
    <>
      <input
        className={`${clases} ${error ? 'con-error' : ''}`}
        type="text"
        // El tope y el teclado numérico salen de la columna real del backend, igual que en
        // el valor fijo del paso 2: sin ellos un valor largo se corta recién en la base de
        // datos y el vendedor recibe un error incomprensible.
        maxLength={maxLength}
        inputMode={tipo === 'texto' ? undefined : 'numeric'}
        value={borrador}
        aria-label={etiqueta}
        aria-invalid={error ? true : undefined}
        autoFocus={editando}
        // En una columna que el backend lee como número, las letras no llegan a escribirse.
        // Avisar después de tipearlas es peor que no dejarlas entrar, y el punto y la coma
        // sí pasan porque un precio se escribe "24.990" o "1.234,50".
        onChange={(e) => setBorrador(soloLoQueCabe(e.target.value, tipo))}
        // El texto se confirma al salir del campo y no en cada tecla: cada cambio rehace la
        // transformación del archivo completo, y hacerlo por letra se siente pesado con
        // listas largas. Un valor que no sirve no se guarda: se queda a la vista con su
        // motivo, para que el vendedor lo corrija en vez de descubrirlo al publicar.
        onBlur={() => {
          setEditando(false);
          if (!error && borrador !== valor) onCambio(borrador);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setBorrador(valor);
        }}
      />
      {error && <span className="mapper-celda-error">{error}</span>}
    </>
  );
};

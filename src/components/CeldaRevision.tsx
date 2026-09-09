/**
 * Una celda de la tabla del paso 3, corregible sin volver al Excel.
 *
 * Sólo se vuelve editable donde hace falta —la celda está vacía o la revisión le marcó un
 * problema—, no en todas. Una tabla entera de campos de texto se lee como una planilla, y
 * la gracia de este paso es justamente mirar cómo quedó el archivo, no volver a llenarlo.
 */
import { useState } from 'react';

interface Props {
  valor: string;
  /** Opciones del catálogo o de la lista fija; vacío si el dato es texto libre. */
  opciones: string[];
  /** Se llama con el valor final; vacío significa "borrar la corrección". */
  onCambio: (valor: string) => void;
  etiqueta: string;
}

export const CeldaRevision = ({ valor, opciones, onCambio, etiqueta }: Props) => {
  // El texto se confirma al salir del campo y no en cada tecla: cada cambio rehace la
  // transformación del archivo completo, y hacerlo por letra se siente pesado con listas
  // largas. Los selectores sí avisan al instante, que es un evento por elección.
  const [borrador, setBorrador] = useState(valor);
  // Si el valor cambia por fuera —otra corrección, otro interruptor del paso 2— el
  // borrador se pone al día en el mismo render, sin efecto de por medio.
  const [valorPrevio, setValorPrevio] = useState(valor);
  if (valorPrevio !== valor) {
    setValorPrevio(valor);
    setBorrador(valor);
  }

  if (opciones.length > 0) {
    return (
      <select
        className="form-control mapper-celda-edit"
        value={valor}
        aria-label={etiqueta}
        onChange={(e) => onCambio(e.target.value)}
      >
        <option value="">— sin dato —</option>
        {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input
      className="form-control mapper-celda-edit"
      type="text"
      value={borrador}
      aria-label={etiqueta}
      onChange={(e) => setBorrador(e.target.value)}
      onBlur={() => borrador !== valor && onCambio(borrador)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setBorrador(valor);
      }}
    />
  );
};

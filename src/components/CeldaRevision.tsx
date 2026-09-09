/**
 * Una celda de la tabla del paso 3, corregible sin volver al Excel.
 *
 * Sólo se vuelve editable donde hace falta —la celda está vacía o la revisión le marcó un
 * problema—, no en todas. Una tabla entera de campos de texto se lee como una planilla, y
 * la gracia de este paso es justamente mirar cómo quedó el archivo, no volver a llenarlo.
 */
import { useState } from 'react';

/** Valor reservado de la lista corta para pasar al catálogo completo. */
const VER_TODAS = '__ver_todas__';

interface Props {
  valor: string;
  /** Opciones del catálogo o de la lista fija; vacío si el dato es texto libre. */
  opciones: string[];
  /**
   * Los pocos nombres del catálogo que se parecen a lo que trae la celda. Cuando los hay
   * se muestran solos, con un "ver todas" al final: el catálogo de marcas pasa de las
   * doscientas y buscar ahí el que ya sabemos que corresponde es trabajo de más.
   */
  sugerencias?: string[];
  /** Se llama con el valor final; vacío significa "esta fila va sin el dato". */
  onCambio: (valor: string) => void;
  etiqueta: string;
}

export const CeldaRevision = ({ valor, opciones, sugerencias = [], onCambio, etiqueta }: Props) => {
  const [borrador, setBorrador] = useState(valor);
  // Si el valor cambia por fuera —otra corrección, otro interruptor del paso 2— el
  // borrador se pone al día en el mismo render, sin efecto de por medio.
  const [valorPrevio, setValorPrevio] = useState(valor);
  const [verTodas, setVerTodas] = useState(false);
  if (valorPrevio !== valor) {
    setValorPrevio(valor);
    setBorrador(valor);
  }

  if (opciones.length > 0) {
    const corta = sugerencias.length > 0 && !verTodas;
    // El valor actual va siempre en la lista, aunque no esté en el catálogo: es
    // justamente el caso de la marca que no existe todavía, y sin él el selector se vería
    // vacío y parecería que se perdió lo que la celda decía.
    const visibles = [...new Set([valor, ...(corta ? sugerencias : opciones)].filter(Boolean))];

    return (
      <select
        className="form-control mapper-celda-edit"
        value={valor}
        aria-label={etiqueta}
        onChange={(e) => {
          if (e.target.value === VER_TODAS) setVerTodas(true);
          else onCambio(e.target.value);
        }}
      >
        <option value="">— sin dato —</option>
        {visibles.map((o) => (
          <option key={o} value={o}>
            {corta && o !== valor ? `${o} — parecido` : o}
          </option>
        ))}
        {corta && <option value={VER_TODAS}>ver todas…</option>}
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
      // El texto se confirma al salir del campo y no en cada tecla: cada cambio rehace la
      // transformación del archivo completo, y hacerlo por letra se siente pesado con
      // listas largas. Los selectores sí avisan al instante, que es un evento por elección.
      onBlur={() => borrador !== valor && onCambio(borrador)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setBorrador(valor);
      }}
    />
  );
};

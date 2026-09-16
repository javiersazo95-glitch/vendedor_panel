/**
 * El orden en que se le muestran al vendedor las filas del resultado de una carga masiva.
 */

/** Lo mínimo que necesita una fila para ordenarse: el resto del objeto no se mira. */
interface FilaOrdenable {
  fila: number;
  estado: 'OK' | 'ADVERTENCIA' | 'ERROR';
}

/** Primero lo que no se cargó, después lo que se cargó distinto, y al final lo que salió bien. */
const PRIORIDAD: Record<FilaOrdenable['estado'], number> = {
  ERROR: 0,
  ADVERTENCIA: 1,
  OK: 2,
};

/**
 * Ordena las filas de una carga poniendo adelante las que piden atención.
 *
 * El backend las devuelve en el orden del archivo. Con 2.000 filas y las advertencias repartidas
 * entre ellas, el vendedor tenía que recorrer cientos de filas OK dentro de un recuadro con scroll
 * para encontrar las que fallaron: el contador decía "106 con advertencia" y no había forma de
 * llegar a ellas salvo buscándolas a mano.
 *
 * Dentro de cada grupo se conserva el orden del archivo, para que el número de fila siga siendo
 * una referencia utilizable contra el Excel del vendedor. No modifica el arreglo recibido.
 */
export function ordenarFilasPorEstado<T extends FilaOrdenable>(filas: T[]): T[] {
  return [...filas].sort(
    (a, b) => (PRIORIDAD[a.estado] ?? 3) - (PRIORIDAD[b.estado] ?? 3) || a.fila - b.fila,
  );
}

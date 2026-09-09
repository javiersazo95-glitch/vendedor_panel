/** Tipos de los casos crudos, para que los tests del panel los lean con TypeScript. */
export interface CasoCrudo {
  /** Identificador y nombre del .xlsx que genera `generar.mjs`. */
  id: string;
  titulo: string;
  /** Qué parte del flujo pone a prueba este archivo. */
  prueba: string;
  /** La hoja tal cual la escribió el vendedor, sin limpiar. */
  aoa: unknown[][];
}

export declare const CASOS_CRUDOS: CasoCrudo[];

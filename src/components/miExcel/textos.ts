/** Textos y datos fijos del asistente "Mi propio Excel", compartidos por sus pantallas. */
import type { PasoMiExcel } from '../../utils/miExcelBorrador';

export const PASOS_MI_EXCEL: { n: PasoMiExcel; titulo: string; detalle: string }[] = [
  { n: 1, titulo: 'Sube tu archivo', detalle: 'Tu Excel y tus fotos' },
  { n: 2, titulo: 'Relaciona', detalle: 'Tus columnas con las de RepuesTop' },
  { n: 3, titulo: 'Completa', detalle: 'Lo que falta, en amarillo' },
  { n: 4, titulo: 'Revisa y publica', detalle: 'Cómo quedará en tu tienda' },
];

/** Número con separador de miles chileno y la palabra en singular o plural. */
export const plural = (n: number, singular: string, pluralTexto: string) =>
  `${n.toLocaleString('es-CL')} ${n === 1 ? singular : pluralTexto}`;

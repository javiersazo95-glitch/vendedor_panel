/** Textos y datos fijos del asistente de carga con Excel, compartidos por sus pantallas. */
import type { PasoMiExcel, TipoCarga } from '../../utils/miExcelBorrador';

export interface PasoVisible {
  /** La etapa interna (1 a 4): con la plantilla no hay etapa 2. */
  n: PasoMiExcel;
  /** El número que ve el vendedor. */
  numero: number;
  titulo: string;
  detalle: string;
}

export const PASOS_MI_EXCEL: PasoVisible[] = [
  { n: 1, numero: 1, titulo: 'Sube tu archivo', detalle: 'Tu Excel y tus fotos' },
  { n: 2, numero: 2, titulo: 'Relaciona', detalle: 'Tus columnas con las de RepuesTop' },
  { n: 3, numero: 3, titulo: 'Completa', detalle: 'Lo que falta, en amarillo' },
  { n: 4, numero: 4, titulo: 'Revisa y publica', detalle: 'Cómo quedará en tu tienda' },
];

/** Con la plantilla de RepuesTop las columnas ya son las nuestras: no hay nada que relacionar. */
export const PASOS_PLANTILLA: PasoVisible[] = [
  { n: 1, numero: 1, titulo: 'Sube tu archivo', detalle: 'La plantilla y tus fotos' },
  { n: 3, numero: 2, titulo: 'Corrige', detalle: 'Lo que falta o tiene errores' },
  { n: 4, numero: 3, titulo: 'Revisa y publica', detalle: 'Cómo quedará en tu tienda' },
];

export const pasosDe = (tipo: TipoCarga): PasoVisible[] => (tipo === 'plantilla' ? PASOS_PLANTILLA : PASOS_MI_EXCEL);

/** La etapa como la ve el vendedor ("Paso 2 de 3: Corrige"). */
export const pasoVisible = (tipo: TipoCarga, paso: PasoMiExcel): PasoVisible =>
  pasosDe(tipo).find((p) => p.n === paso) ?? pasosDe(tipo)[0];

export const NOMBRE_TIPO: Record<TipoCarga, string> = {
  'mi-excel': 'Tu propio Excel',
  plantilla: 'Plantilla de RepuesTop',
};

/** Número con separador de miles chileno y la palabra en singular o plural. */
export const plural = (n: number, singular: string, pluralTexto: string) =>
  `${n.toLocaleString('es-CL')} ${n === 1 ? singular : pluralTexto}`;

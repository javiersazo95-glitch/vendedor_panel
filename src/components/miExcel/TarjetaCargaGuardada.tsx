/**
 * Una carga con Excel que quedó sin terminar, contada en simple: qué archivo, de qué tipo, en qué
 * paso iba (con los pasos dibujados) y cuándo se guardó. La usan la pregunta "¿Qué tienes?" (en
 * una línea, `compacta`) y la ventana que ofrece retomarla al entrar a la carga.
 */
import type { ReactNode } from 'react';
import { Check, FileSpreadsheet, Wand2 } from 'lucide-react';
import { cuandoSeGuardo, fotosAsignadas, type EstadoBorrador } from '../../utils/miExcelBorrador';
import { NOMBRE_TIPO, pasosDe, pasoVisible, plural } from './textos';
import './miExcel.css';

interface Props {
  estado: EstadoBorrador;
  updatedAt: string;
  /** Botones de la tarjeta (continuar, descartar…). */
  acciones?: ReactNode;
  /** En una línea, para la pregunta "¿Qué tienes?". */
  compacta?: boolean;
}

export function TarjetaCargaGuardada({ estado, updatedAt, acciones, compacta = false }: Props) {
  const pasos = pasosDe(estado.tipo);
  const actual = pasoVisible(estado.tipo, estado.paso);
  const fotos = fotosAsignadas(estado.fotos.asignaciones).length;
  const Icono = estado.tipo === 'plantilla' ? FileSpreadsheet : Wand2;
  return (
    <section
      className={`mx-guardada ${compacta ? 'compacta' : ''}`}
      aria-label={`Carga sin terminar: ${NOMBRE_TIPO[estado.tipo]}`}
    >
      <div className="mx-guardada-fila">
        <span className="mx-guardada-icono" aria-hidden="true"><Icono size={compacta ? 22 : 24} /></span>
        <div className="mx-guardada-cuerpo">
          <span className="mx-guardada-tipo">{NOMBRE_TIPO[estado.tipo]}</span>
          <strong className="mx-guardada-archivo" title={estado.archivo?.nombre}>{estado.archivo?.nombre}</strong>
          <span className="mx-guardada-meta">
            Guardada {cuandoSeGuardo(updatedAt)}
            {estado.archivo?.filas ? <> · {plural(estado.archivo.filas, 'repuesto', 'repuestos')}</> : null}
            {!compacta && <> · {fotos === 0 ? 'sin fotos asignadas' : plural(fotos, 'foto asignada', 'fotos asignadas')}</>}
          </span>
          <div className="mx-guardada-progreso">
            <ol aria-hidden="true">
              {pasos.map((p) => (
                <li key={p.n} className={p.n < estado.paso ? 'listo' : p.n === estado.paso ? 'actual' : ''}>
                  {p.n < estado.paso ? <Check size={11} strokeWidth={3} /> : p.numero}
                </li>
              ))}
            </ol>
            <span>Ibas en el <b>paso {actual.numero} de {pasos.length}: {actual.titulo}</b></span>
          </div>
        </div>
      </div>
      {acciones && <div className="mx-guardada-acciones">{acciones}</div>}
    </section>
  );
}

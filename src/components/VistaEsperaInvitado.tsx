import { useEffect, useRef, useState } from 'react';
import { cancelarSolicitud, estadoDelAcceso, reenviarCorreo, type AccesoDTO } from '../utils/accesoAsistidoApi';
import { TITULO_NIVEL, tonoRestante, useRestante, type InvitadoSesion } from '../utils/modoInvitado';

interface Props {
  token: string;
  invitado: InvitadoSesion;
  /** El estado cambio (autorizado, rechazado, vencido...): App decide a donde sigue el invitado. */
  onCambio: (acceso: AccesoDTO) => void;
  onSalir: () => void;
}

const SONDEO_MS = 5000;

/**
 * Lo que ve soporte mientras el vendedor decide: a quien espera, hasta cuando vale la solicitud y que puede
 * hacer. Consulta el estado cada 5 s y avisa a App cuando deja de estar pendiente (autorizada, rechazada,
 * vencida o cancelada).
 */
export function VistaEsperaInvitado({ token, invitado, onCambio, onSalir }: Props) {
  const restante = useRestante(invitado.solicitudExpiraEn, invitado.offsetMs);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const cambio = useRef(onCambio);
  useEffect(() => { cambio.current = onCambio; });

  useEffect(() => {
    let vivo = true;
    const consultar = async () => {
      try {
        const acceso = await estadoDelAcceso(token);
        if (vivo && acceso.estado !== 'PENDIENTE_VENDEDOR') cambio.current(acceso);
      } catch {
        // Un fallo de red no cambia nada: se vuelve a intentar en el siguiente ciclo.
      }
    };
    const id = window.setInterval(consultar, SONDEO_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [token]);

  // Si el contador llega a cero, el servidor la deja vencida en el siguiente ciclo; se consulta ya.
  useEffect(() => {
    if (restante.vencido) {
      void estadoDelAcceso(token).then((acceso) => cambio.current(acceso)).catch(() => {});
    }
  }, [restante.vencido, token]);

  const ejecutar = async (accion: () => Promise<AccesoDTO>, exito: string) => {
    setOcupado(true);
    setMensaje(null);
    try {
      const acceso = await accion();
      setMensaje(exito);
      if (acceso.estado !== 'PENDIENTE_VENDEDOR') onCambio(acceso);
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : 'No se pudo completar la acción.');
    } finally {
      setOcupado(false);
    }
  };

  const tono = tonoRestante(restante.ms);

  return (
    <div className="espera-invitado" role="status" aria-live="polite">
      <div className="espera-invitado-tarjeta">
        <span className="espera-invitado-etiqueta">Modo invitado · Soporte RepuesTop</span>
        <h1>Esperando que {invitado.tienda} autorice el acceso</h1>
        <p>
          Enviamos un correo al vendedor con lo que pides: <strong>{TITULO_NIVEL[invitado.nivelSolicitado]}</strong>.
          Cuando elija por cuánto tiempo darte acceso, esta ventana entrará sola a su panel.
        </p>

        <div className={`espera-invitado-contador tono-${tono}`}>
          <span>La solicitud vence en</span>
          <strong>{restante.texto}</strong>
        </div>

        {mensaje && <p className="espera-invitado-mensaje">{mensaje}</p>}

        <div className="espera-invitado-acciones">
          <button type="button" disabled={ocupado} onClick={() => void ejecutar(() => reenviarCorreo(token), 'Correo reenviado al vendedor.')}>
            Reenviar correo
          </button>
          <button type="button" disabled={ocupado} onClick={() => void ejecutar(() => cancelarSolicitud(token), 'Solicitud cancelada.')}>
            Cancelar solicitud
          </button>
          <button type="button" className="secundario" disabled={ocupado} onClick={onSalir}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

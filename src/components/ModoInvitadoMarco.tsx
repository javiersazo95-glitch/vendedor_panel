import { useEffect, useRef, type ReactNode } from 'react';
import { estadoDelAcceso, type AccesoDTO } from '../utils/accesoAsistidoApi';
import { ModoInvitadoProvider } from './ModoInvitadoProvider';
import { TITULO_NIVEL, tonoRestante, useRestante, type InvitadoSesion } from '../utils/modoInvitado';

interface MarcoProps {
  token: string;
  invitado: InvitadoSesion;
  children: ReactNode;
  /** El acceso dejo de estar activo (vencio o el vendedor lo revoco). */
  onCambio: (acceso: AccesoDTO) => void;
  onSalir: () => void;
}

const SONDEO_MS = 30000;

/**
 * Marco del modo invitado: borde ambar alrededor de toda la ventana y una barra fija arriba que dice quien esta
 * dentro, con que permiso y cuanto tiempo queda. Es lo que le avisa a soporte que NO esta en su propio panel.
 * Revisa el estado cada 30 s para enterarse si el vendedor revoco el acceso.
 */
export function ModoInvitadoMarco({ token, invitado, children, onCambio, onSalir }: MarcoProps) {
  const restante = useRestante(invitado.expiraEn, invitado.offsetMs, null);
  const cambio = useRef(onCambio);
  useEffect(() => { cambio.current = onCambio; });

  useEffect(() => {
    document.documentElement.classList.add('modo-invitado');
    return () => document.documentElement.classList.remove('modo-invitado');
  }, []);

  useEffect(() => {
    let vivo = true;
    const consultar = async () => {
      try {
        const acceso = await estadoDelAcceso(token);
        if (vivo && acceso.estado !== 'ACTIVO') cambio.current(acceso);
      } catch {
        // Un 401 ya lo maneja apiFetch (pantalla de acceso terminado); un fallo de red se reintenta.
      }
    };
    const id = window.setInterval(consultar, SONDEO_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [token]);

  useEffect(() => {
    if (restante.vencido) {
      void estadoDelAcceso(token).then((acceso) => cambio.current(acceso)).catch(() => {});
    }
  }, [restante.vencido, token]);

  const tono = tonoRestante(restante.ms);

  return (
    <ModoInvitadoProvider invitado={invitado}>
      <div className="invitado-borde" aria-hidden="true" />
      <div className="invitado-barra" role="status">
        <span className="invitado-barra-texto">
          <strong>Modo invitado</strong> · Soporte RepuesTop en <strong>{invitado.tienda}</strong>
          {invitado.nivel && <> · {TITULO_NIVEL[invitado.nivel]}</>}
        </span>
        <span className={`invitado-barra-contador tono-${tono}`} title="Tiempo que queda de acceso">
          Vence en {restante.texto}
        </span>
        <button type="button" className="invitado-barra-salir" onClick={onSalir}>
          Salir
        </button>
      </div>
      {children}
    </ModoInvitadoProvider>
  );
}

const MENSAJES: Partial<Record<AccesoDTO['estado'], { titulo: string; detalle: string }>> = {
  RECHAZADO: { titulo: 'El vendedor rechazó la solicitud', detalle: 'No se concedió ningún acceso.' },
  REVOCADO: { titulo: 'El vendedor cortó el acceso', detalle: 'Tu sesión de invitado terminó.' },
  EXPIRADO: { titulo: 'El acceso venció', detalle: 'Si necesitas seguir, solicita de nuevo desde el backoffice.' },
  CANCELADO: { titulo: 'La solicitud fue cancelada', detalle: 'No se concedió ningún acceso.' },
  FINALIZADO: { titulo: 'Terminaste el acceso', detalle: 'El vendedor recibirá un resumen de lo que cargaste.' },
};

/** Pantalla final del invitado: dice por que ya no esta dentro. No ofrece iniciar sesion: no es un vendedor. */
export function PantallaAccesoTerminado({ estado, comentario }: { estado: AccesoDTO['estado'] | 'DESCONOCIDO'; comentario?: string | null }) {
  const info = (estado !== 'DESCONOCIDO' && MENSAJES[estado]) || {
    titulo: 'El acceso ya no está vigente',
    detalle: 'Venció o el vendedor lo revocó.',
  };
  return (
    <div className="espera-invitado" role="status">
      <div className="espera-invitado-tarjeta">
        <span className="espera-invitado-etiqueta">Modo invitado · Soporte RepuesTop</span>
        <h1>{info.titulo}</h1>
        <p>{info.detalle}</p>
        {comentario && <p className="espera-invitado-mensaje">El vendedor comentó: {comentario}</p>}
        <p>Ya puedes cerrar esta ventana.</p>
      </div>
    </div>
  );
}

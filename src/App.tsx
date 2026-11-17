import { useEffect, useRef, useState } from 'react';
import { AdhesionContractModal } from './components/AdhesionContractModal';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { logout, revocarSesionVencida } from './db';
import { ModoInvitadoMarco, PantallaAccesoTerminado } from './components/ModoInvitadoMarco';
import { VistaEsperaInvitado } from './components/VistaEsperaInvitado';
import { aInvitadoSesion, canjearTicket, salirDelAcceso, type AccesoDTO } from './utils/accesoAsistidoApi';
import { EVENTO_ACCESO_TERMINADO } from './utils/apiFetch';
import { EVENTO_SESION_VENCIDA, clearSession, getStoredSession, saveSession, tomarTokenPorRevocar, type UserSession } from './utils/session';

/** Ticket de entrada que el backoffice deja en el hash (#ticket=...). Se lee una sola vez y se borra de la URL. */
function tomarTicketDeLaUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const ticket = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('ticket');
  if (ticket) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return ticket && ticket.length <= 100 ? ticket : null;
}

function App() {
  const [session, setSession] = useState<UserSession | null>(() => getStoredSession());
  // Acceso asistido: ticket del hash por canjear, y lo que ve soporte cuando el acceso termina.
  const [ticketInicial] = useState<string | null>(tomarTicketDeLaUrl);
  const ticketUsado = useRef(false);
  const [canjeando, setCanjeando] = useState(ticketInicial !== null);
  const [errorCanje, setErrorCanje] = useState<string | null>(null);
  const [terminado, setTerminado] = useState<{ estado: AccesoDTO['estado'] | 'DESCONOCIDO'; comentario?: string | null } | null>(null);

  useEffect(() => {
    const ticket = ticketInicial;
    // El ticket es de un solo uso: StrictMode corre este efecto dos veces en desarrollo y el segundo canje fallaria.
    if (!ticket || ticketUsado.current) return;
    ticketUsado.current = true;
    // El ticket manda sobre cualquier sesion previa de la pestana: es una entrada nueva como invitado.
    clearSession();
    setSession(null);
    canjearTicket(ticket)
      .then(({ token, acceso }) => {
        const user: UserSession = {
          email: acceso.operadorNombre ?? 'Soporte RepuesTop',
          role: 'Soporte (invitado)',
          token,
          sellerId: String(acceso.proveedorId),
          invitado: aInvitadoSesion(acceso),
        };
        saveSession(user);
        setSession(user);
      })
      .catch((err) => setErrorCanje(err instanceof Error ? err.message : 'No se pudo abrir el acceso.'))
      .finally(() => setCanjeando(false));
  }, [ticketInicial]);

  useEffect(() => {
    const alTerminar = () => { setSession(null); setTerminado({ estado: 'DESCONOCIDO' }); };
    window.addEventListener(EVENTO_ACCESO_TERMINADO, alTerminar);
    return () => window.removeEventListener(EVENTO_ACCESO_TERMINADO, alTerminar);
  }, []);

  /** El estado del acceso cambio: si autorizaron, se entra al panel; si no, se muestra por que termino. */
  const alCambiarAcceso = (acceso: AccesoDTO) => {
    if (!session?.invitado) return;
    if (acceso.estado === 'ACTIVO' || acceso.estado === 'PENDIENTE_VENDEDOR') {
      const actualizado: UserSession = { ...session, invitado: aInvitadoSesion(acceso) };
      saveSession(actualizado);
      setSession(actualizado);
      return;
    }
    clearSession();
    setSession(null);
    setTerminado({ estado: acceso.estado, comentario: acceso.comentarioRechazo });
  };

  const salirDeInvitado = () => {
    const token = session?.token;
    const estado = session?.invitado?.estado;
    if (token) void salirDelAcceso(token).catch(() => {});
    clearSession();
    setSession(null);
    setTerminado({ estado: estado === 'ACTIVO' ? 'FINALIZADO' : 'DESCONOCIDO' });
  };

  const handleLogin = (email: string, role: string, token: string, sellerId: string, founder: boolean, founderUntil: string | null) => {
    const user: UserSession = { email, role, token, sellerId, founder, founderUntil };
    setSession(user);
    saveSession(user);
  };

  const handleLogout = () => {
    // El servidor primero: sin esta llamada el token sigue sirviendo hasta su `exp` y cerrar
    // sesion es solo un gesto visual (SEC-MARKET-B06). No se espera la respuesta ni se deja
    // que un fallo de red retenga al vendedor dentro del panel: la limpieza local va igual.
    void logout().catch(() => {});
    setSession(null);
    clearSession();
  };

  useEffect(() => {
    // Vencer la sesion en el navegador no la cerraba en el servidor (SEC-MARKET-B03): el panel la
    // daba por terminada a las 2 h mientras el token seguia canjeable durante horas. Se revoca
    // aca, que es donde vive el ciclo de vida de la sesion.
    //
    // Se hacen las dos cosas porque el vencimiento puede detectarse antes o despues de montar:
    // al entrar con una sesion ya vencida lo descubre el propio useState de arriba, y con la
    // pestana abierta lo descubre la primera llamada que pida la sesion.
    const revocarPendiente = () => {
      const token = tomarTokenPorRevocar();
      if (!token) return;
      void revocarSesionVencida(token).catch(() => {});
      setSession(null);
    };

    revocarPendiente();
    window.addEventListener(EVENTO_SESION_VENCIDA, revocarPendiente);
    return () => window.removeEventListener(EVENTO_SESION_VENCIDA, revocarPendiente);
  }, []);

  useEffect(() => {
    // apiFetch() clears the session and fires this event on any 401/403, so a
    // vendor whose token expires mid-session is bounced back to the login
    // screen instead of being stuck retrying with a dead token (QA-SRC-004).
    const onSessionExpired = () => setSession(null);
    window.addEventListener('repuestop:session-expired', onSessionExpired);
    return () => window.removeEventListener('repuestop:session-expired', onSessionExpired);
  }, []);

  if (canjeando) return <div className="espera-invitado" role="status"><div className="espera-invitado-tarjeta"><h1>Abriendo el acceso…</h1></div></div>;
  if (errorCanje) return <PantallaAccesoTerminado estado="DESCONOCIDO" comentario={errorCanje} />;
  if (terminado) return <PantallaAccesoTerminado estado={terminado.estado} comentario={terminado.comentario} />;

  if (session?.invitado) {
    const { invitado } = session;
    if (invitado.estado === 'PENDIENTE_VENDEDOR') {
      return (
        <>
          <div className="invitado-borde" aria-hidden="true" />
          <VistaEsperaInvitado token={session.token} invitado={invitado} onCambio={alCambiarAcceso} onSalir={salirDeInvitado} />
        </>
      );
    }
    return (
      <ModoInvitadoMarco token={session.token} invitado={invitado} onCambio={alCambiarAcceso} onSalir={salirDeInvitado}>
        {/* Sin AdhesionContractModal: el contrato lo firma el vendedor; el backend exige que ya este vigente. */}
        <Dashboard userEmail={session.email} userRole={session.role} founder={false} founderUntil={null} onLogout={salirDeInvitado} />
      </ModoInvitadoMarco>
    );
  }

  return (
    <>
      {session ? (
        <>
          <Dashboard userEmail={session.email} userRole={session.role} founder={session.founder === true} founderUntil={session.founderUntil ?? null} onLogout={handleLogout} />
          {/* key: si cambia el vendedor en la misma pestaña, se vuelve a consultar su contrato. */}
          <AdhesionContractModal key={session.sellerId} onLogout={handleLogout} />
        </>
      ) : (
        <Auth onLogin={handleLogin} />
      )}
    </>
  );
}

export default App;

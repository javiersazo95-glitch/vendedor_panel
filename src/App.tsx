import { useEffect, useState } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { logout, revocarSesionVencida } from './db';
import { EVENTO_SESION_VENCIDA, clearSession, getStoredSession, saveSession, tomarTokenPorRevocar, type UserSession } from './utils/session';

function App() {
  const [session, setSession] = useState<UserSession | null>(() => getStoredSession());

  const handleLogin = (email: string, role: string, token: string, sellerId: string, founder: boolean) => {
    const user: UserSession = { email, role, token, sellerId, founder };
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

  return (
    <>
      {session ? (
        <Dashboard userEmail={session.email} userRole={session.role} founder={session.founder === true} onLogout={handleLogout} />
      ) : (
        <Auth onLogin={handleLogin} />
      )}
    </>
  );
}

export default App;

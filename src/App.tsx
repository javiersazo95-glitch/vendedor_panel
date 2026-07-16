import { useEffect, useState } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { clearSession, getStoredSession, saveSession, type UserSession } from './utils/session';

function App() {
  const [session, setSession] = useState<UserSession | null>(() => getStoredSession());

  const handleLogin = (email: string, role: string, token: string, sellerId: string, founder: boolean) => {
    const user: UserSession = { email, role, token, sellerId, founder };
    setSession(user);
    saveSession(user);
  };

  const handleLogout = () => {
    setSession(null);
    clearSession();
  };

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

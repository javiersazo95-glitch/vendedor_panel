import { useState } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { clearSession, getStoredSession, saveSession, type UserSession } from './utils/session';

function App() {
  const [session, setSession] = useState<UserSession | null>(() => getStoredSession());

  const handleLogin = (email: string, role: string, token: string, sellerId: string) => {
    const user: UserSession = { email, role, token, sellerId };
    setSession(user);
    saveSession(user);
  };

  const handleLogout = () => {
    setSession(null);
    clearSession();
  };

  return (
    <>
      {session ? (
        <Dashboard userEmail={session.email} userRole={session.role} onLogout={handleLogout} />
      ) : (
        <Auth onLogin={handleLogin} />
      )}
    </>
  );
}

export default App;

import { useState, useEffect } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';

export interface UserSession {
  email: string;
  role: string;
  token: string;
  sellerId: string;
}

function App() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on load
  useEffect(() => {
    const savedSession = localStorage.getItem('repuestop_session');
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        // Simulating expiry (e.g. valid for 2 hours)
        const age = Date.now() - parsed.timestamp;
        if (age < 2 * 60 * 60 * 1000) {
          setSession(parsed.user);
        } else {
          localStorage.removeItem('repuestop_session');
        }
      } catch (e) {
        localStorage.removeItem('repuestop_session');
      }
    }
    setLoading(false);
  }, []);

  const handleLogin = (email: string, role: string, token: string, sellerId: string) => {
    const user: UserSession = { email, role, token, sellerId };
    setSession(user);
    
    // Store in localStorage with timestamp
    localStorage.setItem(
      'repuestop_session',
      JSON.stringify({
        user,
        timestamp: Date.now(),
      })
    );
  };

  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem('repuestop_session');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)' }}>
        <div style={{ textAlign: 'center' }}>
          <h2>Cargando RepuesTop...</h2>
        </div>
      </div>
    );
  }

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

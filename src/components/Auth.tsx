import React, { useState } from 'react';
import { Shield, Key, Mail, Zap, Cloud } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { API_BASE_URL } from '../utils/imageHelper';
import loginHero from '../assets/login_hero.png';
import logoImg from '../assets/logo.png';

// Icono del Logotipo Oficial de RespuesTop (Engranaje + Auto Deportivo + Checkmark)
export const LogoIcon: React.FC<{ size?: number }> = () => (
  <svg width="42" height="34" viewBox="0 0 46 38" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
    {/* Engranaje de fondo */}
    <path d="M14 6C14 4.89543 14.8954 4 16 4H18C19.1046 4 20 4.89543 20 6V8C20 9.10457 19.1046 10 18 10H16C14.8954 10 14 9.10457 14 8V6Z" fill="#1b64da" />
    <path d="M14 22C14 20.8954 14.8954 20 16 20H18C19.1046 20 20 20.8954 20 22V24C20 25.1046 19.1046 26 18 26H16C14.8954 26 14 25.1046 14 24V22Z" fill="#1b64da" />
    <path d="M6 14C4.89543 14 4 14.8954 4 16V18C4 19.1046 4.89543 20 6 20H8C9.10457 20 10 19.1046 10 18V16C10 14.8954 9.10457 14 8 14H6Z" fill="#1b64da" />
    <path d="M22 14C20.8954 14 20 14.8954 20 16V18C20 19.1046 20.8954 20 22 20H24C25.1046 20 26 19.1046 26 18V16C26 14.8954 25.1046 14 24 14H22Z" fill="#1b64da" />
    
    <path d="M8.5 8.5C7.7268 7.7268 7.7268 6.4732 8.5 5.7L9.9 4.3C10.6732 3.5268 11.9268 3.5268 12.7 4.3L14.1 5.7C14.8732 6.4732 14.8732 7.7268 14.1 8.5L12.7 9.9C11.9268 10.6732 10.6732 10.6732 9.9 9.9L8.5 8.5Z" fill="#1b64da" />
    <path d="M19.9 19.9C19.1268 19.1268 19.1268 17.8732 19.9 17.1L21.3 15.7C22.0732 14.9268 23.3268 14.9268 24.1 15.7L25.5 17.1C26.2732 17.8732 26.2732 19.1268 25.5 19.9L24.1 21.3C23.3268 22.0732 22.0732 22.0732 21.3 21.3L19.9 19.9Z" fill="#1b64da" />
    <path d="M8.5 17.1C7.7268 17.8732 7.7268 19.1268 8.5 19.9L9.9 21.3C10.6732 22.0732 11.9268 22.0732 12.7 21.3L14.1 19.9C14.8732 19.1268 14.8732 17.8732 14.1 17.1L12.7 15.7C11.9268 14.9268 10.6732 14.9268 9.9 15.7L8.5 17.1Z" fill="#1b64da" />
    
    <circle cx="17" cy="17" r="7" fill="#1b64da" />
    <circle cx="17" cy="17" r="4.5" fill="#f8fafc" />
    
    {/* Silueta del auto deportivo */}
    <path d="M12 28C10.3431 28 9 29.3431 9 31C9 32.6569 10.3431 34 12 34C13.6569 34 15 32.6569 15 31C15 29.3431 13.6569 28 12 28Z" fill="#0f172a" stroke="#1b64da" strokeWidth="1.5" />
    <path d="M34 28C32.3431 28 31 29.3431 31 31C31 32.6569 32.3431 34 34 34C35.6569 34 37 32.6569 37 31C37 29.3431 35.6569 28 34 28Z" fill="#0f172a" stroke="#1b64da" strokeWidth="1.5" />
    
    <path d="M6 31H9C9.5 27 12 26 15 26H28C31 26 33.5 27 34 31H39C40.5 31 41 30 41 29C41 27 39 25 35 24C34.5 23.5 33 21 31 20H19C15 20 12.5 23 11 25C9.5 25.5 6 26.5 6 28C6 29.5 5.5 31 6 31Z" fill="#1b64da" />
    <path d="M19.5 21H29.5L31.5 25H17.5L19.5 21Z" fill="#ffffff" />
    
    {/* Tick checkmark de validación */}
    <path d="M14.5 17L16.5 19L20 15" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface AuthProps {
  onLogin: (email: string, role: string, token: string, sellerId: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error de conexión con el servidor.';
}

async function procesarRespuestaLogin(response: Response, onLogin: AuthProps['onLogin']) {
  if (!response.ok) {
    let errMsg = response.status === 401
      ? 'Credenciales incorrectas. Por favor, verifica tu correo y contraseña.'
      : 'Credenciales incorrectas o error de conexión.';
    try {
      const errData: unknown = await response.json();
      if (isRecord(errData) && typeof errData.message === 'string') {
        errMsg = errData.message;
      }
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const data: unknown = await response.json();

  // Check if user has a seller profile associated
  if (!isRecord(data) || (typeof data.sellerId !== 'string' && typeof data.sellerId !== 'number')) {
    throw new Error('Acceso denegado. Esta cuenta está registrada como Comprador. Este panel es exclusivo para perfiles de tipo Proveedor (Vendedor).');
  }

  if (!isRecord(data.usuario) || typeof data.usuario.email !== 'string' || typeof data.token !== 'string') {
    throw new Error('Respuesta inválida del servidor.');
  }

  onLogin(data.usuario.email, 'Vendedor', data.token, String(data.sellerId));
}

export const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!email || !password) {
      setError('Por favor, completa todos los campos.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password
        })
      });

      await procesarRespuestaLogin(response, onLogin);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credential?: string) => {
    if (!credential) {
      setError('No se pudo obtener la credencial de Google.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ idToken: credential })
      });

      await procesarRespuestaLogin(response, onLogin);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-content">
      <div className="auth-wrapper">
        
        {/* Columna Izquierda: Branding e Ilustración */}
        <div className="auth-left-panel">
          <span className="auth-eyebrow">Panel de Proveedores</span>

          <h1>
            Gestiona tu inventario,<br />
            <span className="text-blue">impulsa tu negocio.</span>
          </h1>
          
          <p className="auth-description">
            RepuesTop te ayuda a tener el control total de tu inventario, ventas y proveedores en un solo lugar.
          </p>
          
          <div className="auth-branding-row">
            <div className="auth-features-list">
              <div className="auth-feature-item">
                <div className="auth-feature-icon-wrapper">
                  <Shield size={20} />
                </div>
                <div className="auth-feature-content">
                  <h4>Seguro y Confiable</h4>
                  <p>Tus datos siempre protegidos.</p>
                </div>
              </div>
              
              <div className="auth-feature-item">
                <div className="auth-feature-icon-wrapper">
                  <Zap size={20} />
                </div>
                <div className="auth-feature-content">
                  <h4>Rápido y Eficiente</h4>
                  <p>Todo lo que necesitas en segundos.</p>
                </div>
              </div>
              
              <div className="auth-feature-item">
                <div className="auth-feature-icon-wrapper">
                  <Cloud size={20} />
                </div>
                <div className="auth-feature-content">
                  <h4>Acceso en la Nube</h4>
                  <p>Disponible desde cualquier dispositivo.</p>
                </div>
              </div>
            </div>
            
            <div className="auth-hero-image-container">
              <img 
                src={loginHero} 
                alt="Repuestos y Dashboard 3D" 
                className="auth-hero-image" 
              />
            </div>
          </div>
          <div className="auth-dots-decor top-right"></div>
          <div className="auth-dots-decor bottom-left"></div>
        </div>

        {/* Columna Derecha: Tarjeta de Formulario de Login */}
        <div className="auth-right-panel">
          <div className="auth-card">
            <div className="logo-container-center">
              <img src={logoImg} alt="RepuesTop Logo" className="logo-image-card" />
            </div>
            
            <h2>Control de Inventario</h2>
            <p className="auth-subtitle">Inicia sesión con tu cuenta de Vendedor</p>
            
            {error && (
              <div 
                className="auth-error" 
                style={{ 
                  marginBottom: '1.5rem', 
                  padding: '0.85rem 1rem', 
                  background: '#fef2f2', 
                  border: '1px solid #fee2e2', 
                  borderRadius: '12px', 
                  color: '#ef4444', 
                  fontSize: '0.85rem', 
                  fontWeight: 600,
                  textAlign: 'center',
                  boxShadow: '0 2px 4px rgba(239, 68, 68, 0.05)'
                }}
              >
                {error}
              </div>
            )}
            
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <label className="form-label" htmlFor="email">
                  Correo Electrónico
                </label>
                <div style={{ position: 'relative' }}>
                  <Mail 
                    size={16} 
                    style={{ 
                      position: 'absolute', 
                      left: '1rem', 
                      top: '50%', 
                      transform: 'translateY(-50%)', 
                      color: '#94a3b8' 
                    }} 
                  />
                  <input
                    id="email"
                    type="email"
                    className="form-control"
                    placeholder="correo@empresa.cl"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label className="form-label" htmlFor="password">
                  Contraseña
                </label>
                <div style={{ position: 'relative' }}>
                  <Key 
                    size={16} 
                    style={{ 
                      position: 'absolute', 
                      left: '1rem', 
                      top: '50%', 
                      transform: 'translateY(-50%)', 
                      color: '#94a3b8' 
                    }} 
                  />
                  <input
                    id="password"
                    type="password"
                    className="form-control"
                    placeholder="•••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
              >
                {loading ? 'Ingresando...' : 'Ingresar al Panel'}
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 'clamp(0.6rem, 2vh, 1.25rem) 0' }}>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
              <span style={{ fontSize: 13, color: '#94a3b8' }}>o continua con</span>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <GoogleLogin
                theme="outline"
                shape="rectangular"
                size="large"
                width="100%"
                text="continue_with"
                onSuccess={(credentialResponse) => handleGoogleSuccess(credentialResponse.credential)}
                onError={() => setError('No se pudo iniciar sesión con Google. Intenta nuevamente.')}
              />
            </div>

            <p className="auth-help-text">
              ¿No recuerdas tus datos? Usa tu misma contraseña de la App móvil.
            </p>
          </div>
        </div>

      </div>
      </div>

      {/* Footer */}
      <div className="auth-footer">
        © 2024 RespuesTop. Todos los derechos reservados.
      </div>
    </div>
  );
};

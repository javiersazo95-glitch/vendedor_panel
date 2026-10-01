import React, { useState } from 'react';
import { Shield, Key, Mail, Zap, Cloud } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { API_BASE_URL } from '../utils/imageHelper';
import { RequestTimeoutError } from '../utils/apiFetch';
import { revocarSesionVencida } from '../db';
import loginHero from '../assets/login_hero.png';
import logoImg from '../assets/logo.png';

const LOGIN_TIMEOUT_MS = 25000;

// Login happens before any session exists, so it can't reuse apiFetch's
// 401-triggers-logout behavior (a wrong password is a normal login error,
// not an expired session). It still needs the same timeout protection so a
// slow/hung backend doesn't leave the login button stuck forever (QA-SRC-006).
async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new RequestTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface AuthProps {
  onLogin: (email: string, role: string, token: string, sellerId: string, founder: boolean) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * H61 (pruebas de lanzamiento, 30-sep): el login de una tienda suspendida responde 200 con
 * `sellerBlocked`. El panel guardaba la sesion, el primer 403 la borraba y el vendedor volvia al
 * login en menos de un segundo sin saber por que (y el correo le decia que entrara al panel).
 */
export class CuentaSuspendidaError extends Error {
  readonly suspendidaHasta: string | null;
  readonly puedeApelar: boolean;

  constructor(message: string, suspendidaHasta: string | null, puedeApelar: boolean) {
    super(message);
    this.name = 'CuentaSuspendidaError';
    this.suspendidaHasta = suspendidaHasta;
    this.puedeApelar = puedeApelar;
  }
}

interface AvisoSuspension {
  motivo: string;
  suspendidaHasta: string | null;
  puedeApelar: boolean;
}

function formatearFechaLocal(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' }).format(fecha);
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

  if (data.sellerBlocked === true) {
    // No se guarda la sesion: el panel no sirve con la tienda suspendida. El token recien emitido
    // se revoca para que no quede vivo hasta su `exp`.
    void revocarSesionVencida(data.token).catch(() => {});
    throw new CuentaSuspendidaError(
      typeof data.sellerBlockReason === 'string' && data.sellerBlockReason.trim()
        ? data.sellerBlockReason.trim()
        : 'Tu tienda fue suspendida.',
      typeof data.suspendedUntil === 'string' ? data.suspendedUntil : null,
      data.sellerCanAppeal === true,
    );
  }

  onLogin(data.usuario.email, 'Vendedor', data.token, String(data.sellerId), data.founder === true);
}

export const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [suspension, setSuspension] = useState<AvisoSuspension | null>(null);
  const [loading, setLoading] = useState(false);

  const mostrarError = (err: unknown) => {
    if (err instanceof CuentaSuspendidaError) {
      setSuspension({ motivo: err.message, suspendidaHasta: err.suspendidaHasta, puedeApelar: err.puedeApelar });
      return;
    }
    setError(getErrorMessage(err));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuspension(null);
    setLoading(true);

    if (!email || !password) {
      setError('Por favor, completa todos los campos.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/auth/login`, {
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
      mostrarError(err);
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
    setSuspension(null);
    setLoading(true);
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ idToken: credential })
      });

      await procesarRespuestaLogin(response, onLogin);
    } catch (err: unknown) {
      mostrarError(err);
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
            
            {suspension && (
              <div className="auth-suspension" role="alert" data-testid="aviso-tienda-suspendida">
                <strong>Tu tienda se encuentra suspendida</strong>
                <p>{suspension.motivo}</p>
                <p>
                  Mientras dure la suspensión no puedes usar el panel.
                  {suspension.suspendidaHasta
                    ? ` La suspensión termina el ${formatearFechaLocal(suspension.suspendidaHasta)}.`
                    : ''}
                </p>
                {suspension.puedeApelar ? (
                  <p>
                    Para aportar evidencias o solicitar la revisión, entra al Market web de RepuesTop
                    con esta misma cuenta y usa «Solicitar Revisión» en el aviso de tu perfil.
                  </p>
                ) : (
                  <p>Si necesitas más información, escríbenos desde la sección de ayuda del Market web de RepuesTop.</p>
                )}
              </div>
            )}

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
                    autoComplete="username"
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
                    autoComplete="current-password"
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

            {/* O48 (pruebas de lanzamiento, 25-sep): el panel no recupera contrasenas; se indica
                donde hacerlo. Sin enlace porque el panel no conoce la URL del Market por ambiente. */}
            <p className="auth-help-text">
              ¿Olvidaste tu contraseña? El panel usa la misma de tu cuenta RepuesTop y solo se
              recupera en el Market web o en la app móvil, desde el enlace "¿Olvidaste tu
              contraseña?" del inicio de sesión.
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

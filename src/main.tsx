import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import App from './App.tsx'
import { RemoteConfigProvider } from './remoteConfig/RemoteConfigContext.tsx'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      {/* Configuración del Mantenedor común (flags, listas, parámetros): arranca acá y nunca bloquea el render. */}
      <RemoteConfigProvider>
        <App />
      </RemoteConfigProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
)

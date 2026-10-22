/**
 * El contexto de React con el estado de la configuración remota. Está en su propio archivo
 * porque `RemoteConfigContext.tsx` sólo puede exportar componentes (regla de Fast Refresh).
 *
 * Sin provider (los tests de componentes que ya existían no lo montan) el contexto trae el estado
 * vacío y cada hook devuelve su fallback: así ningún test viejo necesita cambiar.
 */
import { createContext } from 'react';
import type { EstadoRemoteConfig } from './types';

export const ESTADO_SIN_PROVIDER: EstadoRemoteConfig = { data: null, origen: 'ninguno', error: null, actualizadoEn: null };

export const RemoteConfigContext = createContext<EstadoRemoteConfig>(ESTADO_SIN_PROVIDER);

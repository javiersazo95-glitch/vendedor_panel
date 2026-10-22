/**
 * Conecta el store `remoteConfig` con React. El provider arranca el ciclo (caché, bootstrap,
 * refresco) al montarse y lo detiene al desmontarse; los hooks (`hooks.ts`) leen el estado del
 * contexto (`context.ts`).
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { RemoteConfigContext } from './context';
import { remoteConfig } from './remoteConfig';

export function RemoteConfigProvider({ children }: { children: ReactNode }) {
  const estado = useSyncExternalStore(remoteConfig.subscribe, remoteConfig.get, remoteConfig.get);

  useEffect(() => remoteConfig.iniciar(), []);

  return <RemoteConfigContext.Provider value={estado}>{children}</RemoteConfigContext.Provider>;
}

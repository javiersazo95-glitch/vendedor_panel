import type { ReactNode } from 'react';
import { ModoInvitadoContext, nivelPermite, type InvitadoSesion, type ModoInvitadoValor } from '../utils/modoInvitado';

/** Le dice a todo el panel que esta en modo invitado, con que nivel, para ocultar lo que soporte no puede hacer. */
export function ModoInvitadoProvider({ invitado, children }: { invitado: InvitadoSesion; children: ReactNode }) {
  const valor: ModoInvitadoValor = {
    activo: true,
    nivel: invitado.nivel,
    tienda: invitado.tienda,
    puede: (operacion) => nivelPermite(invitado.nivel, operacion),
  };
  return <ModoInvitadoContext.Provider value={valor}>{children}</ModoInvitadoContext.Provider>;
}

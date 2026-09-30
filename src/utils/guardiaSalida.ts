/**
 * Aviso antes de salir de una pantalla con cambios sin guardar.
 *
 * La pantalla que tiene trabajo en curso (hoy, el asistente "Mi propio Excel") registra una
 * guardia en el Dashboard. Antes de cambiar de vista -un botón del menú, cerrar sesión, "Ver
 * detalle"- el Dashboard le pregunta si hay cambios sin guardar y, si los hay, muestra el aviso
 * "¿Quieres guardar tus cambios?". Cerrar la pestaña o recargar lo cubre `beforeunload`: ahí el
 * navegador muestra su propio aviso, con un texto que ninguna página puede cambiar.
 */
import { useEffect, useRef } from 'react';

export interface GuardiaSalida {
  hayCambiosSinGuardar: () => boolean;
  /** Guarda lo pendiente. Devuelve false si no se pudo (para no salir perdiendo el trabajo). */
  guardar: () => Promise<boolean>;
}

export type RegistrarGuardia = (guardia: GuardiaSalida | null) => void;

/**
 * Registra la guardia mientras la pantalla esté montada. Las funciones se leen por referencia,
 * así el Dashboard siempre consulta el estado del momento y no el del primer render.
 */
export function useGuardiaDeSalida(registrar: RegistrarGuardia | undefined, guardia: GuardiaSalida): void {
  const ref = useRef(guardia);
  useEffect(() => {
    ref.current = guardia;
  });

  useEffect(() => {
    if (!registrar) return undefined;
    registrar({
      hayCambiosSinGuardar: () => ref.current.hayCambiosSinGuardar(),
      guardar: () => ref.current.guardar(),
    });
    return () => registrar(null);
  }, [registrar]);

  useEffect(() => {
    const alSalir = (e: BeforeUnloadEvent) => {
      if (!ref.current.hayCambiosSinGuardar()) return;
      e.preventDefault();
      // Chrome todavía pide asignar returnValue para mostrar el aviso.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, []);
}

/**
 * Los mapeos del vendedor, guardados en su cuenta.
 *
 * La relación entre las columnas de su Excel y las de RepuesTop es lo que más trabajo
 * ahorra en el uso repetido —la lista mensual del mismo proveedor llega siempre con los
 * mismos títulos— y vivía sólo en el `localStorage` del navegador: se perdía al cambiar de
 * equipo, al usar otro navegador o al limpiar los datos del sitio, y había que rehacer 18
 * relaciones a mano.
 *
 * `localStorage` se conserva como espejo local: es lo que hace que el mapeo siga
 * apareciendo cuando el backend no responde, y lo que evita esperar la red para algo que
 * ya se sabe.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import { getStoredSession } from './session';
import { encId } from './url';
import { loadSavedMapping, saveMapping, type Mapping } from './plantillaMapping';

interface MapeoRemoto {
  firma: string;
  mapeoJson: string;
  archivoNombre?: string | null;
  updatedAt?: string | null;
}

const url = (sellerId: number | string) =>
  `${API_BASE_URL}/api/v1/proveedores/${encId(sellerId)}/inventario/excel/mapeos`;

/** Convierte la respuesta del backend en mapeos utilizables, descartando los ilegibles. */
export function parsearMapeos(data: unknown): Record<string, Mapping> {
  if (!Array.isArray(data)) return {};
  const salida: Record<string, Mapping> = {};
  for (const item of data as MapeoRemoto[]) {
    if (!item?.firma || typeof item.mapeoJson !== 'string') continue;
    try {
      const mapeo = JSON.parse(item.mapeoJson);
      if (mapeo && typeof mapeo === 'object' && mapeo.oficial) salida[item.firma] = mapeo as Mapping;
    } catch {
      // Un mapeo corrupto no puede tumbar los demás: se ignora y el vendedor rehace ese.
    }
  }
  return salida;
}

export async function listarMapeos(sellerId: number | string, token: string): Promise<Record<string, Mapping>> {
  const respuesta = await apiFetch(url(sellerId), { headers: { Authorization: `Bearer ${token}` } });
  if (!respuesta.ok) return {};
  return parsearMapeos(await respuesta.json());
}

export async function guardarMapeoRemoto(
  sellerId: number | string,
  token: string,
  firma: string,
  mapping: Mapping,
  archivoNombre?: string,
): Promise<boolean> {
  const respuesta = await apiFetch(url(sellerId), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firma, mapeoJson: JSON.stringify(mapping), archivoNombre }),
  });
  return respuesta.ok;
}

export interface MapeosGuardados {
  /** firma -> mapeo, con lo de la cuenta encima de lo que hubiera en este navegador. */
  mapeos: Record<string, Mapping>;
  /** Guarda en la cuenta y en el espejo local. Nunca lanza: no puede cortar una carga. */
  guardar: (firma: string, mapping: Mapping, archivoNombre?: string) => void;
}

/**
 * Trae los mapeos de la cuenta al abrir la carga masiva y deja guardar los nuevos. Si el
 * backend no responde, se sigue con los de este navegador: perder la comodidad del mapeo
 * recordado es molesto, no poder cargar el inventario es otra cosa.
 */
export function useMapeosGuardados(activo: boolean): MapeosGuardados {
  const [mapeos, setMapeos] = useState<Record<string, Mapping>>({});
  const pedidoRef = useRef(false);

  useEffect(() => {
    if (!activo || pedidoRef.current) return;
    const session = getStoredSession();
    if (!session?.sellerId || !session?.token) return;

    pedidoRef.current = true;
    // Sin flag de "sigo montado": junto con el ref, en StrictMode descartaba la unica
    // respuesta que se pedia y los mapeos guardados no llegaban nunca (ver el mismo
    // detalle en useEsquemaPlantilla).
    listarMapeos(session.sellerId, session.token)
      .then(setMapeos)
      .catch(() => { pedidoRef.current = false; });
  }, [activo]);

  const guardar = useCallback((firma: string, mapping: Mapping, archivoNombre?: string) => {
    // El espejo local primero: si la red falla, el mapeo igual queda en este navegador.
    saveMapping(firma, mapping);
    setMapeos((prev) => ({ ...prev, [firma]: mapping }));
    const session = getStoredSession();
    if (!session?.sellerId || !session?.token) return;
    guardarMapeoRemoto(session.sellerId, session.token, firma, mapping, archivoNombre).catch(() => {
      // Queda guardado localmente; el vendedor no tiene nada que hacer con este error.
    });
  }, []);

  return { mapeos, guardar };
}

/** El mapeo de una firma: primero el de la cuenta, si no el de este navegador. */
export function mapeoParaFirma(mapeos: Record<string, Mapping>, firma: string): Mapping | null {
  return mapeos[firma] ?? loadSavedMapping(firma);
}

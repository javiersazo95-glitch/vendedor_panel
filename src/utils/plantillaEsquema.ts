/**
 * Trae el esquema de la plantilla de inventario desde el backend
 * (GET /inventario/excel/esquema), que es el único lugar donde el contrato es verdad:
 * qué columnas tiene la plantilla, cuáles son obligatorias, qué versión declara y qué
 * valores acepta.
 *
 * Antes esa lista vivía copiada en tres lugares (backend, panel y los generadores de
 * Excel de prueba) y sólo coincidían porque alguien se acordaba de actualizarlas a mano.
 *
 * Si el endpoint no responde se sigue con el contrato de respaldo del propio panel: un
 * backend caído puede impedir publicar, pero no tiene por qué impedir preparar el archivo.
 */
import { useEffect, useRef, useState } from 'react';

import { apiFetch } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import { getStoredSession } from './session';
import { ESQUEMA_FALLBACK, type EsquemaPlantilla } from './plantillaMapping';

const listaDeTextos = (valor: unknown): string[] =>
  Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

/**
 * Normaliza la respuesta del backend a un `EsquemaPlantilla` completo. Devuelve null si
 * no trae columnas: sin ellas no hay esquema que usar y es mejor el respaldo que una
 * pantalla de mapeo vacía.
 */
export function normalizarEsquema(data: unknown): EsquemaPlantilla | null {
  if (!data || typeof data !== 'object') return null;
  const bruto = data as Record<string, unknown>;
  const columnas = listaDeTextos(bruto.columnas);
  if (columnas.length === 0) return null;

  const catalogos = (bruto.catalogos ?? {}) as Record<string, unknown>;
  const subcatBruto = (catalogos.subcategoriasPorCategoria ?? {}) as Record<string, unknown>;
  const subcategoriasPorCategoria: Record<string, string[]> = {};
  for (const [categoria, subcats] of Object.entries(subcatBruto)) {
    subcategoriasPorCategoria[categoria] = listaDeTextos(subcats);
  }

  const tiposPrecio = listaDeTextos(catalogos.tiposPrecio);
  const condiciones = listaDeTextos(catalogos.condiciones);

  return {
    version: typeof bruto.version === 'string' && bruto.version.trim() ? bruto.version.trim() : ESQUEMA_FALLBACK.version,
    columnas,
    columnasObligatorias: listaDeTextos(bruto.columnasObligatorias),
    hojaCompatibilidadesColumnas: listaDeTextos(bruto.hojaCompatibilidadesColumnas),
    catalogos: {
      categorias: listaDeTextos(catalogos.categorias),
      subcategoriasPorCategoria,
      marcasRepuesto: listaDeTextos(catalogos.marcasRepuesto),
      marcasVehiculo: listaDeTextos(catalogos.marcasVehiculo).length
        ? listaDeTextos(catalogos.marcasVehiculo)
        : ESQUEMA_FALLBACK.catalogos.marcasVehiculo,
      // Estos dos son parte del contrato del Excel, no de la base de datos: si el
      // backend no los manda, los del respaldo siguen siendo correctos.
      tiposPrecio: tiposPrecio.length ? tiposPrecio : ESQUEMA_FALLBACK.catalogos.tiposPrecio,
      condiciones: condiciones.length ? condiciones : ESQUEMA_FALLBACK.catalogos.condiciones,
    },
  };
}

export async function fetchEsquemaPlantilla(sellerId: number | string, token: string): Promise<EsquemaPlantilla | null> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/v1/proveedores/${sellerId}/inventario/excel/esquema`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return null;
  return normalizarEsquema(await response.json());
}

export interface EsquemaState {
  esquema: EsquemaPlantilla;
  /** true cuando se está trabajando con el contrato copiado en el panel. */
  usandoRespaldo: boolean;
}

/**
 * Pide el esquema una vez, cuando `activo` pasa a true (es decir, al abrir la carga
 * masiva). Nunca falla hacia afuera: mientras la respuesta no llega, y si el backend no
 * contesta, entrega el esquema de respaldo, que es exactamente lo que el panel usaba
 * antes de que este endpoint se consumiera.
 */
export function useEsquemaPlantilla(activo: boolean): EsquemaState {
  const [state, setState] = useState<EsquemaState>({
    esquema: ESQUEMA_FALLBACK,
    usandoRespaldo: true,
  });
  // El pedido en curso se lleva en un ref y no en el estado: pintar "cargando" costaría
  // un render extra por algo que el vendedor no ve, porque mientras tanto la pantalla ya
  // funciona con el contrato de respaldo.
  const pedidoRef = useRef(false);

  useEffect(() => {
    if (!activo || pedidoRef.current) return;
    const session = getStoredSession();
    if (!session?.sellerId || !session?.token) return;

    pedidoRef.current = true;
    let vigente = true;
    fetchEsquemaPlantilla(session.sellerId, session.token)
      .then((esquema) => {
        if (vigente && esquema) setState({ esquema, usandoRespaldo: false });
      })
      .catch(() => {
        // Se sigue con el respaldo. El vendedor no tiene nada que hacer con este error.
        pedidoRef.current = false;
      });

    return () => { vigente = false; };
  }, [activo]);

  return state;
}

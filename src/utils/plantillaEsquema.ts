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
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch } from './apiFetch';
import { conReintento429 } from './reintento429';
import { API_BASE_URL } from './imageHelper';
import { getStoredSession } from './session';
import { encId } from './url';
import { ESQUEMA_FALLBACK, type EsquemaPlantilla } from './plantillaMapping';
import { normalizarParaComparar } from './plantillaCatalogos';

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
  // Fase 4: modelos por marca, con la marca como clave normalizada, que es como los busca
  // el asistente ("TOYOTA", "toyota" y "Toyota" son la misma marca).
  const modelosBruto = (catalogos.modelosPorMarcaVehiculo ?? {}) as Record<string, unknown>;
  const modelosPorMarcaVehiculo: Record<string, string[]> = {};
  for (const [marca, modelos] of Object.entries(modelosBruto)) {
    const clave = normalizarParaComparar(marca);
    if (clave) modelosPorMarcaVehiculo[clave] = listaDeTextos(modelos);
  }

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
      modelosPorMarcaVehiculo,
      // Estos dos son parte del contrato del Excel, no de la base de datos: si el
      // backend no los manda, los del respaldo siguen siendo correctos.
      tiposPrecio: tiposPrecio.length ? tiposPrecio : ESQUEMA_FALLBACK.catalogos.tiposPrecio,
      condiciones: condiciones.length ? condiciones : ESQUEMA_FALLBACK.catalogos.condiciones,
    },
  };
}

export async function fetchEsquemaPlantilla(sellerId: number | string, token: string): Promise<EsquemaPlantilla | null> {
  // El esquema comparte el tope de peticiones por minuto con todo el panel: ante un 429 se espera.
  const response = await conReintento429(() => apiFetch(
    `${API_BASE_URL}/api/v1/proveedores/${encId(sellerId)}/inventario/excel/esquema`,
    { headers: { Authorization: `Bearer ${token}` } },
  ));
  if (!response.ok) return null;
  return normalizarEsquema(await response.json());
}

export interface EsquemaState {
  esquema: EsquemaPlantilla;
  /** true cuando se está trabajando con el contrato copiado en el panel. */
  usandoRespaldo: boolean;
  /**
   * El backend no entregó las listas (categorías, marcas…) después de reintentar solo. Con el
   * respaldo esas listas vienen vacías, así que la pantalla debe decirlo y ofrecer reintentar.
   */
  fallo: boolean;
  /** Vuelve a pedir el esquema. */
  reintentar: () => void;
}

/** Esperas entre reintentos automáticos si el esquema no llega (un corte, un 5xx). */
const ESPERAS_REINTENTO_MS = [2000, 6000];

/**
 * Pide el esquema una vez, cuando `activo` pasa a true (es decir, al abrir la carga
 * masiva). Nunca falla hacia afuera: mientras la respuesta no llega, y si el backend no
 * contesta, entrega el esquema de respaldo, que es exactamente lo que el panel usaba
 * antes de que este endpoint se consumiera.
 */
export function useEsquemaPlantilla(activo: boolean): EsquemaState {
  const [state, setState] = useState<{ esquema: EsquemaPlantilla; usandoRespaldo: boolean; fallo: boolean }>({
    esquema: ESQUEMA_FALLBACK,
    usandoRespaldo: true,
    fallo: false,
  });
  // El pedido en curso se lleva en un ref y no en el estado: pintar "cargando" costaría
  // un render extra por algo que el vendedor no ve, porque mientras tanto la pantalla ya
  // funciona con el contrato de respaldo.
  const pedidoRef = useRef(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!activo || pedidoRef.current) return;
    const session = getStoredSession();
    if (!session?.sellerId || !session?.token) return;

    pedidoRef.current = true;
    // La respuesta se aplica siempre, sin un flag de "sigo montado". Con ese flag y el
    // ref juntos, en StrictMode el esquema no llegaba nunca: React monta, desmonta y
    // vuelve a montar el efecto, el cleanup invalidaba el pedido en vuelo y el remonte
    // lo daba por hecho, asi que la respuesta llegaba y se descartaba. El panel quedaba
    // con el contrato de respaldo -- sin categorias ni marcas- aunque el backend hubiera
    // contestado. En React 18 un setState sobre un componente ya desmontado no hace nada
    // ni avisa, asi que no hay nada que proteger.
    //
    // Antes, si el pedido fallaba una vez (un 429, un corte), no se volvía a intentar en toda la
    // sesión y categoría, subcategoría y marca quedaban sin lista en la tabla. Ahora se reintenta
    // solo dos veces y, si igual no llega, se avisa en pantalla con un botón para reintentar.
    const pedir = async () => {
      for (let i = 0; i <= ESPERAS_REINTENTO_MS.length; i++) {
        try {
          const esquema = await fetchEsquemaPlantilla(session.sellerId, session.token);
          if (esquema) return esquema;
        } catch { /* se reintenta abajo */ }
        if (i < ESPERAS_REINTENTO_MS.length) await new Promise((r) => setTimeout(r, ESPERAS_REINTENTO_MS[i]));
      }
      return null;
    };
    void pedir().then((esquema) => {
      pedidoRef.current = false;
      if (esquema) setState({ esquema, usandoRespaldo: false, fallo: false });
      else setState((prev) => ({ ...prev, fallo: prev.usandoRespaldo }));
    });
  }, [activo, intento]);

  const reintentar = useCallback(() => {
    setState((prev) => ({ ...prev, fallo: false }));
    setIntento((n) => n + 1);
  }, []);

  return { ...state, reintentar };
}

/**
 * Modelos de vehículo por marca, para la tabla del paso 3.
 *
 * La plantilla trae la marca y el modelo del auto como texto libre, pero en la carga 1:1
 * el vendedor los elige de una lista: la marca del catálogo y, con ella, sus modelos. Un
 * modelo escrito a mano no hace aparecer el repuesto en la búsqueda por vehículo, así que
 * al corregir una fila conviene ofrecer lo mismo que el formulario de a uno.
 *
 * El catálogo de modelos cuelga del id de la marca (`marcas-vehiculo/{id}/modelos`), no de
 * su nombre, así que primero hay que saber los ids. Se piden una vez y se guardan; los
 * modelos se piden por marca a medida que hacen falta, porque son decenas de marcas y sólo
 * unas pocas aparecen en un archivo.
 */
import { apiFetch } from './apiFetch';
import { API_BASE_URL } from './imageHelper';
import { normalizarParaComparar } from './plantillaCatalogos';

interface OpcionCatalogo {
  id: number;
  nombre: string;
}

const esOpcion = (v: unknown): v is OpcionCatalogo =>
  !!v && typeof v === 'object'
  && typeof (v as OpcionCatalogo).id === 'number'
  && typeof (v as OpcionCatalogo).nombre === 'string';

async function pedirCatalogo(ruta: string): Promise<OpcionCatalogo[]> {
  try {
    const res = await apiFetch(`${API_BASE_URL}/api/v1/catalogos/inventario/${ruta}`);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? data.filter(esOpcion) : [];
  } catch {
    // Sin catálogo la celda queda como texto libre, que es lo que era antes. Un fallo de
    // red no puede dejar al vendedor sin poder corregir una fila.
    return [];
  }
}

/** Las marcas de vehículo con su id, que es lo que necesita el catálogo de modelos. */
export async function cargarMarcasDeVehiculo(): Promise<Map<string, number>> {
  const marcas = await pedirCatalogo('marcas-vehiculo');
  return new Map(marcas.map((m) => [normalizarParaComparar(m.nombre), m.id]));
}

/** Los modelos de una marca, por su id. */
export async function cargarModelos(idMarca: number): Promise<string[]> {
  const modelos = await pedirCatalogo(`marcas-vehiculo/${idMarca}/modelos`);
  return modelos.map((m) => m.nombre);
}

/** Los años que se pueden elegir, del más nuevo al más viejo, igual que en la carga 1:1. */
export function aniosDisponibles(): string[] {
  const hasta = new Date().getFullYear() + 2;
  return Array.from({ length: hasta - 1990 + 1 }, (_, i) => String(hasta - i));
}

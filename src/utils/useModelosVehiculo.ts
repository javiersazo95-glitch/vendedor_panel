/**
 * Modelos de vehículo por marca para el asistente "Mi propio Excel": los que trae el esquema del
 * backend y, si no vinieron, los que se piden aparte para las marcas que aparecen en el archivo.
 */
import { useEffect, useMemo, useState } from 'react';
import type { EsquemaPlantilla } from './plantillaMapping';
import { cargarMarcasDeVehiculo, cargarModelos } from './plantillaVehiculos';

export function useModelosVehiculo(esquema: EsquemaPlantilla, marcasDelArchivo: string[], activo: boolean) {
  const [idsDeMarca, setIdsDeMarca] = useState<Map<string, number>>(new Map());
  const [modelosPorMarca, setModelosPorMarca] = useState<Record<string, string[]>>({});
  const [catalogoCaido, setCatalogoCaido] = useState(false);
  const esquemaTraeModelos = Object.keys(esquema.catalogos.modelosPorMarcaVehiculo ?? {}).length > 0;

  useEffect(() => {
    if (!activo || esquemaTraeModelos || idsDeMarca.size > 0 || catalogoCaido) return undefined;
    let vivo = true;
    cargarMarcasDeVehiculo().then((ids) => {
      if (!vivo) return;
      if (ids.size === 0) setCatalogoCaido(true);
      else setIdsDeMarca(ids);
    });
    return () => { vivo = false; };
  }, [activo, esquemaTraeModelos, idsDeMarca, catalogoCaido]);

  useEffect(() => {
    if (idsDeMarca.size === 0) return undefined;
    const pendientes = marcasDelArchivo
      .filter((clave) => modelosPorMarca[clave] === undefined && idsDeMarca.has(clave))
      .slice(0, 40);
    if (pendientes.length === 0) return undefined;
    let vivo = true;
    Promise.all(pendientes.map(async (clave) => [clave, await cargarModelos(idsDeMarca.get(clave) as number)] as const))
      .then((cargados) => {
        if (vivo) setModelosPorMarca((prev) => ({ ...prev, ...Object.fromEntries(cargados) }));
      });
    return () => { vivo = false; };
  }, [marcasDelArchivo, idsDeMarca, modelosPorMarca]);

  const modelosDisponibles = useMemo(() => ({
    ...(esquema.catalogos.modelosPorMarcaVehiculo ?? {}), ...modelosPorMarca,
  }), [esquema, modelosPorMarca]);

  return { modelosDisponibles, catalogoCaido };
}

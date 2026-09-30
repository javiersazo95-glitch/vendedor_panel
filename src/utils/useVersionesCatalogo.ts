/**
 * Las versiones del catálogo de los modelos que aparecen en la carga, pedidas una vez por modelo
 * y de a pocas a la vez (un archivo puede traer decenas de modelos distintos).
 */
import { useCallback, useRef, useState } from 'react';
import { cargarVersiones, claveModelo, type VersionCatalogo } from './catalogoVersiones';

const EN_PARALELO = 4;

export function useVersionesCatalogo() {
  const [versiones, setVersiones] = useState<Record<string, VersionCatalogo[] | null>>({});
  const pedidos = useRef(new Set<string>());
  const cola = useRef<{ marca: string; modelo: string }[]>([]);
  const activos = useRef(0);

  const avanzar = useCallback(function correr() {
    while (activos.current < EN_PARALELO && cola.current.length > 0) {
      const { marca, modelo } = cola.current.shift()!;
      activos.current += 1;
      cargarVersiones(marca, modelo)
        .then((lista) => setVersiones((prev) => ({ ...prev, [claveModelo(marca, modelo)]: lista })))
        .finally(() => {
          activos.current -= 1;
          correr();
        });
    }
  }, []);

  /** Pide las versiones de un modelo si todavía no se pidieron. */
  const pedirVersiones = useCallback((marca: string, modelo: string) => {
    if (!marca.trim() || !modelo.trim()) return;
    const clave = claveModelo(marca, modelo);
    if (pedidos.current.has(clave)) return;
    pedidos.current.add(clave);
    cola.current.push({ marca, modelo });
    avanzar();
  }, [avanzar]);

  const versionesDe = useCallback(
    (marca: string, modelo: string) => versiones[claveModelo(marca, modelo)],
    [versiones],
  );

  return { versionesDe, pedirVersiones };
}

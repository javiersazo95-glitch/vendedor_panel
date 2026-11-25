import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, ScanBarcode, Search, ShieldCheck } from 'lucide-react';
import { getStoredSession } from '../utils/session';
import {
  buscarCodigo, CODIGO_MAX, gruposPorRevisar, gruposSeguros, textoGrupo,
  type BusquedaCodigo, type FichaCodigo, type GrupoVehiculo,
} from '../utils/fichaCodigoApi';
import './autocompletarCodigo.css';

interface Props {
  codigo: string;
  onCodigo: (codigo: string) => void;
  condicion?: string;
  /** Si el formulario ya tiene datos que se van a reemplazar. */
  hayDatos: boolean;
  onAplicar: (ficha: FichaCodigo) => void;
  /** Agrega un vehículo que el catálogo no pudo confirmar. */
  onAgregarVehiculo: (grupo: GrupoVehiculo) => void;
}

/**
 * "Código de la caja": se busca una vez y el formulario queda lleno para revisar. Con más de una marca pregunta cuál, y
 * los vehículos que no se pudieron confirmar no entran solos.
 */
export function AutocompletarCodigo({ codigo, onCodigo, condicion, hayDatos, onAplicar, onAgregarVehiculo }: Props) {
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<BusquedaCodigo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [porConfirmar, setPorConfirmar] = useState<FichaCodigo | null>(null);
  const [aplicada, setAplicada] = useState<FichaCodigo | null>(null);
  const [agregados, setAgregados] = useState<Set<string>>(() => new Set());

  const aplicar = (ficha: FichaCodigo) => {
    setPorConfirmar(null);
    setResultado(null);
    setAplicada(ficha);
    setAgregados(new Set());
    onAplicar(ficha);
  };

  const buscar = async (marca?: string) => {
    const sesion = getStoredSession();
    if (buscando) return;
    if (!sesion?.sellerId || !sesion?.token) { setError('Tu sesión expiró. Vuelve a iniciar sesión.'); return; }
    if (codigo.trim().replace(/[^A-Za-z0-9]/g, '').length < 3) { setError('Escribe el código tal como aparece en la caja.'); return; }
    setBuscando(true);
    setError(null);
    setResultado(null);
    setAplicada(null);
    setPorConfirmar(null);
    try {
      const r = await buscarCodigo(sesion, codigo.trim(), marca, condicion);
      if (r.estado === 'RECONOCIDO' && r.ficha) {
        if (hayDatos) setPorConfirmar(r.ficha);
        else aplicar(r.ficha);
      } else {
        setResultado(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos buscar el código.');
    } finally {
      setBuscando(false);
    }
  };

  const seguros = aplicada ? gruposSeguros(aplicada) : [];
  const revisar = aplicada ? gruposPorRevisar(aplicada).filter((g) => !agregados.has(textoGrupo(g))) : [];
  const fuera = aplicada?.compatibilidad.fueraDeCatalogo ?? [];

  return (
    <section className="ac-bloque" aria-label="Autocompletar con el código del fabricante">
      <div className="ac-titulo">
        <ScanBarcode size={24} aria-hidden="true" />
        <div>
          <strong>¿Tienes la caja a mano?</strong>
          <span>Escribe o escanea el código del fabricante y completamos el repuesto. Tú pones precio y stock.</span>
        </div>
      </div>
      <div className="ac-busqueda">
        <input
          type="text"
          className="form-control focus-primary"
          placeholder="Código de la caja. Ej. GDB3424"
          aria-label="Código del fabricante"
          maxLength={CODIGO_MAX}
          value={codigo}
          onChange={(e) => { onCodigo(e.target.value); setError(null); }}
          // Una pistola de código de barras termina con Enter: busca, no publica.
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void buscar(); } }}
        />
        <button type="button" className="btn btn-primary btn-primary-blue" onClick={() => void buscar()} disabled={buscando || !codigo.trim()}>
          {buscando ? <Loader2 size={18} className="ac-girando" /> : <Search size={18} />} {buscando ? 'Buscando…' : 'Autocompletar'}
        </button>
      </div>
      {error && <p className="ac-aviso error" role="alert"><AlertTriangle size={17} /> {error}</p>}

      {resultado?.estado === 'ELEGIR_MARCA' && (
        <div className="ac-opciones" role="group" aria-label="Elige la marca que aparece en la caja">
          <p>{resultado.mensaje ?? 'Elige la marca que aparece en la caja.'}</p>
          <div>
            {resultado.opciones.map((o) => (
              <button type="button" key={o.marca} onClick={() => void buscar(o.marca)} disabled={buscando}>
                <strong>{o.marca}</strong><span>{o.nombre}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {resultado && resultado.estado !== 'ELEGIR_MARCA' && (
        <p className="ac-aviso" role="status"><AlertTriangle size={17} /> {resultado.mensaje}</p>
      )}

      {porConfirmar && (
        <div className="ac-confirmar" role="alertdialog" aria-label="Reemplazar los datos">
          <p>Encontramos <strong>{porConfirmar.nombre}</strong> de {porConfirmar.marca}. Reemplazará el nombre, la categoría, la marca y los vehículos que ya escribiste.</p>
          <div>
            <button type="button" className="btn btn-primary btn-primary-blue" onClick={() => aplicar(porConfirmar)}>Sí, reemplazar</button>
            <button type="button" className="btn btn-secondary" onClick={() => setPorConfirmar(null)}>No, dejar lo mío</button>
          </div>
        </div>
      )}

      {aplicada && (
        <div className="ac-resultado" role="status">
          <p className="ac-listo">
            {aplicada.verificada ? <ShieldCheck size={20} /> : <CheckCircle2 size={20} />}
            <span>
              <strong>{aplicada.nombre}</strong> · {aplicada.marca}. {seguros.length > 0
                ? `Pusimos ${seguros.length} ${seguros.length === 1 ? 'vehículo' : 'vehículos'}.`
                : 'No pudimos confirmar vehículos: agrégalos tú.'}
              {' '}{aplicada.verificada ? 'Ficha revisada por RepuesTop.' : aplicada.confianza === 'MEDIA' ? 'Llegamos por un número equivalente: revisa con cuidado.' : 'Revísalo antes de publicar.'}
            </span>
          </p>
          {!aplicada.categoria && <p className="ac-aviso"><AlertTriangle size={17} /> Elige la categoría: no pudimos saber cuál es.</p>}
          {revisar.length > 0 && (
            <div className="ac-revisar">
              <p>Estos no los pudimos confirmar. Agrega sólo los que sabes que le sirven:</p>
              <ul>
                {revisar.slice(0, 12).map((g) => (
                  <li key={textoGrupo(g)}>
                    <span>{textoGrupo(g)}</span>
                    <button type="button" onClick={() => { onAgregarVehiculo(g); setAgregados((a) => new Set(a).add(textoGrupo(g))); }}>
                      <Plus size={16} /> Agregar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fuera.length > 0 && (
            <details className="ac-fuera">
              <summary>{fuera.length} {fuera.length === 1 ? 'vehículo del fabricante no está' : 'vehículos del fabricante no están'} en el catálogo chileno</summary>
              <p>{fuera.slice(0, 40).join(' · ')}{fuera.length > 40 ? ' …' : ''}</p>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

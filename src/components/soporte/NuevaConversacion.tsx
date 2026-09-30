import { useId, useState, type FormEvent } from 'react';
import { Loader2, Send } from 'lucide-react';
import { describirContextoSoporte, useContextoSoporte, type ContextoSoporte } from '../../utils/contextoSoporte';
import { DETALLE_MAX, type MotivoChat } from '../../utils/soporteCargaApi';
import type { ResultadoCrear } from '../../utils/useChatSoporte';
import { MOTIVOS, mensajeDeError } from './textosSoporte';

export interface NuevaConversacionProps {
  onCrear: (motivo: MotivoChat, detalle: string, contexto: ContextoSoporte | null) => Promise<ResultadoCrear>;
}

/** Formulario para abrir una conversacion con soporte. */
export function NuevaConversacion({ onCrear }: NuevaConversacionProps) {
  const contexto = useContextoSoporte();
  const descripcionContexto = describirContextoSoporte(contexto);
  const [motivo, setMotivo] = useState<MotivoChat | null>(null);
  const [detalle, setDetalle] = useState('');
  const [adjuntarContexto, setAdjuntarContexto] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idDetalle = useId();
  const idContador = useId();

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    if (!motivo) {
      setError('Elige el motivo de tu consulta.');
      return;
    }
    const texto = detalle.trim();
    if (!texto) {
      setError('Cuéntanos qué necesitas para que podamos ayudarte.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await onCrear(motivo, texto, adjuntarContexto && contexto ? contexto : null);
    } catch (err) {
      setError(mensajeDeError(err, 'No pudimos enviar tu consulta. Revisa tu conexión e intenta de nuevo.'));
      setEnviando(false);
    }
  };

  return (
    <form className="soporte-nueva" onSubmit={enviar} noValidate>
      <p className="soporte-intro">
        ¡Hola! Escríbenos y una persona de nuestro equipo te responderá por aquí. Puedes cerrar esta ventana y seguir
        trabajando: te avisaremos con un número en el botón de ayuda cuando te respondamos.
      </p>

      <fieldset className="soporte-motivos">
        <legend>¿En qué te podemos ayudar?</legend>
        <div className="soporte-chips">
          {MOTIVOS.map((m) => (
            <label key={m.valor} className={`soporte-chip${motivo === m.valor ? ' soporte-chip-activo' : ''}`}>
              <input
                type="radio"
                name="soporte-motivo"
                value={m.valor}
                checked={motivo === m.valor}
                onChange={() => setMotivo(m.valor)}
              />
              {m.texto}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="soporte-etiqueta" htmlFor={idDetalle}>
        Cuéntanos qué necesitas
      </label>
      <textarea
        id={idDetalle}
        className="soporte-textarea soporte-textarea-grande"
        value={detalle}
        onChange={(e) => setDetalle(e.target.value)}
        maxLength={DETALLE_MAX}
        rows={5}
        placeholder="Por ejemplo: no sé qué columna elegir para el precio."
        aria-describedby={idContador}
      />
      <span id={idContador} className="soporte-contador">
        {detalle.length}/{DETALLE_MAX}
      </span>

      {descripcionContexto && (
        <label className="soporte-contexto">
          <input type="checkbox" checked={adjuntarContexto} onChange={(e) => setAdjuntarContexto(e.target.checked)} />
          <span>
            <strong>Adjuntar en qué paso voy</strong>
            <span className="soporte-contexto-detalle">{descripcionContexto}</span>
          </span>
        </label>
      )}

      {error && (
        <p className="soporte-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary soporte-boton-enviar" disabled={enviando}>
        {enviando ? <Loader2 size={18} className="soporte-girando" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
        {enviando ? 'Enviando…' : 'Enviar a soporte'}
      </button>
    </form>
  );
}

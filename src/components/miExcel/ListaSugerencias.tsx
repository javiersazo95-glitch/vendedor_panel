/**
 * Opciones sugeridas para un campo de texto libre (la garantía): el navegador las ofrece como
 * desplegable al enfocar o escribir, y el vendedor igual puede escribir otra a mano.
 */
export function ListaSugerencias({ id, opciones }: { id: string; opciones: readonly string[] }) {
  if (opciones.length === 0) return null;
  return (
    <datalist id={id}>
      {opciones.map((o) => <option key={o} value={o} />)}
    </datalist>
  );
}

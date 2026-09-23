import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guardián de la premisa sobre la que se aceptó SEC-MARKET-B01.
 *
 * El token de sesión vive en `sessionStorage`, o sea al alcance de cualquier script que llegue a
 * ejecutarse en este origen. El propietario del producto aceptó ese riesgo (SEC-BACKEND-141), y lo
 * aceptó apoyado en dos hechos concretos que verificó la auditoría del 2026-09-21: que el panel no
 * tiene ni un solo punto donde se inyecte HTML sin escapar, y que la CSP no permite script inline.
 *
 * El problema de aceptar un riesgo sobre una premisa es que la premisa es una foto. Basta un
 * `dangerouslySetInnerHTML` agregado con buena intención dentro de seis meses para que la decisión
 * deje de tener la base con la que se tomó, y nadie se entere.
 *
 * Por eso esto es una prueba y no una anotación: si alguien introduce un sumidero, esto falla en CI
 * y obliga a mirar la decisión de nuevo, en vez de dejarla caducar en silencio.
 *
 * **Si estás acá porque esta prueba te falló:** no la silencies. Lo que cambió no es el test, es la
 * base de una decisión de seguridad. Avisá al equipo del backend, que pidió expresamente que se les
 * señalara si el panel pasaba a renderizar HTML generado por usuarios.
 */

/** Cada patrón entrega HTML crudo al DOM o ejecuta texto como código. */
const SUMIDEROS: { patron: RegExp; nombre: string; porQue: string }[] = [
  { patron: /dangerouslySetInnerHTML/, nombre: 'dangerouslySetInnerHTML',
    porQue: 'entrega HTML sin escapar a React, que es la vía de XSS más directa en esta app' },
  { patron: /\.innerHTML\s*=/, nombre: 'innerHTML =',
    porQue: 'escribe HTML crudo en el DOM, saltándose el escape de React' },
  { patron: /\.outerHTML\s*=/, nombre: 'outerHTML =',
    porQue: 'igual que innerHTML, reemplazando además el propio nodo' },
  { patron: /\binsertAdjacentHTML\s*\(/, nombre: 'insertAdjacentHTML()',
    porQue: 'inserta HTML crudo sin pasar por React' },
  { patron: /\bdocument\.write\s*\(/, nombre: 'document.write()',
    porQue: 'escribe directo en el documento, sin escape alguno' },
  { patron: /(^|[^.\w])eval\s*\(/, nombre: 'eval()',
    porQue: 'ejecuta texto como código: cualquier dato que llegue ahí es un script' },
  { patron: /\bnew\s+Function\s*\(/, nombre: 'new Function()',
    porQue: 'equivale a eval() para construir código en tiempo de ejecución' },
];

function archivosFuente(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      archivosFuente(ruta, acumulado);
    } else if (/\.(ts|tsx)$/.test(entrada.name) && !entrada.name.endsWith('sumiderosHtml.test.ts')) {
      acumulado.push(ruta);
    }
  }
  return acumulado;
}

describe('el panel no inyecta HTML sin escapar (premisa de SEC-MARKET-B01)', () => {
  it('no hay ningún sumidero de HTML crudo ni ejecución de texto como código en src/', () => {
    const hallazgos: string[] = [];

    for (const archivo of archivosFuente('src')) {
      const lineas = readFileSync(archivo, 'utf-8').split('\n');
      lineas.forEach((linea, i) => {
        // Un comentario que nombre el patrón no es un sumidero: lo que importa es el código.
        const codigo = linea.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        for (const { patron, nombre, porQue } of SUMIDEROS) {
          if (patron.test(codigo)) {
            hallazgos.push(`${relative('.', archivo)}:${i + 1} usa ${nombre} — ${porQue}`);
          }
        }
      });
    }

    expect(hallazgos, hallazgos.length
      ? `\n\nSe introdujo un sumidero de HTML en el panel:\n\n  ${hallazgos.join('\n  ')}\n\n`
        + 'El token de sesión vive en sessionStorage y el riesgo de XSS se aceptó (SEC-BACKEND-141)\n'
        + 'porque no existía ninguno de estos puntos. Esa base acaba de cambiar: avisá al equipo del\n'
        + 'backend antes de silenciar esta prueba.\n'
      : undefined).toEqual([]);
  });
});

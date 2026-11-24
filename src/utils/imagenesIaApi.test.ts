import { describe, expect, it } from 'vitest';
import { contarParaImagenIa, plazoEstimado, type CupoImagenesIa } from './imagenesIaApi';

const cupo = (extra: Partial<CupoImagenesIa> = {}): CupoImagenesIa => ({
  activo: true, cupoDiario: 1000, restantes: 1000, enCola: 0, capacidadHoy: 388, capacidadDiaria: 91, ...extra,
});

describe('imágenes referenciales con IA', () => {
  it('cuenta solo nuevos sin foto; los usados y reacondicionados van aparte, también con alias del Excel', () => {
    expect(contarParaImagenIa([
      { tieneFoto: false, condicion: 'ORIGINAL' },
      { tieneFoto: false, condicion: 'Nuevo alternativo' },
      { tieneFoto: false, condicion: '' },
      { tieneFoto: true, condicion: 'ORIGINAL' },
      { tieneFoto: false, condicion: 'Segunda mano' },
      { tieneFoto: false, condicion: 'REACONDICIONADO' },
      { tieneFoto: true, condicion: 'USADO' },
    ])).toEqual({ candidatos: 3, usados: 2 });
  });

  it('estima el plazo con lo que ya espera y lo que cabe por día', () => {
    expect(plazoEstimado(300, cupo())).toBe('hoy mismo');
    expect(plazoEstimado(300, cupo({ enCola: 100 }))).toBe('en cerca de 1 día');
    expect(plazoEstimado(1000, cupo())).toBe('en cerca de 7 días');
    expect(plazoEstimado(10, cupo({ capacidadHoy: 0, capacidadDiaria: 0 }))).toBe('cuando se renueve el cupo mensual');
  });
});

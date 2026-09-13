import { describe, expect, it } from 'vitest';
import { sanitizeAoaForExport, sanitizeCellValue, sanitizeRowsForExport } from './xlsxSafety';

describe('sanitizeCellValue', () => {
  it('antepone comilla simple a valores que empiezan con =, +, -, @, tab o CR', () => {
    expect(sanitizeCellValue('=HYPERLINK("http://evil","x")')).toBe("'=HYPERLINK(\"http://evil\",\"x\")");
    expect(sanitizeCellValue('+1234')).toBe("'+1234");
    expect(sanitizeCellValue('-1234')).toBe("'-1234");
    expect(sanitizeCellValue('@SUM(1,2)')).toBe("'@SUM(1,2)");
    expect(sanitizeCellValue('\tmalicioso')).toBe("'\tmalicioso");
    expect(sanitizeCellValue('\rmalicioso')).toBe("'\rmalicioso");
  });

  it('deja intactos los valores normales', () => {
    expect(sanitizeCellValue('SKU-1234')).toBe('SKU-1234');
    expect(sanitizeCellValue('Filtro de aceite')).toBe('Filtro de aceite');
    expect(sanitizeCellValue('')).toBe('');
  });

  it('deja pasar valores no-string sin modificarlos (numeros, null, undefined)', () => {
    expect(sanitizeCellValue(42)).toBe(42);
    expect(sanitizeCellValue(null)).toBe(null);
    expect(sanitizeCellValue(undefined)).toBe(undefined);
  });
});

describe('sanitizeRowsForExport', () => {
  it('sanea cada valor de cada fila de un arreglo de objetos', () => {
    const rows = [
      { SKU: '=cmd|calc', Nombre: 'Bujía' },
      { SKU: 'SKU-1', Nombre: 'Filtro' },
    ];
    expect(sanitizeRowsForExport(rows)).toEqual([
      { SKU: "'=cmd|calc", Nombre: 'Bujía' },
      { SKU: 'SKU-1', Nombre: 'Filtro' },
    ]);
  });
});

describe('sanitizeAoaForExport', () => {
  it('sanea cada celda de un arreglo de arreglos', () => {
    const rows = [
      ['SKU', 'Nombre'],
      ['=HYPERLINK("http://evil")', 'Filtro'],
    ];
    expect(sanitizeAoaForExport(rows)).toEqual([
      ['SKU', 'Nombre'],
      ["'=HYPERLINK(\"http://evil\")", 'Filtro'],
    ]);
  });
});

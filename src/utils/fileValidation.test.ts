import { describe, expect, it } from 'vitest';
import {
  MAX_DATA_FILE_SIZE_BYTES,
  excedeTamanoMaximoDatos,
  pareceExcelValido,
} from './fileValidation';

describe('excedeTamanoMaximoDatos', () => {
  it('deja pasar un archivo dentro del limite', () => {
    const file = new File([new Uint8Array(1024)], 'datos.xlsx');
    expect(excedeTamanoMaximoDatos(file)).toBe(false);
  });

  it('rechaza un archivo que supera el limite', () => {
    const file = new File([new Uint8Array(MAX_DATA_FILE_SIZE_BYTES + 1)], 'datos.xlsx');
    expect(excedeTamanoMaximoDatos(file)).toBe(true);
  });
});

describe('pareceExcelValido', () => {
  it('acepta un .xlsx con firma ZIP real', async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], 'datos.xlsx');
    expect(await pareceExcelValido(file)).toBe(true);
  });

  it('acepta un .xls con firma OLE2 real', async () => {
    const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0x00])], 'datos.xls');
    expect(await pareceExcelValido(file)).toBe(true);
  });

  it('rechaza un .xlsx cuyo contenido no es un Excel real', async () => {
    const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], 'datos.xlsx');
    expect(await pareceExcelValido(file)).toBe(false);
  });

  it('no aplica la firma a un .csv: cualquier contenido pasa este control', async () => {
    const file = new File(['a,b,c'], 'datos.csv');
    expect(await pareceExcelValido(file)).toBe(true);
  });
});

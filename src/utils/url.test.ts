import { describe, expect, it } from 'vitest';
import { encId } from './url';

describe('encId', () => {
  it('deja igual un id numerico o alfanumerico normal', () => {
    expect(encId(123)).toBe('123');
    expect(encId('abc-123')).toBe('abc-123');
  });

  it('escapa caracteres que alterarian la ruta o el query de la URL', () => {
    expect(encId('a/b')).toBe('a%2Fb');
    expect(encId('a?b=c')).toBe('a%3Fb%3Dc');
    expect(encId('a#b')).toBe('a%23b');
  });
});

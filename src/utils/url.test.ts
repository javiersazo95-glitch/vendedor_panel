import { describe, expect, it } from 'vitest';
import { encId, esDestinoDePagoPermitido } from './url';

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

describe('esDestinoDePagoPermitido (SEC-MARKET-C07)', () => {
  const BACKEND = 'https://api.repuestop.cl';

  it('acepta la pasarela real, en sandbox y en producción', () => {
    expect(esDestinoDePagoPermitido('https://sandbox.flow.cl/app/web/pay.php?token=abc', BACKEND)).toBe(true);
    expect(esDestinoDePagoPermitido('https://www.flow.cl/app/web/pay.php?token=abc', BACKEND)).toBe(true);
    expect(esDestinoDePagoPermitido('https://flow.cl/pagar', BACKEND)).toBe(true);
  });

  it('rechaza un dominio que sólo se parece al de la pasarela', () => {
    // El caso que hace insuficiente un "contiene": ambos llevan la cadena flow.cl.
    expect(esDestinoDePagoPermitido('https://evilflow.cl/pagar', BACKEND)).toBe(false);
    expect(esDestinoDePagoPermitido('https://flow.cl.attacker.com/pagar', BACKEND)).toBe(false);
  });

  it('rechaza lo que no sea https, y lo que no sea una URL', () => {
    expect(esDestinoDePagoPermitido('http://www.flow.cl/pagar', BACKEND)).toBe(false);
    expect(esDestinoDePagoPermitido('javascript:alert(1)', BACKEND)).toBe(false);
    expect(esDestinoDePagoPermitido('', BACKEND)).toBe(false);
    expect(esDestinoDePagoPermitido('no-es-una-url', BACKEND)).toBe(false);
  });

  /**
   * En local la pasarela corre simulada y devuelve al backend, no a flow.cl. Sin esto la
   * recarga no se puede probar en local: el panel cortaría su propio flujo de pago.
   */
  it('acepta el propio backend, que es a donde vuelve la pasarela en modo simulado', () => {
    expect(esDestinoDePagoPermitido(
      'http://localhost:8080/api/v1/pagos/flow/retorno?token=mock_flow_token_1&status=2',
      'http://localhost:8080',
    )).toBe(true);
  });

  it('no acepta otro backend que no sea el configurado', () => {
    expect(esDestinoDePagoPermitido('http://localhost:9999/api/v1/pagos/flow/retorno', 'http://localhost:8080')).toBe(false);
    expect(esDestinoDePagoPermitido('https://api.atacante.cl/pagos', BACKEND)).toBe(false);
  });
});

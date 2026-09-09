# Archivos crudos de prueba

Listas de vendedor como llegan de verdad, no como nos gustaría que llegaran. Los `.xlsx`
que había en la raíz del repo salen casi todos de la plantilla oficial o de un Excel ya
ordenado, así que probaban el camino feliz.

- `casos.mjs` — los datos de cada caso, como saldrían de la hoja.
- `generar.mjs` — los escribe como `.xlsx` para subirlos a mano por el panel:
  `node pruebas-crudas/generar.mjs`
- `src/utils/plantillaCrudos.test.ts` — pasa los mismos datos por el pipeline sin tocar
  disco y fija el comportamiento actual.

Los tests marcados `GAP` describen lo que todavía sale mal. No son deseos: si alguno
empieza a fallar es porque arreglamos (o rompimos) algo, y hay que actualizarlo a propósito.

## Estado al 2026-09-09

| Caso | Qué pasa hoy |
| --- | --- |
| 01 lista de dos columnas | ✅ **Arreglado.** La columna descriptiva va al nombre (obligatorio) y no a la descripción (opcional), y con el interruptor "sacar del nombre" salen la marca y la categoría escritas dentro del texto |
| 02 encabezados abreviados | ✅ **Arreglado.** Las seis columnas se reconocen: se sumaron las abreviaturas de mostrador y la primera pasada prueba término por término |
| 03 precios sucios | ✅ **Arreglado.** 3 de 5 publicables. Se recorta la unidad (`45.000 c/u`, `3 unid`), `CONSULTAR` pasa a `SOLO_COTIZAR` y `6,990` ya no se lee como 6,99. Lo que queda (`SIN STOCK`, stock vacío) no se puede inventar |
| 04 títulos bajo el membrete | ✅ 2 de 2 publicables, ya funcionaba |
| 05 subtotales intercalados | ✅ **Arreglado.** 3 de 3 publicables. El subtotal, el total general y el encabezado repetido se reconocen y quedan fuera |
| 06 dos tablas apiladas | ⚠️ **Avisado, no arreglado.** Sigue leyéndose sólo la primera tabla, pero el paso 2 dice que la hoja tiene más de una y sugiere separarlas |
| 07 categoría como banda | ✅ **Arreglado.** 3 de 3 publicables. Cada fila de título es la categoría de los repuestos que vienen debajo, escrita con el nombre del catálogo |
| 08 sin precio ni stock | ✅ **Arreglado.** El paso 2 exige el precio además de los obligatorios del esquema, y ofrece `SOLO_COTIZAR` como salida en vez de obligar a inventar un precio |
| 09 varios autos por celda | ✅ **Arreglado.** Con el interruptor "varios autos en la misma celda" se publica un repuesto con una compatibilidad por auto; sin activarlo, la revisión avisa en vez de pasar en verde |
| 10 todo junto | ⚠️ 0 publicables, pero ya sólo porque la categoría no está en ninguna parte y por un "sin stock" que no es número |

**8 arreglados, 1 que ya andaba, 1 avisado.**

## Qué se arregló

- **Los dos que pasaban en verde estando mal.** El 09 publicaba `TOYOTA COROLLA 2014-2018 /
  TOYOTA YARIS…` como un solo modelo inventado, sin error ni aviso; y `6,990` se publicaba
  como 6,99 pesos, porque la regla de "tres dígitos = separador de miles" valía para el
  punto pero no para la coma. Los dos eran peores que un archivo que no publica: el
  vendedor no tenía cómo enterarse.
- **Reconocimiento de columnas.** Abreviaturas de mostrador (`Cod. Art.`, `Mca.`, `P.U.`,
  `Exist.`) y una primera pasada que recorre los términos del campo en orden en vez de las
  columnas de la hoja, para que `Nombre` le gane a `Detalle` sin depender de cuál va antes.
- **Valores escritos a mano.** La unidad al lado del número se recorta sólo si lo que queda
  es un número; `CONSULTAR` en la columna de precio se traduce a `SOLO_COTIZAR`, que es lo
  que el vendedor quiso decir.
- **Datos que existen pero no tienen columna.** La marca y la categoría se buscan dentro del
  nombre del repuesto contra el catálogo real. Los empates se rompen con información, no
  adivinando: una marca de vehículo dentro del nombre es el auto y no quien fabricó la
  pieza, gana el nombre más específico ("Soportes de Motor" antes que "Motor"), y entre dos
  igual de específicos gana el que aparece primero, porque en español el sustantivo
  principal va adelante y lo que sigue lo califica ("filtro de aceite" es un filtro, no un
  aceite). Lo que no está en el catálogo se deja vacío para que lo complete el vendedor.
- **Filas que no son repuestos.** Los subtotales, el total general y el encabezado repetido
  cada vez que empieza una página se reconocen y quedan fuera. El código es lo que los
  delata: la etiqueta del subtotal se escribe donde va el nombre, así que el nombre no
  sirve para distinguirlos, pero un subtotal nunca trae código.
- **Datos escritos como estructura.** Una fila de título que agrupa ("FRENOS" y debajo los
  repuestos de frenos) pasa a ser la categoría de las filas que vienen abajo. Lo que quede
  arriba de la primera banda se queda sin categoría: no hay título que le corresponda y
  prestarle el siguiente sería inventar.
- **Avisar antes, no después.** El paso 2 ya no deja avanzar sin precio, que era la causa de
  recorrer el asistente entero para llegar a cero publicables, y avisa cuando la hoja trae
  más de una tabla.

## Lo que queda

**Dos tablas apiladas en una hoja (06) no se arregla, se avisa.** La segunda tabla trae
otras columnas, en otro orden y a veces una de más: no hay forma de leerla con los títulos
de arriba sin inventar a qué campo va cada dato. Se detecta y el paso 2 lo dice, con la
salida concreta —dejar cada tabla en su propia hoja y subirlas de a una—, que es mejor que
adivinar y publicar mal la mitad del archivo.

De ahí en adelante conviene esperar archivos de vendedores reales antes de seguir
afinando: todo lo que sigue serían casos imaginados por nosotros.

## Pendiente fuera de este repo

`normalizarNumero` dice replicar `InventarioExcelService.normalizarNumero` del backend. El
cambio de la coma de miles rompe ese espejo: **vale la pena replicarlo en el backend**, o un
vendedor que suba su Excel crudo por otra vía va a recibir 6,99 donde el panel entiende
6.990.

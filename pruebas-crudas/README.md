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

Los doce se probaron además por la interfaz, subiendo el `.xlsx` al panel contra los
catálogos reales del backend (25 categorías). Los números de fila de la tabla son los del
Excel del vendedor.

| Caso | Qué pasa hoy | Filas |
| --- | --- | --- |
| 01 lista de dos columnas | ✅ **Arreglado.** La columna descriptiva va al nombre (obligatorio) y no a la descripción (opcional), y con el interruptor "sacar del nombre" salen la marca y la categoría escritas dentro del texto | 2, 3, 4 |
| 02 encabezados abreviados | ✅ **Arreglado.** Las seis columnas se reconocen: se sumaron las abreviaturas de mostrador y la primera pasada prueba término por término | 2, 3 |
| 03 precios sucios | ✅ **Arreglado.** 3 de 5 publicables. Se recorta la unidad (`45.000 c/u`, `3 unid`), `CONSULTAR` pasa a `SOLO_COTIZAR` y `6,990` ya no se lee como 6,99. Lo que queda (`SIN STOCK`, stock vacío, un precio con decimales) no se puede inventar | 2–6 |
| 04 títulos bajo el membrete | ✅ 2 de 2 publicables, ya funcionaba | 6, 7 |
| 05 subtotales intercalados | ✅ **Arreglado.** 3 de 3 publicables. El subtotal, el total general y el encabezado repetido se reconocen y quedan fuera | 2, 3, 7 |
| 06 dos tablas apiladas | ⚠️ **Avisado, no arreglado.** Sigue leyéndose sólo la primera tabla, pero el paso 2 dice que la hoja tiene más de una y no deja avanzar | — |
| 07 categoría como banda | ✅ **Arreglado.** 3 de 3 publicables. Cada fila de título es la categoría de los repuestos que vienen debajo, escrita con el nombre del catálogo | 3, 4, 6 |
| 08 sin precio ni stock | ✅ **Arreglado.** El paso 2 exige el precio además de los obligatorios del esquema, y ofrece `SOLO_COTIZAR` como salida en vez de obligar a inventar un precio | 2, 3 |
| 09 varios autos por celda | ✅ **Arreglado.** Con el interruptor "varios autos en la misma celda" salen 2 repuestos con 3 compatibilidades extra; sin activarlo, la revisión avisa en vez de pasar en verde | 2, 3 |
| 10 todo junto | ⚠️ 1 de 2 publicables. Ya sólo falla por un "sin stock" que no es número | 4, 6 |
| 11 sin subcategoría | ✅ 6 de 6 publicables. Un catálogo ordenado al que sólo le falta un dato cuyos valores dependen de la categoría: es el que prueba "Completa lo que falta" | 2–7 |
| 12 prueba guiada | 🧪 **Para probar a mano.** No es un caso más: junta a propósito lo que conviene revisar en el paso 3 —subcategoría por completar, marca parecida, precio con decimales, stock que no es número, modelo escrito distinto del catálogo, varios autos en una celda, el mismo código repetido y un subtotal—. Los pasos para recorrerlo están más abajo | 2–10 |

**8 arreglados, 1 que ya andaba, 1 avisado, y dos que se sumaron para probar lo del paso 3.**

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
- **El número de fila apunta al Excel del vendedor.** Es el único dato que le sirve para ir a
  buscar el problema en su archivo, y se calculaba sobre la posición en el archivo generado
  —que ya no va fila a fila con el suyo: se sacan subtotales y bandas, se duplica por
  vehículo y se juntan los códigos repetidos. Cada fila arrastra de dónde vino, incluidas
  las filas en blanco que la lectura se saltaba desde antes de todo esto.
- **Los contadores cuadran.** Al sacar filas, el paso 3 decía "5 repuestos en tu archivo · 3
  se pueden publicar", como si dos hubieran fallado. Ahora las filas que no son repuestos se
  cuentan aparte, y los contadores van en singular cuando va uno.
- **El modelo del vehículo sale con el nombre del catálogo.** Antes era texto libre, así que
  un "COROLLA" quedaba tal cual y un modelo inventado no hacía aparecer el repuesto en la
  búsqueda por vehículo. Ahora se elige de la lista de modelos de su marca —la misma que usa
  la carga 1:1— y lo que ya venía escrito se normaliza contra el catálogo. Los años también
  se eligen, y el año hasta arranca en el año desde de su propia fila.
- **La hoja de compatibilidades se edita y se le agregan autos.** El archivo generado siempre
  llevó dos hojas, y la segunda sólo se veía abriendo el Excel. Ahora está en pantalla, cada
  celda se corrige con los mismos desplegables y validaciones que la tabla de arriba, y hay
  un botón para sumar las que falten. La sección aparece aunque ningún repuesto tenga más de
  un auto: es lo que hace que agregar una sirva en un archivo sin códigos repetidos.
- **Una corrección apunta a un auto, no a una fila.** La clave con la que se guarda era el
  número de fila del archivo, pero una fila que trae varios autos en una celda se separa en
  varias y todas compartían ese número: corregir la marca de un auto se la cambiaba a todos
  los de esa fila. Ahora la clave lleva de cuál se trata (`7:1`).
- **Un precio o un stock con decimales no se publica.** En pesos chilenos los precios son
  enteros; un "1.234,50" es casi siempre un error de tipeo, y un stock de 2,5 unidades no
  existe. Los dos retienen la fila y proponen el entero más cercano.

## Cómo recorrer el flujo a mano

Con `12-prueba-guiada.xlsx`, en "Adaptar mi plantilla". Está armado para que cada paso
tenga algo que mirar.

**Paso 2.** Marca los tres ajustes que ofrece: juntar las filas repetidas, separar los
varios autos de una celda, y dejar fuera las filas que no son repuestos. Cada uno cambia el
conteo de arriba, que es la forma de ver que hizo algo.

**Paso 3, de arriba abajo:**

1. **Arreglos que hicimos por ti** — tienen que aparecer `COROLLA → Corolla`, `45.000 c/u →
   45000` y `3 unid → 3`.
2. **Completa lo que falta** — Frenos tiene cuatro repuestos sin subcategoría. Elige una para
   el grupo y baja a la tabla: el disco quedó como pastilla. Cámbialo en su fila y mira que
   el grupo pase a decir "1 con valor propio".
3. **La tabla** — la fila del precio con decimales y la del stock `SIN STOCK` no se
   publican, y las dos se arreglan ahí mismo. Prueba a escribir letras en el stock: no
   tienen que entrar.
4. **Compatibilidades** — corrige la marca de una y comprueba que las otras no cambian.
   Agrega una con el botón, elige marca y modelo, y quítala para ver que se va.
5. **Generar** — abre el `.xlsx`: la hoja `inventario` con un repuesto por código y la hoja
   `compatibilidades` con los demás autos, incluida la que agregaste.

## Retener o avisar

Un problema que retiene la fila no la publica; uno que avisa la deja pasar. Dónde va cada
cosa no es obvio, y el criterio quedó así después de discutirlo con un caso concreto:

**Se retiene cuando el dato casi seguro está mal, aunque sea posible.** El precio con
decimales entró primero como aviso —un decimal es sospechoso, no imposible: puede venir de
una lista en otra moneda— y terminó como error por quién va a usar esto. Los vendedores del
panel son gente mayor que no va a revisar una lista de avisos: dan a publicar y siguen. Un
precio mal publicado se pierde en cada venta hasta que alguien lo note, y corregirlo acá
cuesta un clic en la tabla. La asimetría manda: molestar de más es barato, publicar mal no.

**Se avisa cuando el dato puede estar bien y sólo hay que mirarlo.** Una marca que no está
en el catálogo se crea, y eso es legítimo; el panel lo dice y sugiere la parecida, pero no
frena. Lo mismo con el punto que se leyó como separador de miles: se muestra el número con
el que va a quedar y el vendedor confirma de un vistazo.

**Y hay una tercera categoría: lo que no se decide.** Cuando faltan datos que ninguna
conversión puede inventar —el precio, el stock— el paso 2 no deja avanzar, en vez de dejar
recorrer el asistente entero para llegar a cero publicables.

## Lo que queda

**Dos tablas apiladas en una hoja (06) no se arregla, se avisa.** La segunda tabla trae
otras columnas, en otro orden y a veces una de más: no hay forma de leerla con los títulos
de arriba sin inventar a qué campo va cada dato. Se detecta y el paso 2 lo dice, con la
salida concreta —dejar cada tabla en su propia hoja y subirlas de a una—, que es mejor que
adivinar y publicar mal la mitad del archivo.

De ahí en adelante conviene esperar archivos de vendedores reales antes de seguir
afinando: todo lo que sigue serían casos imaginados por nosotros.

## Un detalle al comparar tests con el panel

En el 06 el test cuenta 4 columnas y el panel muestra 5. No es una diferencia de
comportamiento: el `.xlsx` real tiene 5 columnas de ancho porque la segunda tabla trae una
de más, así que la fila de títulos llega con una celda vacía al final y aparece como
"(columna E — sin título)". El AoA de `casos.mjs` no tiene ese relleno.

## Pendiente fuera de este repo

`normalizarNumero` dice replicar `InventarioExcelService.normalizarNumero` del backend. El
cambio de la coma de miles rompe ese espejo: **vale la pena replicarlo en el backend**, o un
vendedor que suba su Excel crudo por otra vía va a recibir 6,99 donde el panel entiende
6.990.

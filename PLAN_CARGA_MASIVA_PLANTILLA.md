# Carga masiva y adaptación de plantilla — análisis y plan por fases

Fecha: 2026-09-03 · Rama: `dev`

Público objetivo del flujo: dueños de tienda de repuestos, en su mayoría personas mayores,
con poca tolerancia a errores tardíos y a vocabulario técnico. Todo el plan se ordena por
ese criterio.

Fuentes revisadas:

- `vendedor_panel` — `ManualUpload.tsx` (carga 1 a 1), `FullCreationUpload.tsx`,
  `PlantillaMapper.tsx`, `utils/plantillaMapping.ts`, `BulkUpload.tsx`, `db.ts`.
- `repuestop/backend` — `InventarioExcelService.java` (contrato autoritativo de la plantilla).
- `repuestop/mobile` — `app/(seller)/crear-producto.tsx` (carga 1 a 1 de la app del vendedor).
- `Repuestop_Market` — `services/adapters.js` (qué campos consume la ficha del comprador).

---

## 1. Paridad de campos: plantilla ↔ carga 1 a 1

La fuente autoritativa es `InventarioExcelService.COLUMNAS_EXCEL`, **VERSION_PLANTILLA 2.0.0**,
18 columnas. `PLANTILLA_COLUMNAS` en `plantillaMapping.ts` **coincide exactamente**, incluido
el orden y la posición de `compatibilidad_general` (índice 10). El desajuste con los `.xlsx`
del repo es porque esos archivos son de la 1.1.0, no porque el panel esté mal.

| Campo en la carga 1 a 1 | Columna de la plantilla | Estado |
| --- | --- | --- |
| `sku` | `sku_proveedor` | OK |
| `name` | `nombre_publicado` | OK |
| `category` | `categoria` | OK |
| `subcategory` | `subcategoria` | OK |
| `partBrand` | `marca_repuesto` | OK |
| `oem` | `referencia_oem` | **Parcial** (ver G1) |
| `pricingMode` | `tipo_precio` | OK |
| `price` | `precio` | OK |
| `stock` | `stock` | OK |
| `condition` | `condicion` | OK |
| `requiresChassis` | `requiere_chasis` | OK |
| `description` | `descripcion` | OK |
| `esUniversal` | `compatibilidad_general` | OK |
| 1 compatibilidad (marca/modelo/años/motor) | columnas L–P | OK |
| N compatibilidades (`compatibilityGroupsJson`, `vehiculoCatalogoIds`) | hoja `compatibilidades` | OK en la plantilla oficial, **no en el mapper** (ver G3) |
| Hasta 4 fotos | sin columna | **Parcial** (ver G2) |
| `activo` / `pausado` / `destacado` / TOP | — | Correcto que no estén: no son datos de creación |

La app del vendedor (`crear-producto.tsx`) tiene el mismo conjunto de campos que el panel
(subcategoría, universal, requiere chasis, condición, tarjetas de compatibilidad múltiples con
OEM por tarjeta). `Repuestop_Market` no consume ningún campo que la plantilla no cubra, salvo
las imágenes. **No falta ninguna columna de datos en la plantilla.** Los tres huecos son:

**G1 — OEM por compatibilidad.** En la carga 1 a 1 el OEM vive dentro de cada tarjeta de
compatibilidad (`CompatibilityCard.oem`) y la ficha del comprador lo lee por grupo
(`adapters.js:160`, `g.referenciaOem`). En la plantilla, `referencia_oem` es una sola columna a
nivel producto y `COLUMNAS_COMPATIBILIDADES` no tiene columna de OEM. Un repuesto cargado
masivamente con 3 compatibilidades pierde el OEM por vehículo. Es el único gap real de
paridad de datos, y se cierra en el backend con una columna aditiva.

**G2 — Imágenes.** El 1 a 1 sube hasta 4 fotos en el mismo guardado. La masiva las sube en una
fase B posterior, emparejando por nombre de archivo = SKU. No hay columna de imagen en el
contrato. Si el vendedor ya tiene URLs de fotos en su Excel —caso frecuente— hoy no hay forma
de aprovecharlas.

**G3 — Compatibilidades múltiples desde el mapper.** La plantilla oficial soporta la hoja
`compatibilidades`, pero `buildOfficialXlsxFile` genera una sola hoja. El vendedor que adapta
su propio Excel queda limitado a una compatibilidad por repuesto, justo cuando el formato más
común en listas de repuestos es una fila por aplicación.

**Nota de deuda:** el parser de `BulkUpload.tsx:640-830` no lee `requiere_chasis`, pero es
código muerto: `BulkUpload.tsx:386` deriva todo FULL_CREATION a `FullCreationUpload`. No es un
bug activo; es limpieza pendiente.

---

## 2. Riesgos del contrato (backend)

### R1 — CRÍTICO: corrupción silenciosa con plantillas viejas

El backend lee las filas **por posición**, no por nombre de encabezado:
`requestDesdeFila()` usa `row.getCell(0..17)` con índices fijos. La única detección de layout
es un check puntual: `headerRow.getCell(2) == "subcategoria"` (`InventarioExcelService.java:594`).

Y `validarVersionPlantilla()` retorna sin error cuando el archivo **no trae hoja
`instrucciones`** — se acepta como "formato antiguo" (`:196`).

Combinando ambas: un Excel de 17 columnas (plantilla 1.x) **sin hoja `instrucciones`** pasa la
guarda de versión, pasa el check de `subcategoria` (el índice 2 coincide en ambos layouts) y se
lee con el mapa de 18 columnas. Desde la columna K todo queda corrido un lugar:

- `compatibilidad_marca` se llena con el modelo
- `anio_desde` con el año hasta
- `descripcion` con el motor
- `requiere_chasis` con la descripción

Sin un solo error en el reporte. El vendedor ve "120 productos cargados" y su catálogo queda
inservible.

Reproducible hoy con archivos del propio repo: `Prueba_Carga_Masiva_250_registros_Asincrono.xlsx`
y `Prueba_Carga_Masiva_Casos_Mixtos.xlsx` son exactamente ese caso (17 columnas, sin
`instrucciones`). `Catalogo_120_Productos_RepuesTop.xlsx` sí declara `VERSION_PLANTILLA: 1.1.0`
y se rechaza correctamente — lo que demuestra que la guarda funciona sólo cuando el archivo
colabora.

### R2 — El archivo del mapper no declara versión

`buildOfficialXlsxFile` genera una única hoja `inventario`, sin `instrucciones`. Entra por la
rama "formato antiguo". Hoy funciona **por coincidencia** de que el orden hardcodeado en
`plantillaMapping.ts` es idéntico al del backend. En el próximo cambio de columnas del backend,
el mapper produce corrupción silenciosa (mismo mecanismo que R1) en vez de un error.

### R3 — El contrato está triplicado y el endpoint que lo unifica no se usa

`COLUMNAS_EXCEL` (backend), `PLANTILLA_COLUMNAS` (panel) y los `generate_*.js` mantienen la
misma lista a mano. `GET /inventario/excel/esquema` ya devuelve columnas, obligatorias y
catálogos (categorías, subcategorías por categoría, marcas de repuesto, marcas de vehículo) y
**nadie lo consume**. El propio código lo admite en `plantillaMapping.ts:52`.

---

## 3. Flujo "Adaptar mi plantilla": evaluación de usabilidad

Referencias externas consultadas para contrastar (ver §6): el patrón consolidado en la
industria es **subir → mapear → revisar → confirmar**, con autodetección, presets guardables,
bloqueo de obligatorios, normalización en el punto de mapeo y vista previa de filas
transformadas antes de escribir nada.

### Lo que ya está bien y hay que conservar

- Entrada dual clara ("plantilla oficial" vs "ya tengo mi Excel").
- Autodetección en dos pasadas (exacta/sinónimo, luego difusa conservadora) sin que una
  coincidencia débil le robe la columna a una fuerte.
- Las columnas sobrantes van a la descripción por defecto: no se pierde información.
- Memoria del mapeo por firma de encabezados.
- Todo se procesa en el navegador y nada se publica hasta confirmar. Bien comunicado.

### Problemas, ordenados por cuántos vendedores dejan fuera

| # | Problema | Dónde | Impacto |
| --- | --- | --- | --- |
| U1 | Asume encabezados en la fila 1 (`aoa[0]`). Los Excel de tienda traen título, logo o filas en blanco arriba. El vendedor ve "(columna A — sin título)" y se bloquea. | `plantillaMapping.ts:parseUserFile` | **Fallo nº1 esperable** |
| U2 | Toma ciegamente la primera hoja (`SheetNames[0]`). Muy común: una hoja por marca, o "Portada" primero. | idem | Alto |
| U3 | Traduce los enums fáciles y no traduce los que fallan. La sección "Traducir valores" sólo cubre columnas con `enumHint`. `categoria` y `marca_repuesto`, que se validan contra catálogo en el backend, se envían tal cual. | `mappedEnumColumns` | **Causa nº1 de errores masivos** |
| U4 | Sin normalización numérica: "$ 12.900", "12.900", "10 un." se copian como texto. El formato chileno con punto de miles es lo normal. | `buildOfficialAoA` | Alto |
| U5 | Sin split de rangos de año: "2014-2020" en una columna es formato estándar de listas de repuestos. | idem | Alto |
| U6 | Sin split de compatibilidad en texto libre: "Toyota Corolla 2014-2020" en una columna "Aplicación". Hoy sólo se puede mandar a la descripción, perdiendo la compatibilidad estructurada — que es justo lo que hace que el repuesto aparezca en búsquedas por patente. | idem | Alto |
| U7 | Los obligatorios avisan pero no bloquean ("puedes continuar igual"). El vendedor genera, sube, analiza y recibe 300 errores. Descubrimiento tardío. | `PlantillaMapper.tsx` | Alto |
| U8 | No hay vista previa del resultado. Nunca se muestra "así queda tu producto". Para un usuario mayor, ver un producto armado vale más que 18 selects correctos. | idem | Alto |
| U9 | Todo en una pantalla larga: 18 selects + N extras + bloques de traducción en scroll continuo. Dice "Paso 2" pero no hay pasos reales. | idem | Medio-alto |
| U10 | Sin valor por defecto por columna. Si el vendedor no tiene columna "condición" porque todo es alternativo, su única salida es editar el Excel. | idem | Medio |
| U11 | Sin corrección inline: para arreglar una celda hay que volver a Excel y re-subir todo. | mapper y análisis | Medio |
| U12 | Vocabulario técnico ("columna oficial", "mapeo", "extras") y tipografía chica: `.mapper-step-body span` 0.72rem ≈ 11.5px, `.mapper-hero-text p` 0.8rem ≈ 12.8px. | `index.css:581-701` | Medio, agravado por el público |
| U13 | El mapeo guardado vive sólo en `localStorage` de ese navegador. Es la función que más ahorra en el uso repetido (lista mensual) y se pierde al cambiar de equipo. | `saveMapping` | Medio |
| U14 | Sin vuelta atrás: no se puede volver del análisis al mapeo conservando lo hecho; "Descartar" limpia todo. | `FullCreationUpload.tsx` | Medio |

---

## 4. Plan por fases

Cada fase es independiente, desplegable por sí sola y pensada para una sesión de trabajo.
El orden es: primero lo que hoy puede dañar datos, después lo que quita errores en volumen,
después lo que hace el flujo agradable.

### Fase 0 — Cerrar la corrupción silenciosa `backend` — COMPLETADA 2026-09-03

- Reemplazar la guarda de versión por una **guarda de forma**: validar la fila de encabezados
  completa contra `COLUMNAS_EXCEL` antes de leer una sola fila. Si no calza, rechazo con
  mensaje concreto ("tu archivo tiene 17 columnas y falta `compatibilidad_general`; descarga la
  plantilla nueva").
- Retirar la rama sin `subcategoria` del lector: no hay vendedores en producción (P1), así que
  el layout 2.0.0 es el único válido y el lector queda con un solo camino.
- Regenerar los tres `.xlsx` de prueba a 2.0.0 con hoja `instrucciones`, y actualizar
  `generate_120_products_excel.js` y `generate_bulk_excel.js`.
- Test de regresión: un Excel de 17 columnas sin `instrucciones` debe ser **rechazado**, no
  leído corrido.

**Criterio de término:** no existe ningún archivo que el backend lea con las columnas
desalineadas sin avisar.

**Resultado.** `validarEstructuraPlantilla` compara la fila de encabezados completa contra
`COLUMNAS_EXCEL` —y la hoja `compatibilidades` contra las suyas— antes de leer una sola fila,
con un mensaje que nombra la columna, lo esperado y lo encontrado. Las columnas propias del
vendedor al final se toleran, porque el lector nunca las mira. La guarda de versión queda solo
para dar un mensaje más preciso cuando el archivo sí declara su origen. Se retiró la rama del
layout sin `subcategoria`. Los tres `.xlsx` de prueba y sus generadores pasan a 2.0.0 con hoja
`instrucciones`. 38 tests verdes en `InventarioExcelServiceTest`, incluidos cuatro nuevos de
estructura; el central es `rechazaLaPlantilla1xAunqueNoDeclareVersion`.

Nota para la Fase 1: el archivo que genera el mapper del panel sigue sin declarar versión y
ahora pasa por su cabecera, que es correcta. Sumarle la hoja `instrucciones` con la versión que
entregue `/excel/esquema` es parte de la Fase 1, no un pendiente de ésta.

### Fase 1 — Contrato único desde el backend `panel` `backend` — COMPLETADA 2026-09-04

- El panel consume `GET /inventario/excel/esquema` al abrir la carga masiva y deriva de ahí
  columnas, obligatorias y catálogos.
- `PLANTILLA_CAMPOS` deja en el código sólo lo que el backend no sabe: etiquetas en español,
  sinónimos de autodetección y ayudas.
- `buildOfficialXlsxFile` agrega hoja `instrucciones` con el `VERSION_PLANTILLA` recibido.
- Fallback al contrato hardcodeado si el esquema no responde: un endpoint caído no puede
  impedir una carga.

**Por qué acá:** sin los catálogos del esquema no se puede hacer la Fase 5, que es la que más
errores elimina.

**Resultado.** `useEsquemaPlantilla` (`src/utils/plantillaEsquema.ts`) pide el esquema al abrir
la carga masiva y `FullCreationUpload` se lo pasa al mapper. `camposDesdeEsquema` arma la lista
de campos combinando lo que manda el backend —columnas, obligatorias, versión, valores de
`tipo_precio` y `condicion`— con lo único que queda en el panel, `PLANTILLA_TEXTOS`: etiquetas
en español y sinónimos de autodetección. Las funciones puras (`autoDetectMapping`,
`reconcileMapping`, `buildOfficialAoA`, `mappedEnumColumns`) reciben los campos como parámetro
en vez de leer la lista global, así que una columna nueva del backend aparece sola en la
pantalla y en el archivo generado, con una etiqueta derivada de su nombre. `ESQUEMA_FALLBACK`
es el contrato copiado que se usa si el endpoint no responde: un backend caído no puede impedir
preparar el archivo. Sus catálogos de categorías y marcas van vacíos a propósito —una copia
local desactualizada haría "traducir" a valores que el backend ya no acepta—, y por eso la
Fase 5 depende de que el esquema sí responda.

`buildOfficialXlsxFile` agrega la hoja `instrucciones` con la versión recibida, con lo que se
cierra R2: el archivo del mapper ya no entra al backend sin declarar de dónde salió.

Los catálogos de categorías, subcategorías y marcas ya llegan al panel pero todavía no se usan:
son el insumo de la Fase 5. Meterlos hoy en "Traducir valores" convertiría esa sección en
cientos de selects, que es justo lo que esa fase resuelve bien.

Un cambio de comportamiento visible: `tipo_precio` dejó de ser obligatorio en la pantalla,
porque el backend no lo lista como tal. La pantalla ahora dice lo mismo que va a validar el
backend, que era el punto de la fase.

69 tests verdes en el panel, incluidos nueve nuevos sobre el esquema, el fallback y la hoja
`instrucciones`.

### Fase 2 — Wizard de 4 pasos y lectura robusta del archivo `panel` — COMPLETADA 2026-09-04

Resuelve U1, U2, U7, U9, U12. Es la fase de mayor impacto en usabilidad.

- **Selector de hoja** cuando el libro tenga más de una, mostrando filas por hoja.
- **Detección automática de la fila de encabezados**: primera fila con 3+ celdas de texto no
  numérico, con control manual "mis títulos están en la fila N" y vista previa de las primeras
  5 filas crudas para confirmar.
- Pasos reales con barra de progreso: **1 Subir · 2 Relacionar · 3 Revisar · 4 Generar**, con
  botones Atrás/Siguiente grandes.
- Bloquear el avance mientras falten obligatorios, ofreciendo como alternativa "usar el mismo
  valor para todas las filas" (se completa en Fase 4).
- Tipografía de trabajo a 15–16px mínimo, objetivos de click ≥44px.
- Reescritura de textos: "columna oficial" → "dato que pide RepuesTop"; "extras" → "columnas
  que te sobran"; "mapeo" → "relación entre columnas".

**Resultado.** La lectura del archivo se separó en tres piezas puras: `leerLibro` (todas las
hojas, sin interpretar), `detectarFilaEncabezados` (primera fila con 3+ celdas que parezcan
títulos) y `columnasDeHoja` (columnas y filas a partir de la hoja y la fila elegidas).
`columnasDeHoja` no lanza a propósito: el wizard necesita poder mostrar "esta hoja no tiene
datos" y dejar elegir otra, en vez de cortar con un error.

El mapper pasó a ser un wizard real de cuatro pasos con barra de progreso —**1 Subir · 2
Relacionar · 3 Revisar · 4 Generar**— y botones Atrás/Siguiente de 48px. El paso 1 muestra las
primeras filas crudas con la fila de títulos marcada, y se corrige haciendo clic en la fila
correcta; si el libro trae varias hojas, se abre en la primera con datos (no en la portada) y
las demás se ofrecen con su cantidad de filas. El paso 3 concentra el resumen, los contadores
en lenguaje llano y la traducción de valores, que antes vivían en la misma pantalla larga.

Los obligatorios ahora **bloquean** el avance. Para que el bloqueo no encierre a nadie, una
columna obligatoria sin asignar ofrece escribir el mismo valor para todas las filas
(`Mapping.defaults`, que también se guarda con el mapeo). La Fase 4 extiende ese valor por
defecto a todas las columnas y lo conecta con los catálogos.

Dentro de `.mapper` el texto de trabajo no baja de 15px y los controles no bajan de 44px de
alto; fuera del wizard el panel queda igual.

**Hallazgo durante la verificación en el navegador:** al leer un CSV, `xlsx` interpretaba
`$ 4.990` —el formato normal de una lista chilena— como el número 4,99, y el vendedor publicaba
el precio mal sin que nada avisara. `leerLibro` ahora lee los CSV con `raw: true`, así que el
valor llega tal como lo escribió el vendedor y la Fase 4 lo normaliza a la vista.

83 tests verdes en el panel, incluidos los del wizard por pasos, la detección de títulos con
encabezado de planilla arriba, la elección de hoja y el bloqueo de obligatorios.

### Fase 3 — Vista previa del resultado `panel` — COMPLETADA 2026-09-04

Resuelve U8.

- Paso "Revisar": tabla con las primeras ~20 filas ya transformadas, en columnas oficiales, con
  las celdas problemáticas marcadas y el motivo al lado.
- Encima, una tarjeta **"así se verá tu primer repuesto en RepuesTop"**, replicando la ficha de
  `Repuestop_Market` (nombre, marca, categoría, precio, condición, compatibilidad, descripción).
- Contadores en lenguaje llano: "120 filas · 118 se pueden publicar · 2 con problemas".

**Resultado.** `plantillaRevision.ts` revisa el archivo ya transformado y dice, fila por fila,
qué va a pasar cuando lo lea el backend. Sus reglas son una réplica deliberada de
`requestDesdeFila` + `InventarioValidationSupport`: si el panel marcara un error donde el
backend no lo marca, el vendedor perdería tiempo corrigiendo algo que estaba bien; si lo
dejara pasar, se enteraría después de subir, que es justo lo que este paso viene a evitar.

Dos severidades, porque el backend tiene dos comportamientos:

- **error** — la fila no se publica: obligatorio vacío, número ilegible o negativo, y el caso
  menos evidente, precio vacío sin `SOLO_COTIZAR` (un `tipo_precio` en blanco significa "con
  precio a la vista", así que el backend lo rechaza).
- **aviso** — la fila se publica, pero con un valor distinto del que el vendedor escribió. El
  backend normaliza en silencio: una condición que no reconoce queda como ORIGINAL, un SI/NO
  que no entiende queda en NO, y `$ 4.990` se publica como 4.990. Antes nada de esto se veía.

En el paso "Revisar" hay ahora tres cosas: los contadores en lenguaje llano ("3 repuestos ·
1 se pueden publicar · 2 con problemas · 1 para mirar"), la tarjeta **"así se verá tu primer
repuesto en RepuesTop"** —el primero que sí se puede publicar, armado como en la ficha del
comprador: nombre, marca, categoría, condición, precio en pesos, compatibilidad, código,
stock y descripción— y la tabla de las primeras 20 filas ya transformadas, con las celdas
problemáticas marcadas y el motivo en lenguaje llano en una columna fija a la derecha, para
que no haya que ir a buscarlo al final del scroll. Las columnas que quedan vacías en todas las
filas mostradas se ocultan: con las 18 completas, lo que hay que mirar se pierde entre celdas
en blanco.

101 tests verdes en el panel, 18 de ellos nuevos sobre la revisión y la ficha.

### Fase 4 — Normalización y valores por defecto `panel` — COMPLETADA 2026-09-04

Resuelve U4, U5, U10. Es el trabajo sucio que evita los errores en volumen.

- Números: limpiar `$`, espacios y separadores de miles (chilenos e ingleses) en `precio` y
  `stock`, mostrando antes/después.
- Años: detectar "2014-2020", "2014 a 2020", "2014/2020" en una sola columna y ofrecer dividir
  en `anio_desde` / `anio_hasta`.
- Valor por defecto por columna: "sin dato → usar este valor en todas las filas", disponible en
  las columnas de lista y en subcategoría/marca.
- Reglas de texto: recorte de espacios, normalización de SI/NO/X/1/true.

**Resultado.** `plantillaNormalizacion.ts` limpia cada celda según la columna oficial a la que
va, y `buildOfficialAoADetallado` devuelve, además del archivo, la lista de arreglos hechos.
Nada se limpia a ciegas: el paso "Revisar" abre con **"Arreglos que hicimos por ti"**, cada uno
como antes → después con la cantidad de filas ("Precio · $ 4.990 → 4990 · 23 filas"), y el
archivo original del vendedor no se toca.

- **Números:** misma interpretación que `InventarioExcelService.normalizarNumero`, para que lo
  que el panel muestra sea lo que el backend guarda. "$ 12.900" → 12900; "1.234,50" → 1234.5;
  "4.99" se respeta como decimal.
- **Años:** cuando la columna que quedó en "año desde" trae rangos ("2014-2020", "2014 a 2020",
  "2014/2020", "2014 al 2020"), el paso 2 ofrece dividirla, ya marcado y con un ejemplo real del
  archivo. No pisa la columna de "año hasta" si el vendedor sí trajo una con dato.
- **Sí/no:** la X de la planilla es el caso más común y el backend sólo entiende SI/SÍ/TRUE/1.
  También V, verdadero, S, Y, y sus contrarios.
- **Texto:** recorte y colapso de los espacios de copiar y pegar entre planillas.
- **Valor fijo por columna:** el "mismo valor para todas las filas" que la Fase 2 dejó sólo en
  los obligatorios ahora está en **toda** columna sin asignar, y en las columnas de lista es un
  desplegable con los valores válidos en vez de texto libre.

Lo que no se puede interpretar se deja **tal cual**: no se inventa nada, y es la revisión del
paso 3 la que lo marca. Y "Traducir tus palabras" dejó de preguntar por los valores que la
limpieza ya resuelve —una X que va a quedar en SI no es una decisión pendiente, y preguntarla
hacía pensar que faltaba algo.

**Hallazgo:** una columna llamada "Años" (en plural) no se autodetectaba, porque los sinónimos
sólo tenían las formas en singular. Se agregaron los plurales y "rango de años"/"año modelo".

123 tests verdes en el panel, 22 de ellos nuevos sobre la limpieza, los rangos de años y los
valores fijos.

### Fase 5 — Traducción contra los catálogos reales `panel` — COMPLETADA 2026-09-04

Resuelve U3. Es la fase que más errores elimina.

- Con los catálogos de la Fase 1, extender "Traducir valores" a `categoria`, `subcategoria` y
  `marca_repuesto`.
- Para cada valor distinto del vendedor, **sugerir el más parecido del catálogo** (normalización
  sin acentos + comparación por tokens/distancia) y dejarlo confirmar: "Frenos delanteros →
  Frenos".
- Presentarlo como lista de decisiones pendientes ordenada por frecuencia ("aparece en 43
  filas"), no como 200 selects.
- Guardar las traducciones junto al mapeo.

**Resultado.** `plantillaCatalogos.ts` compara los valores del vendedor contra los catálogos
reales que ya entrega el esquema desde la Fase 1. Lo primero fue mirar qué hace el backend con
cada columna, porque la consecuencia es distinta y la severidad tenía que seguirla:

- **categoría** — `buscarCategoria` la busca y **no la crea**: si no está, la fila no se
  publica. Es el error masivo más caro del flujo, y ahora se ve antes de subir.
- **subcategoría** — tiene que pertenecer a la categoría del producto; si no, el repuesto se
  publica **sin subcategoría** y el backend deja una advertencia. Es aviso, no error.
- **marca de repuesto** — `buscarOCrearMarca` la crea si no existe. Un "Bosh" mal escrito no
  rompe nada, pero deja una marca nueva en el catálogo: así se llegó a las 45 categorías
  duplicadas que hubo que consolidar a mano. Es aviso, con la sugerencia al lado.

La sugerencia combina palabras compartidas ("Frenos delanteros" → Frenos), inclusión y
distancia de edición ("Bosh" → Bosch), y se queda con la mejor de las tres; bajo 0,55 no se
sugiere nada, porque una sugerencia mala es ruido. Las decisiones se muestran **ordenadas por
frecuencia** ("aparece en 8 repuestos"), con un botón **"Usar todas las sugerencias"** que las
aplica de una vez. Las traducciones viven en el `valueMap` que ya se guardaba con el mapeo, así
que la próxima lista del mismo vendedor llega traducida.

`buildOfficialAoA` aplica ahora el `valueMap` a **todas** las columnas y no sólo a las de lista,
que es lo que hace falta para traducir categorías y marcas.

En la prueba del navegador, una lista de 12 repuestos con "Frenos delanteros" en 8 filas y
"Bosh" en 3 pasó de **3 publicables a 11 con un clic**. La única que queda es la que de verdad
necesita decisión humana ("Amortiguacion" no se parece lo suficiente a "Suspensión").

140 tests verdes en el panel, 17 de ellos nuevos.

### Fase 6 — Compatibilidad múltiple y texto libre `panel` `backend` — COMPLETADA 2026-09-04

Resuelve U6, G1, G3.

- Detectar SKU repetido en el archivo del vendedor y, en vez de marcarlo como duplicado,
  ofrecer: "tu archivo trae varias filas por repuesto → las convertimos en compatibilidades
  múltiples", generando la hoja `compatibilidades`.
- Asistente para columna de aplicación en texto libre: parsear "Toyota Corolla 2014-2020"
  contra el catálogo de marcas de vehículo, con vista previa y corrección.
- Interruptor "todo mi inventario es universal".
- **Backend:** agregar `referencia_oem` a `COLUMNAS_COMPATIBILIDADES` para cerrar G1 (cambio
  aditivo, sube versión menor).

**Resultado.** Plantilla **2.1.0**.

**Backend (G1).** `COLUMNAS_COMPATIBILIDADES` suma `referencia_oem`. Agregar la columna no
bastaba: la carga masiva nunca armaba `compatibilityGroupsJson`, que es de donde la ficha del
comprador lee el OEM por vehículo (`adapters.js`, `g.referenciaOem`), así que un repuesto con
tres compatibilidades perdía el OEM de cada una aunque la columna existiera.
`resolverCompatibilidadMultiple` arma ahora un grupo por compatibilidad resuelta —marca,
modelo, años, motor, OEM y su id de catálogo—; una fila sin OEM propio hereda el del producto,
igual que hace la ficha. La guarda de encabezados aprendió a distinguir columnas obligatorias
de opcionales al final: un archivo 2.0.0 sin la columna de OEM se sigue leyendo, pero otra
columna en su lugar se rechaza, porque el lector va por posición.

**Panel (U6, G3).** `plantillaCompatibilidad.ts`:

- **SKU repetido** — si el archivo trae el mismo código en varias filas, en vez de tratarlo
  como duplicado (que el backend rechaza) se ofrece publicarlo como un repuesto con varias
  compatibilidades: la primera fila define el repuesto y el resto va a la hoja
  `compatibilidades`. Si las filas repetidas difieren en precio o nombre, se dice cuál se usa.
- **Aplicación en texto libre** — "TOYOTA Corolla 2014-2018" se parte en marca, modelo y años
  usando el catálogo de marcas de vehículo como ancla. Sin marca reconocida no se toca nada:
  inventar una compatibilidad es peor que no declarar ninguna. La columna se busca también
  entre las que el vendedor **no** asignó, que es donde vive una columna "Aplicación", y
  activar el interruptor la asigna sola.
- **Interruptor "todo mi inventario es universal"**, para el vendedor cuyo catálogo entero
  sirve para cualquier vehículo.

**Hallazgo de la verificación con los catálogos reales del backend local:** el panel daba por
válida la categoría "Suspension" sin tilde, pero el backend busca con `findByNombreIgnoreCase`,
que ignora mayúsculas y **no** tildes: la fila se habría rechazado igual. Ahora, cuando el
valor del vendedor identifica sin ambigüedad a uno del catálogo, se escribe el nombre del
catálogo (categoría, subcategoría, marca de repuesto y marca de vehículo) y el cambio aparece
entre los arreglos: "Categoría · Suspension → Suspensión · 1 fila".

Verificado de punta a punta con los catálogos reales de la base local: una lista de 5 filas con
el SKU repetido tres veces, precios con peso y aplicaciones de corrido quedó en 3 repuestos, 2
compatibilidades extra con su OEM propio, precios limpios y la categoría corregida.

41 tests verdes en el backend y 153 en el panel, 24 de ellos nuevos.

### Fase 7 — Fotos desde el Excel del vendedor `panel` `backend`

Resuelve G2.

- Permitir mapear una columna con URL o nombre de archivo de foto; el panel la empareja y la
  entrega a la fase B de fotos que ya existe.
- **Backend:** evaluar una columna `imagen` opcional al final de la plantilla oficial (aditiva,
  versión menor).

### Fase 8 — Persistencia por cuenta y limpieza `panel` `backend`

Resuelve U13, U14 y la deuda del §1.

- Guardar mapeo + traducciones en el backend asociados al proveedor, no en `localStorage`.
- "Volver a mapear" desde la pantalla de análisis conservando lo hecho.
- Eliminar el código muerto de FULL_CREATION en `BulkUpload.tsx` y el test de contrato que ya
  cubre `plantillaMapping.ts`.

### Fase 9 (opcional) — Corrección inline

Resuelve U11. Editar celdas problemáticas dentro del análisis y reintentar sólo esas filas, sin
volver a Excel. Es el patrón que diferencia a los importadores comerciales; se deja al final
porque es el de mayor costo y menor alcance si las fases 4 y 5 hacen bien su trabajo.

---

## 5. Preguntas abiertas — resueltas 2026-09-03

- **P1 — ¿Hay vendedores en producción con plantillas 1.x?** **No.** El proyecto sigue en
  desarrollo, no hay catálogos reales cargados. Por lo tanto la Fase 0 **retira** la rama
  `tieneColumnaSubcategoria` y el lector queda con un solo camino, el de la 2.0.0. No hace falta
  período de gracia ni migración de archivos de vendedores.
- **P2 — ¿El OEM por compatibilidad se usa en la búsqueda?** Hoy es **informativo** en la ficha;
  a futuro se usará para afinar la compatibilidad. G1 **se queda en la Fase 6**, no sube de
  prioridad.
- **P3 — ¿Backend y panel se coordinan?** **Sí**, mismo ciclo. Las fases 0, 1, 6 y 7 se
  planifican tocando ambos repos a la vez.

---

## 6. Referencias externas

- [Best UX flow for spreadsheet imports — CSVBox](https://blog.csvbox.io/spreadsheet-import-ux/)
- [How To Design Bulk Import UX — Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/bulk-ux/)
- [CSV import column mapping UI: safer matching, defaults, previews — AppMaster](https://appmaster.io/blog/csv-import-column-mapping-ui)
- [5 Best Practices to Streamline Your CSV Import Process — Dromo](https://dromo.io/blog/5-best-practices-to-streamline-your-csv-import-process)
- [CSV Upload UI: File Import UX Patterns — CSVBox](https://blog.csvbox.io/file-upload-patterns/)

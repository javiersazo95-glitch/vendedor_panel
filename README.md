# RepuesTop — Panel de Vendedor

Panel web para que los vendedores de RepuesTop administren su catálogo de repuestos: alta manual de productos (1:1), carga masiva desde Excel/CSV, gestión de stock y precios, e imágenes de producto. Es un frontend puro (React + TypeScript + Vite); toda la persistencia y autenticación real vive en un backend Spring Boot externo que **no** forma parte de este repositorio.

## Requisitos previos

- Node.js 18+ y npm.
- El backend Spring Boot de RepuesTop corriendo y accesible (por defecto se asume `http://localhost:8080` en desarrollo local).
- Un Google OAuth Client ID habilitado para este proyecto, si se va a usar el login con Google.

## Configuración

Copiar `.env.example` a `.env.local` y completar:

```
VITE_API_URL=http://localhost:8080      # URL base del backend Spring Boot
VITE_GOOGLE_CLIENT_ID=<tu-client-id>    # Client ID de Google OAuth
```

En `localhost`/`127.0.0.1`, si `VITE_API_URL` no está definido, la app usa `http://localhost:8080` por defecto. En cualquier otro entorno (staging, preview, producción), `VITE_API_URL` es obligatorio: si falta, la app falla al iniciar en vez de apuntar silenciosamente a producción.

## Comandos

```
npm install       # instalar dependencias
npm run dev       # servidor de desarrollo con HMR
npm run build     # type-check (tsc -b) + build de producción a dist/
npm run lint      # ESLint
npm run test      # pruebas unitarias (Vitest)
npm run preview   # sirve el build de dist/ localmente
```

## Flujos principales

- **Login** (`src/components/Auth.tsx`): correo/contraseña o Google OAuth contra el backend.
- **Carga manual 1:1** (`src/components/ManualUpload.tsx`): alta o edición de un producto individual, con catálogo de vehículos y cálculo de comisión.
- **Carga masiva — Publicación Completa** (`src/components/FullCreationUpload.tsx`): sube la
  plantilla oficial al backend (`/excel/validar` para el análisis previo, `/excel/cargar` para
  publicar, con polling cuando el archivo supera el umbral asíncrono), asigna las fotos por SKU
  desde ZIP o carpeta y deja una imagen genérica cuando no hay foto real. `BulkUpload.tsx`
  ya solo atiende **Actualización Rápida** (plantilla de 3 columnas: sku, precio, stock) y
  deriva la publicación completa al componente de arriba.
- **Adaptar mi plantilla** (`src/components/PlantillaMapper.tsx`, `src/utils/plantillaMapping.ts`):
  para el vendedor que ya lleva su inventario en su propio Excel. Wizard de cuatro pasos
  (subir · relacionar · revisar · generar): elige la hoja y la fila de títulos de su archivo,
  relaciona sus columnas con las oficiales, manda las que sobran a la descripción, revisa qué
  filas se van a publicar y cómo se verá su primer repuesto, y genera el archivo en formato
  oficial, todo en el navegador. El plan de mejoras de este flujo está en
  [PLAN_CARGA_MASIVA_PLANTILLA.md](PLAN_CARGA_MASIVA_PLANTILLA.md).
- **Inventario** (`src/components/InventoryTable.tsx`, `src/components/Dashboard.tsx`): listado,
  filtros, pausar/reanudar y eliminar productos. El orden por defecto lo decide
  `src/utils/inventoryOrder.ts` — ver la sección siguiente.
- **Monedero de Monedas RepuesTop** (`src/components/WalletModal.tsx`): saldo, productos Top
  vigentes con lo que le queda a cada uno, recarga por Flow (`RechargeModal.tsx`), historial de
  movimientos (`WalletHistoryModal.tsx`) y la boleta o factura de cada recarga
  (`DocumentViewerModal.tsx`). Ver la sección siguiente.
- **Producto Top** (`src/components/TopModal.tsx`): activar o renovar la insignia Top Ventas de
  un repuesto por 30 días, con los cupos gratuitos y el costo que informa el backend.

## El orden del Inventario General

Hasta septiembre de 2026 el panel **no ordenaba nada**: mostraba el orden en que llegaban los
productos del backend (`updatedAt DESC`), o sea arriba lo último que el vendedor tocó. Ahora hay
dos modos, y el selector vive en la barra de la vista de inventario.

**Recomendado** (por defecto) agrupa en cinco tramos, definidos en `src/utils/inventoryOrder.ts`:

| # | Grupo | Por qué está ahí |
| :-- | :--- | :--- |
| 1 | Top vencido | Es lo único que YA está costando plata: pagó una posición que dejó de tener |
| 2 | Top vigente, el que menos días le quedan primero | "Los Top primero" a secas dejaba al que vence mañana en cualquier parte de la lista |
| 3 | Necesitan atención: sin stock y pausados | Nadie los puede comprar así |
| 4 | Stock bajo (menos de 10) | Se venden, solo hay que reponer |
| 5 | El resto, por última modificación | Es el orden que el panel tenía siempre |

**El stock bajo va aparte del grupo 3 a propósito.** Con un catálogo real — 149 repuestos, 54 de
ellos bajo 10 unidades — meterlo en "necesitan atención" marcaba como urgente a más de un tercio
del inventario, y un grupo que ocupa un tercio de la lista ya no señala nada.

**Los grupos se muestran con un separador**, en la tabla y en la cuadrícula. Un reordenamiento
silencioso se lee como "se me desordenó el inventario"; el encabezado le pone nombre a algo que
las filas ya distinguen por color. En la tabla el separador se recalcula por página, así que la
página 2 de un grupo largo repite su encabezado en vez de empezar sin decir qué es.

**Última modificación** es la salida para el día de la carga masiva: recién subidas 150 filas, lo
que el vendedor quiere ver es lo que acaba de subir, no sus productos Top.

## El monedero y la recarga de Monedas

El monedero del panel es **el mismo** que el de la app móvil y el del market web, y las tres
superficies consumen los mismos endpoints. Lo que hay que saber antes de tocarlo:

- **La recarga se cobra de verdad, por Flow.** `startRecharge()` llama `POST /fichas/recargas`,
  que crea una intención **PENDIENTE** y devuelve la URL de la pasarela; las Monedas se acreditan
  **solo cuando el webhook confirma el pago**. El panel no acredita nada y no debe volver a
  hacerlo: hasta septiembre de 2026 llamaba `POST /fichas/compras` y el backend le creía que el
  vendedor había pagado.
- **Los packs y el precio salen del backend** (`GET /fichas/packs`). No hay lista fija en el
  panel: cuando la había, cambiar un precio obligaba a desplegar las tres plataformas.
- **El método de pago se elige dentro de Flow**, no antes. El selector que había acá era
  decoración: ninguna de sus opciones cobraba nada.
- **El documento tributario se pregunta ANTES de cobrar**, y el RUT de una factura se valida con
  módulo 11 en el cliente (`src/utils/rut.ts`) y otra vez en el backend. Cortar antes es lo
  correcto: después de cobrar, una factura que no se puede emitir obliga a devolver la plata.
  Los datos llegan prellenados desde `GET /fichas/recargas/datos-documento`, que los arma el
  backend juntando la tienda y el perfil — si cada cliente lo armara por su cuenta, terminarían
  sugiriendo cosas distintas para el mismo vendedor.
- **El retorno vuelve al panel gracias a `origen: 'PANEL_VENDEDOR'`.** El backend usa ese valor
  para mandar la página puente de Flow a la URL del panel (`repuestop.panel.base-url`) en vez de
  a `repuestop.cl/perfil/anuncios`. **No cambiarlo por `INVENTARIO`**: ese lo usa el market web
  desde su modal de Producto Top, y compartirlo mandaría al panel a quien nunca salió del sitio
  web.
- **Al volver, el parámetro `?recarga=` se limpia de la URL** (`Dashboard.tsx`). Si queda puesto,
  recargar la página vuelve a celebrar una recarga que ya se celebró.
- **La boleta o factura se ve desde el detalle de un movimiento del historial**, que es el lugar
  al que el vendedor vuelve a buscarla. El PDF se baja a un blob antes de mostrarlo; las razones
  están en `DocumentViewerModal.tsx` y valen igual que en la web.

Para correrlo en local hace falta el backend levantado. Si además está corriendo el market web,
uno de los dos frontends cae en el 5174 y hay que arrancar el backend con `PANEL_BASE_URL`
apuntando al puerto del panel, o el retorno de la recarga se va al sitio equivocado.

El contexto completo del dominio tributario (los cuatro documentos, quién los emite y por qué)
vive en `HANDOFF_BOLETAS_Y_RECARGA.md` del repo del backend.

## Estructura

- `src/db.ts` — capa de acceso a la API del backend (productos, batch de carga masiva, monedero y recargas).
- `src/utils/plantillaMapping.ts` — lógica pura del adaptador (autodetección, mapeo de
  valores, generación del `.xlsx` oficial) y contrato de respaldo de la plantilla.
- `src/utils/plantillaEsquema.ts` — consumo de `GET /inventario/excel/esquema`, la fuente
  autoritativa del contrato.
- `src/utils/plantillaRevision.ts` — revisión previa de las filas ya transformadas y ficha de
  vista previa. Replica a propósito las reglas de validación del backend; si el backend cambia
  las suyas, hay que mover estas en el mismo ciclo.
- `src/utils/plantillaNormalizacion.ts` — limpieza de los valores del vendedor (precios
  chilenos, rangos de años, la X como sí, espacios). Misma interpretación de números que
  `InventarioExcelService.normalizarNumero`.
- `src/utils/plantillaCatalogos.ts` — comparación contra los catálogos reales de categorías,
  subcategorías y marcas, con sugerencias del más parecido.
- `src/utils/plantillaCompatibilidad.ts` — compatibilidad múltiple: SKU repetido a la hoja
  `compatibilidades` y parseo de la aplicación escrita de corrido.
- `src/utils/plantillaFotos.ts` — fotos declaradas en el Excel del vendedor (enlace o nombre de
  archivo). Se descargan desde el navegador, nunca desde el backend.
- `src/utils/plantillaMapeos.ts` — mapeos guardados en la cuenta del vendedor
  (`/inventario/excel/mapeos`), con `localStorage` como espejo local.
- `generate_120_products_excel.js`, `generate_bulk_excel.js` — generadores de `.xlsx` de
  prueba con el formato oficial vigente. Ejecutar con `node <archivo>` después de cualquier
  cambio de columnas; no generan archivos versionados, hay que correrlos para tener datos.
- `pruebas-pago/` — Excel (`Prueba_Flujos_Pago.xlsx`, 5 productos reales con precio y stock,
  formato oficial `2.1.0`) + `fotos/` con una foto real por SKU, para probar de punta a punta
  los flujos de pago (checkout, Flow, boleta). Queda fuera de git a propósito: se regenera
  cuando haga falta, no es un asset versionado del proyecto.
- `src/utils/inventoryOrder.ts` — los grupos y el orden del Inventario General. Función pura:
  recibe los productos y devuelve la lista ordenada más a qué grupo quedó cada uno.
- `src/utils/rut.ts` — formato y dígito verificador (módulo 11) del RUT chileno. Mismo
  algoritmo que el market web y la app: si el panel fuera más permisivo, el vendedor se
  enteraría del error recién después de apretar "Pagar".
- `src/utils/session.ts` — sesión de usuario en `sessionStorage` (TTL de 2 horas).
- `src/utils/imageHelper.ts` — resolución de URLs de imágenes y `API_BASE_URL`.

## El contrato de la plantilla de carga masiva

La lista de columnas **no es de este repositorio**. La fuente autoritativa es
`InventarioExcelService.COLUMNAS_EXCEL` en el backend, hoy en la versión `2.1.0` con 18
columnas, y el panel la consume por `GET /inventario/excel/esquema` al abrir la carga masiva
(`src/utils/plantillaEsquema.ts`). De ahí salen las columnas, cuáles son obligatorias, la
versión de la plantilla y los catálogos de categorías, subcategorías y marcas.

Importa saberlo porque **el backend lee cada fila por posición, no por nombre de columna**, y
rechaza cualquier archivo cuya cabecera no calce exactamente con esa lista (las columnas
propias del vendedor al final sí se toleran). El archivo que genera el adaptador declara su
versión en la hoja `instrucciones`, igual que la plantilla oficial.

Lo que queda hardcodeado en el panel es sólo lo que el backend no sabe:

1. `PLANTILLA_TEXTOS` en `src/utils/plantillaMapping.ts` — etiquetas en español y sinónimos
   de autodetección por columna. Una columna nueva del backend igual aparece en la pantalla,
   con una etiqueta derivada de su nombre; agregarle sinónimos acá sólo mejora la
   autodetección.
2. `ESQUEMA_FALLBACK` en el mismo archivo — copia del contrato que se usa **sólo** si
   `/excel/esquema` no responde, para que un endpoint caído no impida preparar el archivo.
   Es lo que compara `src/components/BulkUpload.columns.test.ts`, el test de contrato que
   avisa antes que el vendedor.
3. Los dos generadores de `.xlsx` de prueba de la raíz, que hay que volver a correr tras
   cualquier cambio de columnas.

El plan de mejoras del flujo está en
[PLAN_CARGA_MASIVA_PLANTILLA.md](PLAN_CARGA_MASIVA_PLANTILLA.md).

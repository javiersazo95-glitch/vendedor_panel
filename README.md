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
- **Inventario** (`src/components/InventoryTable.tsx`, `src/components/Dashboard.tsx`): listado, filtros, pausar/reanudar y eliminar productos.

## Estructura

- `src/db.ts` — capa de acceso a la API del backend (productos, batch de carga masiva).
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
- `generate_120_products_excel.js`, `generate_bulk_excel.js` — generadores de los `.xlsx` de
  prueba de la raíz. Ejecutar con `node <archivo>` después de cualquier cambio de columnas.
- `src/utils/session.ts` — sesión de usuario en `sessionStorage` (TTL de 2 horas).
- `src/utils/imageHelper.ts` — resolución de URLs de imágenes y `API_BASE_URL`.

## El contrato de la plantilla de carga masiva

La lista de columnas **no es de este repositorio**. La fuente autoritativa es
`InventarioExcelService.COLUMNAS_EXCEL` en el backend, hoy en la versión `2.0.0` con 18
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

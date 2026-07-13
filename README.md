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
- **Carga masiva** (`src/components/BulkUpload.tsx`): importación desde plantilla Excel/CSV, con asignación de imágenes desde ZIP/carpeta y generación de imagen genérica cuando no hay foto real.
- **Inventario** (`src/components/InventoryTable.tsx`, `src/components/Dashboard.tsx`): listado, filtros, pausar/reanudar y eliminar productos.

## Estructura

- `src/db.ts` — capa de acceso a la API del backend (productos, batch de carga masiva).
- `src/utils/session.ts` — sesión de usuario en `sessionStorage` (TTL de 2 horas).
- `src/utils/imageHelper.ts` — resolución de URLs de imágenes y `API_BASE_URL`.

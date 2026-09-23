import { API_BASE_URL, DEFAULT_PRODUCT_IMAGE_URL, resolveImageUri } from './utils/imageHelper';
import { apiFetch } from './utils/apiFetch';
import { getStoredSession } from './utils/session';
import { encId } from './utils/url';
import { comprimirImagenes } from './utils/imageCompression';

/** ManualUpload siempre entrega File, pero el tipo tambien admite Blob por los otros llamadores de addProduct/updateProduct. */
const nombreDeImagen = (archivo: File | Blob): string => ('name' in archivo ? archivo.name : 'foto.jpg');

export interface Product {
  id: string;
  sku: string;
  oem: string;
  name: string;
  category: string;
  // La plantilla oficial trae subcategoria; sin este campo la carga masiva la
  // descartaba en silencio aunque el vendedor la hubiera completado.
  subcategory?: string;
  partBrand: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number;
  vehicleVersion: string;
  price: number;
  stock: number;
  description: string;
  image: string; // URL string
  pricingMode?: 'show_price' | 'quote_only';
  condition?: 'ORIGINAL' | 'ALTERNATIVO';
  requiresChassis?: boolean;
  vehicleYearTo?: number;
  // Compatibilidad universal: el repuesto se publica sin compatibilidad vehicular y
  // aparece para cualquier busqueda de modelo/patente (backend: esUniversal).
  esUniversal?: boolean;
  vehiculoCatalogoIds?: number[];
  compatibilityGroupsJson?: string;
  lastUpdated?: string;
  activo?: boolean;
  pausado?: boolean;
  destacado?: boolean;
  topDesde?: string | null;
  topHasta?: string | null;
  topGratuito?: boolean | null;
}

export interface BatchResult {
  success: Product[];
  errors: { row: number; sku: string; error: string }[];
}

interface FilaCargaResultado {
  fila: number;
  sku: string;
  estado: 'OK' | 'ADVERTENCIA' | 'ERROR';
  mensajes: string[];
}

export interface PrecioStockUpdateResponse {
  totalFilas: number;
  productosCargados: number;
  productosConError: number;
  filas: FilaCargaResultado[];
}

type ProductImageInput = File | Blob | (File | Blob)[] | null;

function imageInputList(imageInput?: ProductImageInput): (File | Blob)[] {
  if (!imageInput) return [];
  return Array.isArray(imageInput) ? imageInput : [imageInput];
}

/**
 * Agrega al FormData el flag de compatibilidad universal y los campos de compatibilidad
 * vehicular. Cuando el repuesto es universal (esUniversal), la compatibilidad va vacia:
 * el backend igual procesa el texto de compatibilidad si llega, asi que hay que limpiarlo
 * aca para que el repuesto quede realmente universal.
 */
function appendCompatibilidad(formData: FormData, product: { esUniversal?: boolean; vehicleBrand: string; vehicleModel: string; vehicleYear: number; vehicleYearTo?: number; vehicleVersion: string; vehiculoCatalogoIds?: number[]; compatibilityGroupsJson?: string; }): void {
  const universal = product.esUniversal === true;
  formData.append('esUniversal', String(universal));
  formData.append('compatibilidadMarca', universal ? '' : product.vehicleBrand);
  formData.append('compatibilidadModelo', universal ? '' : product.vehicleModel);
  formData.append('anioDesde', universal ? '' : String(product.vehicleYear));
  formData.append('anioHasta', universal ? '' : String(product.vehicleYearTo ?? product.vehicleYear));
  formData.append('motor', universal ? '' : product.vehicleVersion);
  formData.append('compatibilityGroupsJson', universal ? '' : (product.compatibilityGroupsJson || ''));
  if (!universal) {
    (product.vehiculoCatalogoIds || []).forEach((id) => {
      formData.append('vehiculoCatalogoIds', String(id));
    });
  }
}

// Helper to retrieve JWT token and sellerId from the current tab session.
function getSession(): { token: string; sellerId: string } | null {
  const user = getStoredSession();
  if (!user) return null;

  return { token: user.token, sellerId: user.sellerId };
}

/**
 * Revoca un token en el servidor.
 *
 * Borrar el almacenamiento local solo esconde el token: el JWT sigue valido hasta su `exp` -- 8 h
 * deslizantes segun el backend --, asi que uno capturado antes seguia abriendo inventario y
 * monedero. Importa en mostradores y equipos compartidos, que es donde se usa el panel.
 *
 * Funciona tambien con un token ya vencido: `logout` revoca con la misma ventana de gracia con la
 * que el backend deja refrescar (SEC-BACKEND-140). Hasta el 2026-09-22 exigia un `exp` futuro, y
 * entonces esta llamada fallaba en silencio para quien volvia pasadas las 8 h -- justo cuando el
 * token seguia canjeable por una sesion nueva. Ya no.
 */
async function revocarToken(token: string): Promise<void> {
  await apiFetch(`${API_BASE_URL}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
}

/** Cierra la sesion actual tambien en el servidor (SEC-MARKET-B06). */
export async function logout(): Promise<void> {
  const session = getSession();
  if (!session) return;

  await revocarToken(session.token);
}

/**
 * Revoca una sesion que el panel ya descarto por vencimiento (SEC-MARKET-B03).
 *
 * Va aparte de `logout()` porque para entonces la sesion ya no esta en el almacenamiento: el
 * token llega desde `tomarTokenPorRevocar()`, que lo retuvo al descartarla.
 */
export async function revocarSesionVencida(token: string): Promise<void> {
  await revocarToken(token);
}

// Shape of ProveedorProductoResponseDTO as returned by the Spring Boot backend.
// Fields are optional/loosely typed because the backend response is not
// validated at the boundary; mapDtoToProduct() still guards every field with
// a fallback below.
interface ProductDto {
  id: string | number;
  skuProveedor?: string;
  referenciaOem?: string;
  nombrePublicado?: string;
  repuestoNombre?: string;
  categoria?: string;
  subcategoria?: string;
  marcaRepuesto?: string;
  compatibilidadMarca?: string;
  compatibilidadModelo?: string;
  anioDesde?: number;
  anioHasta?: number;
  motor?: string;
  precio?: number;
  stock?: number;
  descripcion?: string;
  imageUrls?: string[];
  pricingMode?: string;
  condicion?: string;
  requiereChasis?: boolean;
  esUniversal?: boolean;
  vehiculoCatalogoIds?: number[];
  compatibilityGroupsJson?: string;
  updatedAt?: string;
  createdAt?: string;
  activo?: boolean;
  pausado?: boolean;
  destacado?: boolean;
  topDesde?: string | null;
  topHasta?: string | null;
  topGratuito?: boolean | null;
}

// Helper to map Spring Boot DTO (ProveedorProductoResponseDTO) to frontend Product interface
function mapDtoToProduct(dto: ProductDto): Product {
  return {
    id: String(dto.id),
    sku: dto.skuProveedor || '',
    oem: dto.referenciaOem || '',
    name: dto.nombrePublicado || dto.repuestoNombre || '',
    category: dto.categoria || 'Motor',
    subcategory: dto.subcategoria || undefined,
    partBrand: dto.marcaRepuesto || '',
    vehicleBrand: dto.compatibilidadMarca || '',
    vehicleModel: dto.compatibilidadModelo || '',
    // 0 = "el backend no mandó año", que es lo normal en un repuesto universal. Antes se rellenaba
    // con el año actual: el panel inventaba un dato que nadie declaró, y ese año falso se veía en
    // la tabla ("2026 - "), se colaba en el desplegable de años del filtro y volvía al backend al
    // editar el producto. El resto del código ya trata el 0 como "sin año" (`vehicleYear > 0`).
    vehicleYear: dto.anioDesde || 0,
    vehicleVersion: dto.motor || '',
    price: Number(dto.precio || 0),
    stock: Number(dto.stock || 0),
    description: dto.descripcion || '',
    image: dto.imageUrls && dto.imageUrls.length > 0 ? dto.imageUrls[0] : DEFAULT_PRODUCT_IMAGE_URL,
    pricingMode: dto.pricingMode === 'QUOTE_ONLY' ? 'quote_only' : 'show_price',
    condition: dto.condicion === 'ALTERNATIVO' ? 'ALTERNATIVO' : 'ORIGINAL',
    requiresChassis: dto.requiereChasis === true,
    esUniversal: dto.esUniversal === true,
    vehicleYearTo: dto.anioHasta || dto.anioDesde || 0,
    vehiculoCatalogoIds: dto.vehiculoCatalogoIds || [],
    compatibilityGroupsJson: dto.compatibilityGroupsJson || '',
    lastUpdated: dto.updatedAt || dto.createdAt || new Date().toISOString(),
    activo: dto.activo !== false,
    pausado: dto.pausado === true,
    destacado: dto.destacado === true,
    topDesde: dto.topDesde ?? null,
    topHasta: dto.topHasta ?? null,
    topGratuito: dto.topGratuito ?? null,
  };
}

export interface ProductTopSummary {
  activos: number;
  gratuitosDisponibles: number;
  maximo: number;
  cuposGratuitos: number;
  costoMonedas: number;
  duracionDias: number;
  saldoMonedas: number;
}

export interface WalletBalance {
  saldo: number;
}

/**
 * Un pack de Monedas del catalogo del backend (`GET /fichas/packs`).
 *
 * El panel ya no lleva su propia lista: la tenia fija en `WalletModal`, con precios que nadie
 * garantizaba iguales a los de la app y la web. Cambiar un precio obligaba a desplegar las tres.
 */
export interface CoinPack {
  id: string;
  nombre: string;
  monedas: number;
  bonus: number;
  totalMonedas: number;
  precioClp: number;
  etiqueta: string | null;
  descripcion: string | null;
  color: string | null;
  destacado: boolean;
}

/** Un movimiento del monedero. `cantidad` siempre es positiva: el signo lo da `tipo`. */
export interface WalletMovement {
  id: string;
  tipo: 'CREDITO' | 'DEBITO';
  cantidad: number;
  motivo: string | null;
  descripcion: string | null;
  anuncioId: string | null;
  fecha: string;
  /** La compra que origino el credito. Sin esto no hay a que pedirle el documento. */
  compraId: string | null;
  documentoDisponible: boolean;
  documentoTipo: string | null;
  documentoFolio: string | null;
  documentoFecha: string | null;
}

export interface WalletHistory {
  saldo: number;
  movimientos: WalletMovement[];
}

export type TipoDocumentoTributario = 'BOLETA' | 'FACTURA';

/** Que documento sugerirle al vendedor y con que datos llega prellenado el formulario. */
export interface DatosDocumentoRecarga {
  tipoSugerido: TipoDocumentoTributario;
  rut: string;
  razonSocial: string;
  giro: string;
}

export interface DocumentoRecarga {
  tipo: TipoDocumentoTributario;
  rut: string;
  razonSocial: string;
  giro: string;
}

async function getApiError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json() as { message?: string; error?: string; errors?: string[] };
    return data.message || data.error || (Array.isArray(data.errors) ? data.errors.join('\n') : fallback);
  } catch {
    return fallback;
  }
}

export async function getAllProducts(): Promise<Product[]> {
  const session = getSession();
  if (!session) return [];

  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${session.token}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Error al obtener el inventario desde el servidor.');
  }

  const list = await response.json();
  return list.map(mapDtoToProduct);
}

export async function addProduct(
  product: Omit<Product, 'id' | 'lastUpdated'>,
  imageFile?: ProductImageInput
): Promise<Product> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa de vendedor.');

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${session.token}`
  };

  const imageFiles = imageInputList(imageFile).slice(0, 4);

  // Este panel solo crea productos personalizados (sin repuestoId de catálogo),
  // así que siempre debe usar el endpoint multipart /personalizado, que crea el
  // repuesto automáticamente. El endpoint JSON plano exige repuestoId y solo
  // aplica para vincular un repuesto de catálogo ya existente.
  const formData = new FormData();
  formData.append('skuProveedor', product.sku);
  formData.append('nombrePublicado', product.name);
  formData.append('categoria', product.category);
  if (product.subcategory) {
    formData.append('subcategoria', product.subcategory);
  }
  formData.append('marcaRepuesto', product.partBrand);
  formData.append('referenciaOem', product.oem || '');
  appendCompatibilidad(formData, product);
  formData.append('pricingMode', product.pricingMode === 'quote_only' ? 'QUOTE_ONLY' : 'SHOW_PRICE');
  formData.append('precio', String(product.price));
  formData.append('stock', String(product.stock));
  formData.append('descripcion', product.description || '');
  formData.append('condicion', product.condition || 'ORIGINAL');
  formData.append('requiereChasis', String(product.requiresChassis === true));
  formData.append('activo', 'true');
  const imagenesComprimidas = await comprimirImagenes(
    imageFiles.map((file) => ({ blob: file, filename: nombreDeImagen(file) })),
  );
  imagenesComprimidas.forEach(({ blob, filename }) => formData.append('imagenes', blob, filename));

  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/personalizado`, {
    method: 'POST',
    headers,
    body: formData
  });

  if (!response.ok) {
    let errMsg = 'Error al registrar el producto en el servidor.';
    try {
      const errData = await response.json();
      if (errData && errData.message) {
        errMsg = errData.message;
      }
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  return mapDtoToProduct(data);
}

export async function updateProduct(
  product: Product,
  imageFile?: ProductImageInput
): Promise<Product> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${session.token}`
  };

  let response: Response;

  const imageFiles = imageInputList(imageFile).slice(0, 4);

  if (imageFiles.length > 0) {
    // Use multipart editing endpoint
    const formData = new FormData();
    formData.append('skuProveedor', product.sku);
    formData.append('nombrePublicado', product.name);
    formData.append('categoria', product.category);
    if (product.subcategory) {
      formData.append('subcategoria', product.subcategory);
    }
    formData.append('marcaRepuesto', product.partBrand);
    formData.append('referenciaOem', product.oem || '');
    appendCompatibilidad(formData, product);
    formData.append('pricingMode', product.pricingMode === 'quote_only' ? 'QUOTE_ONLY' : 'SHOW_PRICE');
    formData.append('precio', String(product.price));
    formData.append('stock', String(product.stock));
    formData.append('descripcion', product.description || '');
    formData.append('condicion', product.condition || 'ORIGINAL');
    formData.append('requiereChasis', String(product.requiresChassis === true));
    formData.append('activo', String(product.activo !== false));
    const imagenesComprimidas = await comprimirImagenes(
      imageFiles.map((file) => ({ blob: file, filename: nombreDeImagen(file) })),
    );
    imagenesComprimidas.forEach(({ blob, filename }) => formData.append('imagenes', blob, filename));

    response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/${encId(product.id)}/editar`, {
      method: 'POST',
      headers,
      body: formData
    });
  } else {
    // Use JSON endpoint
    headers['Content-Type'] = 'application/json';
    const payload = {
      skuProveedor: product.sku,
      nombrePublicado: product.name,
      categoria: product.category,
      subcategoria: product.subcategory || undefined,
      marcaRepuesto: product.partBrand,
      referenciaOem: product.oem || '',
      esUniversal: product.esUniversal === true,
      compatibilidadMarca: product.esUniversal ? '' : product.vehicleBrand,
      compatibilidadModelo: product.esUniversal ? '' : product.vehicleModel,
      anioDesde: product.esUniversal ? undefined : product.vehicleYear,
      anioHasta: product.esUniversal ? undefined : (product.vehicleYearTo ?? product.vehicleYear),
      motor: product.esUniversal ? '' : product.vehicleVersion,
      pricingMode: product.pricingMode === 'quote_only' ? 'QUOTE_ONLY' : 'SHOW_PRICE',
      precio: product.price,
      stock: product.stock,
      descripcion: product.description || '',
      condicion: product.condition || 'ORIGINAL',
      requiereChasis: product.requiresChassis === true,
      vehiculoCatalogoIds: product.esUniversal ? [] : (product.vehiculoCatalogoIds || []),
      compatibilityGroupsJson: product.esUniversal ? '' : (product.compatibilityGroupsJson || ''),
      activo: product.activo !== false
    };

    response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/${encId(product.id)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload)
    });
  }

  if (!response.ok) {
    let errMsg = 'Error al actualizar el producto en el servidor.';
    try {
      const errData = await response.json();
      if (errData && errData.message) {
        errMsg = errData.message;
      }
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  return mapDtoToProduct(data);
}

export async function deleteProduct(id: string): Promise<void> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');

  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/${encId(id)}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${session.token}`
    }
  });

  if (!response.ok) {
    throw new Error('Error al eliminar el producto del inventario.');
  }
}

async function setProductPaused(id: string, paused: boolean): Promise<Product> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');

  const action = paused ? 'pausa' : 'retomar';
  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/${encId(id)}/${action}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.token}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(paused ? 'Error al bloquear la publicación.' : 'Error al retomar la publicación.');
  }

  const data = await response.json();
  return mapDtoToProduct(data);
}

export function pauseProduct(id: string): Promise<Product> {
  return setProductPaused(id, true);
}

export function resumeProduct(id: string): Promise<Product> {
  return setProductPaused(id, false);
}

export async function getProductTopSummary(): Promise<ProductTopSummary> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');
  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/top/resumen`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${session.token}`, 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(await getApiError(response, 'No se pudo consultar el estado de productos Top.'));
  return response.json() as Promise<ProductTopSummary>;
}

export async function setProductTop(id: string, renovar = false): Promise<Product> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');
  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/${encId(id)}/top`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${session.token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ destacado: true, renovar }),
  });
  if (!response.ok) throw new Error(await getApiError(response, 'No se pudo actualizar el producto Top.'));
  return mapDtoToProduct(await response.json() as ProductDto);
}

export async function getWalletBalance(): Promise<WalletBalance> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');
  const response = await apiFetch(`${API_BASE_URL}/api/v1/fichas/saldo`, {
    method: 'GET', headers: { 'Authorization': `Bearer ${session.token}`, 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(await getApiError(response, 'No se pudo consultar el monedero.'));
  return response.json() as Promise<WalletBalance>;
}

/** Foto del perfil de vendedor para el avatar del encabezado. Un 403 de perfil no debe cerrar
 * una sesión válida: vendedores bloqueados pueden seguir entrando al panel, aunque no vean este
 * endpoint. Por eso esta lectura opcional no usa apiFetch, que trata 403 como sesión vencida. */
export async function getSellerProfileImage(): Promise<string | null> {
  const session = getSession();
  if (!session) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/v1/users/perfil`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${session.token}`, 'Accept': 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') return null;
    const data = payload as Record<string, unknown>;
    const profile = data.usuario && typeof data.usuario === 'object'
      ? data.usuario as Record<string, unknown>
      : data.perfil && typeof data.perfil === 'object'
        ? data.perfil as Record<string, unknown>
        : data;
    const image = [profile.sellerProfileUrl, profile.userProfileUrl, profile.logoUrl, profile.storeLogoUrl, profile.avatarUrl]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return image ? resolveImageUri(image) : null;
  } catch {
    // El avatar es decorativo: si la lectura falla, el encabezado conserva la inicial.
    return null;
  }
}

/**
 * Saldo mas el historial de movimientos, del mas nuevo al mas viejo.
 *
 * Es la misma fuente que da el saldo, y por eso se leen juntos: el encabezado del historial
 * tiene que cuadrar con las filas que se estan mostrando.
 */
export async function getWalletHistory(): Promise<WalletHistory> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');
  const response = await apiFetch(`${API_BASE_URL}/api/v1/fichas/movimientos`, {
    method: 'GET', headers: { 'Authorization': `Bearer ${session.token}`, 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(await getApiError(response, 'No se pudo consultar el historial del monedero.'));
  const data = await response.json() as { saldo?: number; movimientos?: WalletMovement[] };
  return { saldo: Number(data.saldo) || 0, movimientos: Array.isArray(data.movimientos) ? data.movimientos : [] };
}

/** Catalogo de packs. Unica fuente de verdad del precio, compartida con la app y la web. */
export async function getCoinPacks(): Promise<CoinPack[]> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');
  const response = await apiFetch(`${API_BASE_URL}/api/v1/fichas/packs`, {
    method: 'GET', headers: { 'Authorization': `Bearer ${session.token}`, 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(await getApiError(response, 'No se pudieron cargar los packs de monedas.'));
  const packs = await response.json() as CoinPack[];
  return Array.isArray(packs) ? packs : [];
}

/**
 * Con que datos llega prellenado el paso del documento tributario.
 *
 * Lo arma el backend y no cada cliente: juntar la tienda y el perfil por separado en la web, la
 * app y el panel es como terminan sugiriendo cosas distintas para el mismo vendedor.
 */
export async function getRechargeDocumentData(): Promise<DatosDocumentoRecarga> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');
  const response = await apiFetch(`${API_BASE_URL}/api/v1/fichas/recargas/datos-documento`, {
    method: 'GET', headers: { 'Authorization': `Bearer ${session.token}`, 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(await getApiError(response, 'No se pudieron cargar tus datos de facturación.'));
  const data = await response.json() as Partial<DatosDocumentoRecarga>;
  return {
    tipoSugerido: data.tipoSugerido === 'FACTURA' ? 'FACTURA' : 'BOLETA',
    rut: data.rut || '',
    razonSocial: data.razonSocial || '',
    giro: data.giro || '',
  };
}

/**
 * `origen` con el que este panel arranca una recarga.
 *
 * Es el valor que el backend usa para devolver al vendedor ACA y no al sitio web al volver de
 * Flow. No es "INVENTARIO" a proposito: ese ya lo usa el market web cuando la recarga sale de su
 * modal de Producto Top, y compartirlo mandaria al panel a quien nunca salio de repuestop.cl.
 */
const ORIGEN_RECARGA = 'PANEL_VENDEDOR';

/**
 * Arranca el cobro de una recarga y devuelve la URL de la pasarela.
 *
 * Reemplaza a la vieja `rechargeWallet()`, que llamaba `POST /fichas/compras` y acreditaba las
 * monedas de inmediato: el backend le creia al panel que el vendedor habia pagado, sin que
 * hubiera entrado un peso. Esta funcion NO acredita nada. Se crea la intencion, el vendedor se
 * va a Flow, y las monedas entran cuando el webhook confirma que el dinero llego.
 *
 * El precio y la cantidad de monedas salen del catalogo del backend, nunca de aca: es lo que
 * impide que alguien pida 10.000 monedas por $1.
 */
export async function startRecharge(packId: string, documento: DocumentoRecarga): Promise<{ url: string; token: string }> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');
  const response = await apiFetch(`${API_BASE_URL}/api/v1/fichas/recargas`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      packId,
      origen: ORIGEN_RECARGA,
      // El backend valida el RUT con modulo 11 antes de cobrar y corta si no sirve: una factura
      // que no se puede emitir despues del cobro obliga a devolver la plata.
      tipoDocumento: documento.tipo,
      ...(documento.rut ? { facturaRut: documento.rut } : {}),
      ...(documento.razonSocial ? { facturaRazonSocial: documento.razonSocial } : {}),
      ...(documento.giro ? { facturaGiro: documento.giro } : {}),
    }),
  });
  if (!response.ok) throw new Error(await getApiError(response, 'No se pudo iniciar el pago de la recarga.'));
  const data = await response.json() as { url?: string; token?: string };
  if (!data.url) throw new Error('La pasarela no devolvió una URL de pago.');
  return { url: data.url, token: data.token || '' };
}

/**
 * Enlace privado para ver y descargar la boleta o factura de una recarga.
 *
 * El backend comprueba que la compra sea de quien pregunta antes de emitir el token, y responde
 * 404 -- no 403 -- cuando es de otro: un 403 ya confirmaria que existe, y ahi van el RUT, la
 * razon social y cuanto gasto.
 */
export async function getRechargeDocumentUrl(compraId: string): Promise<string> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');
  const response = await apiFetch(`${API_BASE_URL}/api/v1/fichas/compras/${encId(compraId)}/documento-url`, {
    method: 'GET', headers: { 'Authorization': `Bearer ${session.token}`, 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(await getApiError(response, 'No se pudo abrir el documento de esta recarga.'));
  const data = await response.json() as { url?: string };
  if (!data.url) throw new Error('No se pudo abrir el documento de esta recarga.');
  return data.url;
}

// Batch save for bulk upload
export async function saveProductsBatch(
  productsData: (Omit<Product, 'id' | 'lastUpdated'> & { imageFile?: File | Blob | (File | Blob)[] | null; sourceRow?: number })[],
  overwriteExisting: boolean = true,
  onProgress?: (percent: number) => void
): Promise<BatchResult> {
  const result: BatchResult = {
    success: [],
    errors: [],
  };

  let allProds: Product[];
  try {
    allProds = await getAllProducts();
  } catch {
    // Abort the whole batch instead of silently treating every row as new:
    // proceeding with an empty inventory here would misclassify existing
    // SKUs as new products and create duplicates (see ENG-SRC-004).
    return {
      success: [],
      errors: productsData.map((prodData, index) => ({
        row: index + 2,
        sku: prodData.sku,
        error: 'No se pudo verificar el inventario existente, intenta nuevamente.',
      })),
    };
  }

  if (onProgress) {
    onProgress(0);
  }


  // O(1) Map lookup index by normalized SKU to handle 10,000+ items instantly

  const existingSkuMap = new Map<string, Product>();
  allProds.forEach((p) => {
    if (p.sku) {
      existingSkuMap.set(p.sku.trim().toUpperCase(), p);
    }
  });

  let completedCount = 0;
  const totalCount = productsData.length;

  const batchSize = 12;
  for (let i = 0; i < productsData.length; i += batchSize) {
    // Yield UI thread every 50 items to keep browser rendering smooth during 10,000+ item loads
    if (i > 0 && i % 50 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }

    const chunk = productsData.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async (prodData, offset) => {
        // Prefer the row number from the original file (sourceRow): productsData
        // may already have had invalid rows filtered out during analysis, so the
        // array index no longer matches the real row in the uploaded Excel/CSV.
        const rowNumber = prodData.sourceRow ?? i + offset + 2; // Row 1 is header
        const normalizedSku = prodData.sku.trim().toUpperCase();

        const saveItemWithRetry = async (): Promise<Product> => {
          const existing = existingSkuMap.get(normalizedSku);
          if (existing) {
            if (overwriteExisting) {
              const updatedPayload: Product = {
                ...existing,
                ...prodData,
                id: existing.id
              };
              return await updateProduct(updatedPayload, prodData.imageFile);
            } else {
              throw new Error(`El SKU ya existe en el catálogo (registro omitido por SKU duplicado).`);
            }
          } else {
            return await addProduct(prodData, prodData.imageFile);
          }
        };

        try {
          try {
            const savedProd = await saveItemWithRetry();
            existingSkuMap.set(normalizedSku, savedProd);
            result.success.push(savedProd);
          } catch (firstErr: unknown) {
            const errMsg = firstErr instanceof Error ? firstErr.message : '';
            if (errMsg.includes('SKU ya existe')) {
              throw firstErr;
            }
            await new Promise((r) => setTimeout(r, 200));
            const savedProd = await saveItemWithRetry();
            existingSkuMap.set(normalizedSku, savedProd);
            result.success.push(savedProd);
          }
        } catch (err: unknown) {
          result.errors.push({
            row: rowNumber,
            sku: prodData.sku,
            error: err instanceof Error ? err.message : 'Error desconocido al procesar la fila.'
          });
        } finally {
          completedCount++;
          if (onProgress) {
            onProgress(Math.round((completedCount / totalCount) * 100));
          }
        }
      })
    );
  }

  return result;
}

/**
 * Actualizacion masiva de precio/stock (Fase 14, modo Express). Reemplaza el N-requests-PUT
 * de saveProductsBatch(..., overwriteExisting=true) por un solo POST al backend: el
 * servidor resuelve cada SKU y actualiza solo precio/stock, sin poder tocar nombre,
 * categoria, imagenes ni "activo" (ver PrecioStockItemRequestDTO en el backend) -- asi que
 * este camino tambien deja de heredar el bug de activo:true de updateProduct().
 */
export async function savePreciosStockBatch(
  items: { skuProveedor: string; precio: number; stock: number }[]
): Promise<PrecioStockUpdateResponse> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa de vendedor.');

  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${encId(session.sellerId)}/inventario/precios-stock`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(items)
  });

  if (!response.ok) {
    let errMsg = 'Error al actualizar precios y stock en el servidor.';
    try {
      const errData = await response.json();
      if (errData && errData.message) {
        errMsg = errData.message;
      }
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  return await response.json();
}

import { API_BASE_URL } from './utils/imageHelper';
import { apiFetch } from './utils/apiFetch';
import { getStoredSession } from './utils/session';

export interface Product {
  id: string;
  sku: string;
  oem: string;
  name: string;
  category: string;
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
  vehiculoCatalogoIds?: number[];
  compatibilityGroupsJson?: string;
  lastUpdated?: string;
  activo?: boolean;
  pausado?: boolean;
}

export interface BatchResult {
  success: Product[];
  errors: { row: number; sku: string; error: string }[];
}

type ProductImageInput = File | Blob | (File | Blob)[] | null;

function imageInputList(imageInput?: ProductImageInput): (File | Blob)[] {
  if (!imageInput) return [];
  return Array.isArray(imageInput) ? imageInput : [imageInput];
}

// Helper to retrieve JWT token and sellerId from the current tab session.
function getSession(): { token: string; sellerId: string } | null {
  const user = getStoredSession();
  if (!user) return null;

  return { token: user.token, sellerId: user.sellerId };
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
  vehiculoCatalogoIds?: number[];
  compatibilityGroupsJson?: string;
  updatedAt?: string;
  createdAt?: string;
  activo?: boolean;
  pausado?: boolean;
}

// Helper to map Spring Boot DTO (ProveedorProductoResponseDTO) to frontend Product interface
function mapDtoToProduct(dto: ProductDto): Product {
  return {
    id: String(dto.id),
    sku: dto.skuProveedor || '',
    oem: dto.referenciaOem || '',
    name: dto.nombrePublicado || dto.repuestoNombre || '',
    category: dto.categoria || 'Motor',
    partBrand: dto.marcaRepuesto || '',
    vehicleBrand: dto.compatibilidadMarca || '',
    vehicleModel: dto.compatibilidadModelo || '',
    vehicleYear: dto.anioDesde || new Date().getFullYear(),
    vehicleVersion: dto.motor || '',
    price: Number(dto.precio || 0),
    stock: Number(dto.stock || 0),
    description: dto.descripcion || '',
    image: dto.imageUrls && dto.imageUrls.length > 0 ? dto.imageUrls[0] : '',
    pricingMode: dto.pricingMode === 'QUOTE_ONLY' ? 'quote_only' : 'show_price',
    condition: dto.condicion === 'ALTERNATIVO' ? 'ALTERNATIVO' : 'ORIGINAL',
    requiresChassis: dto.requiereChasis === true,
    vehicleYearTo: dto.anioHasta || dto.anioDesde || new Date().getFullYear(),
    vehiculoCatalogoIds: dto.vehiculoCatalogoIds || [],
    compatibilityGroupsJson: dto.compatibilityGroupsJson || '',
    lastUpdated: dto.updatedAt || dto.createdAt || new Date().toISOString(),
    activo: dto.activo !== false,
    pausado: dto.pausado === true,
  };
}

export async function getAllProducts(): Promise<Product[]> {
  const session = getSession();
  if (!session) return [];

  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario`, {
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
  formData.append('marcaRepuesto', product.partBrand);
  formData.append('referenciaOem', product.oem || '');
  formData.append('compatibilidadMarca', product.vehicleBrand);
  formData.append('compatibilidadModelo', product.vehicleModel);
  formData.append('anioDesde', String(product.vehicleYear));
  formData.append('anioHasta', String(product.vehicleYearTo ?? product.vehicleYear));
  formData.append('motor', product.vehicleVersion);
  formData.append('pricingMode', product.pricingMode === 'quote_only' ? 'QUOTE_ONLY' : 'SHOW_PRICE');
  formData.append('precio', String(product.price));
  formData.append('stock', String(product.stock));
  formData.append('descripcion', product.description || '');
  formData.append('condicion', product.condition || 'ORIGINAL');
  formData.append('requiereChasis', String(product.requiresChassis === true));
  formData.append('compatibilityGroupsJson', product.compatibilityGroupsJson || '');
  (product.vehiculoCatalogoIds || []).forEach((id) => {
    formData.append('vehiculoCatalogoIds', String(id));
  });
  formData.append('activo', 'true');
  imageFiles.forEach((file) => formData.append('imagenes', file));

  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/personalizado`, {
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
    formData.append('marcaRepuesto', product.partBrand);
    formData.append('referenciaOem', product.oem || '');
    formData.append('compatibilidadMarca', product.vehicleBrand);
    formData.append('compatibilidadModelo', product.vehicleModel);
    formData.append('anioDesde', String(product.vehicleYear));
    formData.append('anioHasta', String(product.vehicleYearTo ?? product.vehicleYear));
    formData.append('motor', product.vehicleVersion);
    formData.append('pricingMode', product.pricingMode === 'quote_only' ? 'QUOTE_ONLY' : 'SHOW_PRICE');
    formData.append('precio', String(product.price));
    formData.append('stock', String(product.stock));
    formData.append('descripcion', product.description || '');
    formData.append('condicion', product.condition || 'ORIGINAL');
    formData.append('requiereChasis', String(product.requiresChassis === true));
    formData.append('compatibilityGroupsJson', product.compatibilityGroupsJson || '');
    (product.vehiculoCatalogoIds || []).forEach((id) => {
      formData.append('vehiculoCatalogoIds', String(id));
    });
    formData.append('activo', 'true');
    imageFiles.forEach((file) => formData.append('imagenes', file));

    response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/${product.id}/editar`, {
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
      marcaRepuesto: product.partBrand,
      referenciaOem: product.oem || '',
      compatibilidadMarca: product.vehicleBrand,
      compatibilidadModelo: product.vehicleModel,
      anioDesde: product.vehicleYear,
      anioHasta: product.vehicleYearTo ?? product.vehicleYear,
      motor: product.vehicleVersion,
      pricingMode: product.pricingMode === 'quote_only' ? 'QUOTE_ONLY' : 'SHOW_PRICE',
      precio: product.price,
      stock: product.stock,
      descripcion: product.description || '',
      condicion: product.condition || 'ORIGINAL',
      requiereChasis: product.requiresChassis === true,
      vehiculoCatalogoIds: product.vehiculoCatalogoIds || [],
      compatibilityGroupsJson: product.compatibilityGroupsJson || '',
      activo: true
    };

    response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/${product.id}`, {
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

  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/${id}`, {
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
  const response = await apiFetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/${id}/${action}`, {
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

  let completedCount = 0;
  const totalCount = productsData.length;

  const batchSize = 3;
  for (let i = 0; i < productsData.length; i += batchSize) {
    const chunk = productsData.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async (prodData, offset) => {
        // Prefer the row number from the original file (sourceRow): productsData
        // may already have had invalid rows filtered out during analysis, so the
        // array index no longer matches the real row in the uploaded Excel/CSV.
        const rowNumber = prodData.sourceRow ?? i + offset + 2; // Row 1 is header
        try {
          const existing = allProds.find(p => p.sku.trim().toUpperCase() === prodData.sku.trim().toUpperCase());
          let savedProd: Product;
          if (existing) {
            if (overwriteExisting) {
              const updatedPayload: Product = {
                ...existing,
                ...prodData,
                id: existing.id
              };
              savedProd = await updateProduct(updatedPayload, prodData.imageFile);
              result.success.push(savedProd);
            } else {
              result.errors.push({
                row: rowNumber,
                sku: prodData.sku,
                error: `El SKU ya existe en el catálogo (registro omitido por SKU duplicado).`
              });
            }
          } else {
            savedProd = await addProduct(prodData, prodData.imageFile);
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

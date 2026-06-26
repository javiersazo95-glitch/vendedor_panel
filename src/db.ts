import { API_BASE_URL } from './utils/imageHelper';
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
  lastUpdated?: string;
  activo?: boolean;
  pausado?: boolean;
}

export interface BatchResult {
  success: Product[];
  errors: { row: number; sku: string; error: string }[];
}

// Helper to retrieve JWT token and sellerId from the current tab session.
function getSession(): { token: string; sellerId: string } | null {
  const user = getStoredSession();
  if (!user) return null;

  return { token: user.token, sellerId: user.sellerId };
}

// Helper to map Spring Boot DTO (ProveedorProductoResponseDTO) to frontend Product interface
function mapDtoToProduct(dto: any): Product {
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
    lastUpdated: dto.updatedAt || dto.createdAt || new Date().toISOString(),
    activo: dto.activo !== false,
    pausado: dto.pausado === true,
  };
}

export async function seedDBIfEmpty(): Promise<void> {
  // No-op for real backend database
}

export async function getAllProducts(): Promise<Product[]> {
  const session = getSession();
  if (!session) return [];

  const response = await fetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario`, {
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
  imageFile?: File | Blob | null
): Promise<Product> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa de vendedor.');

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${session.token}`
  };

  let response: Response;

  if (imageFile) {
    // Use the multipart endpoint
    const formData = new FormData();
    formData.append('skuProveedor', product.sku);
    formData.append('nombrePublicado', product.name);
    formData.append('categoria', product.category);
    formData.append('marcaRepuesto', product.partBrand);
    formData.append('referenciaOem', product.oem || '');
    formData.append('compatibilidadMarca', product.vehicleBrand);
    formData.append('compatibilidadModelo', product.vehicleModel);
    formData.append('anioDesde', String(product.vehicleYear));
    formData.append('anioHasta', String(product.vehicleYear));
    formData.append('motor', product.vehicleVersion);
    formData.append('precio', String(product.price));
    formData.append('stock', String(product.stock));
    formData.append('descripcion', product.description || '');
    formData.append('condicion', 'NUEVO');
    formData.append('activo', 'true');
    formData.append('imagenes', imageFile);

    response = await fetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/personalizado`, {
      method: 'POST',
      headers,
      body: formData
    });
  } else {
    // Use standard JSON endpoint
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
      anioHasta: product.vehicleYear,
      motor: product.vehicleVersion,
      precio: product.price,
      stock: product.stock,
      descripcion: product.description || '',
      condicion: 'NUEVO',
      activo: true
    };

    response = await fetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  }

  if (!response.ok) {
    let errMsg = 'Error al registrar el producto en el servidor.';
    try {
      const errData = await response.json();
      if (errData && errData.message) {
        errMsg = errData.message;
      }
    } catch (e) {
      // ignore
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  return mapDtoToProduct(data);
}

export async function updateProduct(
  product: Product,
  imageFile?: File | Blob | null
): Promise<Product> {
  const session = getSession();
  if (!session) throw new Error('No hay sesión activa.');

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${session.token}`
  };

  let response: Response;

  if (imageFile) {
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
    formData.append('anioHasta', String(product.vehicleYear));
    formData.append('motor', product.vehicleVersion);
    formData.append('precio', String(product.price));
    formData.append('stock', String(product.stock));
    formData.append('descripcion', product.description || '');
    formData.append('condicion', 'NUEVO');
    formData.append('activo', 'true');
    formData.append('imagenes', imageFile);

    response = await fetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/${product.id}/editar`, {
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
      anioHasta: product.vehicleYear,
      motor: product.vehicleVersion,
      precio: product.price,
      stock: product.stock,
      descripcion: product.description || '',
      condicion: 'NUEVO',
      activo: true
    };

    response = await fetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/${product.id}`, {
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
    } catch (e) {
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

  const response = await fetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/${id}`, {
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
  const response = await fetch(`${API_BASE_URL}/api/v1/proveedores/${session.sellerId}/inventario/${id}/${action}`, {
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
  productsData: (Omit<Product, 'id' | 'lastUpdated'> & { imageFile?: File | Blob | null })[],
  overwriteExisting: boolean = true,
  onProgress?: (percent: number) => void
): Promise<BatchResult> {
  const result: BatchResult = {
    success: [],
    errors: [],
  };

  let allProds: Product[] = [];
  try {
    allProds = await getAllProducts();
  } catch (e) {
    // ignore
  }

  let completedCount = 0;
  const totalCount = productsData.length;

  const batchSize = 3;
  for (let i = 0; i < productsData.length; i += batchSize) {
    const chunk = productsData.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async (prodData, offset) => {
        const rowNumber = i + offset + 2; // Row 1 is header
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
        } catch (err: any) {
          result.errors.push({
            row: rowNumber,
            sku: prodData.sku,
            error: err.message || 'Error desconocido al procesar la fila.'
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

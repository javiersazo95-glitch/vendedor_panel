const rawApiBaseUrl = import.meta.env.VITE_API_URL || 
  (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8080'
    : 'https://api.repuestop.cl');

export const API_BASE_URL = rawApiBaseUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');

/**
 * Resolves a given image URI.
 * - For Google Drive links, extracts the file ID and rewrites it to use the backend proxy.
 * - For relative paths starting with '/', prepends the API base URL.
 * - For base64, blob, and external URLs, returns them as-is.
 */
export function resolveImageUri(uri: string | undefined): string {
  if (!uri) return '';
  
  // Return base64 data URIs or local object URLs as-is
  if (uri.startsWith('data:') || uri.startsWith('blob:')) {
    return uri;
  }

  // Google Drive URI resolution
  if (uri.includes('drive.google.com')) {
    let fileId = '';
    try {
      const urlObj = new URL(uri);
      const idParam = urlObj.searchParams.get('id');
      if (idParam) {
        fileId = idParam;
      } else {
        const pathMatch = urlObj.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (pathMatch && pathMatch[1]) {
          fileId = pathMatch[1];
        }
      }
    } catch (e) {
      // Fallback regex if URL parsing fails (e.g. invalid URL strings)
      const idMatch = uri.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (idMatch && idMatch[1]) {
        fileId = idMatch[1];
      } else {
        const pathMatch = uri.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (pathMatch && pathMatch[1]) {
          fileId = pathMatch[1];
        }
      }
    }

    if (fileId) {
      return `${API_BASE_URL}/api/v1/uploads/drive/${fileId}`;
    }
  }

  // Relative path resolution
  if (uri.startsWith('/')) {
    return `${API_BASE_URL}${uri}`;
  }

  // Return any other valid URLs (e.g. Unsplash, external CDN links) as-is
  return uri;
}

/**
 * Uploads a product image to the backend Spring Boot storage endpoint.
 * Sends the file as multipart/form-data.
 * Returns the resolved relative proxy URL (e.g. /api/v1/uploads/drive/1CtTHNT...).
 */
export async function uploadProductImage(file: Blob | File, filename: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', file, filename);

  const response = await fetch(`${API_BASE_URL}/api/v1/proveedores/productos/imagenes`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Error de subida: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  let relativePath = '';

  if (typeof data === 'string') {
    relativePath = data;
  } else if (data && typeof data === 'object') {
    // Check multiple possible key fields returned by backend
    const possibleKeys = ['documentoUrl', 'imageUrl', 'url', 'path', 'fileId', 'id'];
    for (const key of possibleKeys) {
      if (data[key]) {
        relativePath = data[key];
        break;
      }
    }
  }

  // Format fileId to standard proxy URL path if only ID was returned
  if (relativePath && !relativePath.startsWith('/') && !relativePath.startsWith('http')) {
    relativePath = `/api/v1/uploads/drive/${relativePath}`;
  }

  if (!relativePath) {
    throw new Error('La respuesta del servidor no contiene una ruta de imagen válida.');
  }

  return relativePath;
}

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

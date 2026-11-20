import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const TOKEN_STORAGE_KEY = 'accas_access_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000,
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const reqUrl = String(config.url || '');
  if (
    reqUrl.includes('/datasets/upload') ||
    reqUrl.includes('/analyses') ||
    reqUrl.includes('/reports/')
  ) {
    config.timeout = 0;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      const url = String(error.config?.url || '');
      if (!url.includes('/auth/login') && !url.includes('/auth/register')) {
        clearStoredToken();
        if (window.location.pathname !== '/login') {
          window.location.assign('/login');
        }
      }
    }
    return Promise.reject(error);
  }
);

export function extractErrorMessage(err: unknown, fallback = 'Request failed.'): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail || err.response?.data?.message;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export async function downloadAuthorizedFile(url: string, fallbackFilename: string): Promise<void> {
  const response = await api.get(url, { responseType: 'blob' });
  const disposition = response.headers['content-disposition'] as string | undefined;
  let filename = fallbackFilename;
  if (disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/i);
    if (match?.[1]) filename = match[1];
  }
  const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

export default api;

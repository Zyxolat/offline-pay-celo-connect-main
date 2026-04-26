import { clearSession, getStoredToken, type SessionScope } from '@/lib/auth';
import { getApiBaseUrl } from '@/config/env';
import axios from 'axios';

const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

const getRequestSessionScope = (requestUrl: string, pathname: string): SessionScope => {
  if (requestUrl.includes('/admin/')) {
    return 'admin';
  }

  if (requestUrl.includes('/auth/logout')) {
    return pathname.startsWith('/admin') ? 'admin' : 'user';
  }

  return 'user';
};

api.interceptors.request.use((config) => {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const requestUrl = String(config.url || '');
  const token = getStoredToken(getRequestSessionScope(requestUrl, pathname));

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = String(error.config?.url || '');
    const isAuthEndpoint = /\/auth(\/|$)/.test(requestUrl);
    const path = typeof window !== 'undefined' ? window.location.pathname : '/';
    const requestScope = getRequestSessionScope(requestUrl, path);

    if (typeof error.response?.data?.error === 'string' && !error.message) {
      error.message = error.response.data.error;
    }

    if (!error.response && error.code === 'ERR_NETWORK') {
      error.message = `Cannot reach the API server at ${API_BASE_URL}.`;
    }

    if (error.response?.status === 401) {
      const isAdminRoute = path.startsWith('/admin');
      const isAdminApi = requestUrl.includes('/admin/');

      if (!isAuthEndpoint) {
        clearSession(requestScope);
      }

      if ((isAdminRoute || isAdminApi) && !isAuthEndpoint) {
        window.location.href = '/auth/login';
      } else if (!isAuthEndpoint) {
        window.location.href = '/auth/login';
      }
    }

    if (error.response?.status === 403) {
      const isAdminRoute = path.startsWith('/admin');
      const isAdminApi = String(error.config?.url || '').includes('/admin/');

      if (isAdminRoute || isAdminApi) {
        clearSession('admin');
        window.location.href = '/auth/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;

import { clearSession } from '@/lib/auth';
import { getApiBaseUrl } from '@/config/env';
import axios from 'axios';

const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('sessionToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('[api] Request failed', {
      method: error.config?.method,
      url: error.config?.url,
      baseURL: error.config?.baseURL,
      status: error.response?.status,
      message: error.message,
      data: error.response?.data,
    });

    if (!error.response && error.code === 'ERR_NETWORK') {
      error.message = `Cannot reach the API server at ${API_BASE_URL}.`;
    }

    if (error.response?.status === 401) {
      const path = window.location.pathname;
      const isAdminRoute = path.startsWith('/admin');
      const isAdminApi = String(error.config?.url || '').includes('/admin/');
      const isAuthLogin = String(error.config?.url || '').includes('/auth/login');
      const isAdminLogin = String(error.config?.url || '').includes('/auth/admin/login');

      if (!isAuthLogin && !isAdminLogin) {
        clearSession();
      }

      if (isAdminRoute || isAdminApi) {
        window.location.href = '/auth/login';
      } else if (!isAuthLogin && !isAdminLogin) {
        window.location.href = '/auth/login';
      }
    }

    if (error.response?.status === 403) {
      const path = window.location.pathname;
      const isAdminRoute = path.startsWith('/admin');
      const isAdminApi = String(error.config?.url || '').includes('/admin/');

      if (isAdminRoute || isAdminApi) {
        clearSession();
        window.location.href = '/auth/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;

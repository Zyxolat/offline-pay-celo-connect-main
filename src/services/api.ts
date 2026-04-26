import { clearSession, getStoredToken } from '@/lib/auth';
import { getApiBaseUrl } from '@/config/env';
import axios from 'axios';

const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
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

    if (typeof error.response?.data?.error === 'string' && !error.message) {
      error.message = error.response.data.error;
    }

    if (!error.response && error.code === 'ERR_NETWORK') {
      error.message = `Cannot reach the API server at ${API_BASE_URL}.`;
    }

    if (error.response?.status === 401) {
      const path = window.location.pathname;
      const isAdminRoute = path.startsWith('/admin');
      const isAdminApi = requestUrl.includes('/admin/');

      if (!isAuthEndpoint) {
        clearSession();
      }

      if ((isAdminRoute || isAdminApi) && !isAuthEndpoint) {
        window.location.href = '/auth/login';
      } else if (!isAuthEndpoint) {
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

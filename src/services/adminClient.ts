import api from './api';

const withAdminApiLogging = async <T>(label: string, request: Promise<T>) => {
  try {
    return await request;
  } catch (error) {
    console.error(`[adminAPI] ${label} failed`, error);
    throw error;
  }
};

export const adminAPI = {
  getStats: () => withAdminApiLogging('getStats', api.get('/admin/stats')),
  getUsers: (page = 1, limit = 50) =>
    withAdminApiLogging('getUsers', api.get('/admin/users', { params: { page, limit } })),
  getTransactions: (page = 1, limit = 50) =>
    withAdminApiLogging('getTransactions', api.get('/admin/transactions', { params: { page, limit } })),
  getWallets: (page = 1, limit = 50) =>
    withAdminApiLogging('getWallets', api.get('/admin/wallets', { params: { page, limit } })),
};

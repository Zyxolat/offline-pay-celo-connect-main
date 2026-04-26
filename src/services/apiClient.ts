import api from './api.js';

const withApiErrorLogging = async <T>(label: string, request: Promise<T>) => {
  try {
    return await request;
  } catch (error) {
    if (typeof (error as { response?: { data?: { error?: string } } }).response?.data?.error === 'string') {
      (error as { message?: string }).message = (error as { response: { data: { error: string } } }).response.data.error;
    }

    throw error;
  }
};

export const authAPI = {
  register: (email: string, password: string) =>
    withApiErrorLogging('register', api.post('/auth/register', { email, password })),
  adminLogin: (email: string, password: string) =>
    withApiErrorLogging('adminLogin', api.post('/auth/admin/login', { email, password })),
  login: (email: string, password: string) =>
    withApiErrorLogging('login', api.post('/auth/login', { email, password })),
  beginPasskeyRegistration: (email: string) =>
    withApiErrorLogging('beginPasskeyRegistration', api.post('/auth/webauthn/register/options', { email })),
  completePasskeyRegistration: (email: string, challengeId: string, credential: unknown) =>
    withApiErrorLogging(
      'completePasskeyRegistration',
      api.post('/auth/webauthn/register/verify', { email, challengeId, credential }),
    ),
  beginPasskeyLogin: (email: string) =>
    withApiErrorLogging('beginPasskeyLogin', api.post('/auth/webauthn/login/options', { email })),
  completePasskeyLogin: (email: string, challengeId: string, credential: unknown) =>
    withApiErrorLogging(
      'completePasskeyLogin',
      api.post('/auth/webauthn/login/verify', { email, challengeId, credential }),
    ),
  logout: () => withApiErrorLogging('logout', api.post('/auth/logout')),
};

export const walletAPI = {
  getBalance: () => withApiErrorLogging('getBalance', api.get('/wallet/balance')),
  
  getAddress: () => withApiErrorLogging('getAddress', api.get('/wallet/address')),
  
  getTransactions: (limit = 50, offset = 0) =>
    withApiErrorLogging('getTransactions', api.get('/wallet/transactions', { params: { limit, offset } })),

  syncTransaction: (payload: {
    txHash: string;
    recipient?: string;
    amount?: string;
    currency?: string;
    status?: 'submitted' | 'pending' | 'confirmed' | 'failed';
    confirmations?: number;
    note?: string;
  }) => withApiErrorLogging('syncTransaction', api.post('/wallet/transactions/sync', payload)),

  withdraw: (destinationAddress: string, token: 'CELO' | 'cUSD', amount: string) =>
    withApiErrorLogging('withdraw', api.post('/wallet/withdraw', { destinationAddress, token, amount })),
};

export const paymentAPI = {
  authorizeChallenge: (recipient: string, amount: string, currency: string, note?: string) =>
    withApiErrorLogging(
      'authorizeChallenge',
      api.post('/payments/authorize/challenge', { recipient, amount, currency, note })
    ),
  
  authorizeVerify: (paymentId: string, credentialId: string, response: any) =>
    withApiErrorLogging(
      'authorizeVerify',
      api.post('/payments/authorize/verify', { paymentId, credentialId, response })
    ),
  
  submitPayment: (paymentId: string, signedTx: string, offline = false) =>
    withApiErrorLogging('submitPayment', api.post('/payments/submit', { paymentId, signedTx, offline })),
};

export const queueAPI = {
  addToQueue: (recipient: string, amount: string, currency: string, signedTx: string, note?: string) =>
    withApiErrorLogging(
      'addToQueue',
      api.post('/queue/add', { recipient, amount, currency, signedTx, note, timestamp: new Date() })
    ),
  
  getPending: () => withApiErrorLogging('getPending', api.get('/queue/pending')),
  
  sync: (queueIds?: string[]) => 
    withApiErrorLogging('syncQueue', api.post('/queue/sync', { queueIds })),
};

export const transactionAPI = {
  getDetail: (txId: string) => withApiErrorLogging('getDetail', api.get(`/transactions/${txId}`)),
  
  getStatusBatch: (txHashes: string[]) =>
    withApiErrorLogging('getStatusBatch', api.get('/transactions/status/batch', { params: { txHashes } })),
};

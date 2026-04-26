export type AppRole = 'admin' | 'user';

export interface SessionUser {
  id: string;
  email: string;
  role: AppRole;
  isAdmin?: boolean;
  walletAddress?: string;
  authMethod?: 'google' | 'passkey' | 'password' | 'admin';
}

type BrowserStorageMode = 'local' | 'session';

const memorySession = {
  sessionToken: null as string | null,
  user: null as string | null,
};

function getBrowserStorage(mode: BrowserStorageMode): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return mode === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

const getAllStorages = () =>
  [getBrowserStorage('local'), getBrowserStorage('session')].filter(Boolean) as Storage[];

const clearSessionStorage = (storage: Storage) => {
  try {
    storage.removeItem('sessionToken');
    storage.removeItem('user');
  } catch {
    // Ignore storage cleanup failures and continue with in-memory session state.
  }
};

export const getStoredToken = () => {
  for (const storage of getAllStorages()) {
    const token = storage.getItem('sessionToken');
    if (token) {
      return token;
    }
  }

  return memorySession.sessionToken;
};

export const getStoredUser = (): SessionUser | null => {
  for (const storage of getAllStorages()) {
    const raw = storage.getItem('user');
    if (!raw) {
      continue;
    }

    try {
      return JSON.parse(raw) as SessionUser;
    } catch {
      clearSessionStorage(storage);
    }
  }

  if (!memorySession.user) {
    return null;
  }

  try {
    return JSON.parse(memorySession.user) as SessionUser;
  } catch {
    memorySession.sessionToken = null;
    memorySession.user = null;
    return null;
  }
};

export const storeSession = (sessionToken: string, user: SessionUser) => {
  memorySession.sessionToken = sessionToken;
  memorySession.user = JSON.stringify(user);

  const storages = getAllStorages();
  for (const storage of storages) {
    try {
      storage.setItem('sessionToken', sessionToken);
      storage.setItem('user', JSON.stringify(user));
    } catch {
      // Ignore persistence failures and continue with in-memory session state.
    }
  }
};

export const hasValidStoredAdminSession = () => {
  const token = getStoredToken();
  const user = getStoredUser();

  return Boolean(token && isAdminUser(user));
};

export const hasStoredSession = () => Boolean(getStoredToken() && getStoredUser());

export const clearSession = () => {
  memorySession.sessionToken = null;
  memorySession.user = null;

  const storages = getAllStorages();
  if (storages.length === 0) {
    return;
  }

  storages.forEach(clearSessionStorage);
};

export const isAdminUser = (user: SessionUser | null) =>
  Boolean(user && (user.role === 'admin' || user.isAdmin));

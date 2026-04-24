export type AppRole = 'admin' | 'user';

export interface SessionUser {
  id: string;
  email: string;
  role: AppRole;
  isAdmin?: boolean;
  walletAddress?: string;
  authMethod?: 'google' | 'passkey' | 'admin';
}

type BrowserStorageMode = 'local' | 'session';

function getBrowserStorage(mode: BrowserStorageMode): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return mode === 'local' ? window.localStorage : window.sessionStorage;
  } catch (error) {
    console.error(`[auth] ${mode} storage is unavailable.`, error);
    return null;
  }
}

const getAllStorages = () =>
  [getBrowserStorage('local'), getBrowserStorage('session')].filter(Boolean) as Storage[];

const clearSessionStorage = (storage: Storage) => {
  try {
    storage.removeItem('sessionToken');
    storage.removeItem('user');
  } catch (error) {
    console.error('[auth] Failed to clear session.', error);
  }
};

export const getStoredToken = () => {
  for (const storage of getAllStorages()) {
    const token = storage.getItem('sessionToken');
    if (token) {
      return token;
    }
  }

  return null;
};

export const getStoredUser = (): SessionUser | null => {
  for (const storage of getAllStorages()) {
    const raw = storage.getItem('user');
    if (!raw) {
      continue;
    }

    try {
      return JSON.parse(raw) as SessionUser;
    } catch (error) {
      console.error('[auth] Failed to parse stored user session. Clearing invalid session state.', error);
      clearSessionStorage(storage);
    }
  }

  return null;
};

export const storeSession = (sessionToken: string, user: SessionUser) => {
  const storages = getAllStorages();
  if (storages.length === 0) {
    console.error('[auth] Unable to store session because browser storage is unavailable.');
    return;
  }

  for (const storage of storages) {
    try {
      storage.setItem('sessionToken', sessionToken);
      storage.setItem('user', JSON.stringify(user));
    } catch (error) {
      console.error('[auth] Failed to persist session.', error);
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
  const storages = getAllStorages();
  if (storages.length === 0) {
    return;
  }

  storages.forEach(clearSessionStorage);
};

export const isAdminUser = (user: SessionUser | null) =>
  Boolean(user && (user.role === 'admin' || user.isAdmin));

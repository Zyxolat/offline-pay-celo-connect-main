export type AppRole = 'admin' | 'user';

export interface SessionUser {
  id: string;
  email: string;
  role: AppRole;
  isAdmin?: boolean;
  walletAddress?: string;
  authMethod?: 'google' | 'passkey' | 'admin';
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch (error) {
    console.error('[auth] Session storage is unavailable.', error);
    return null;
  }
}

const clearSessionStorage = (storage: Storage) => {
  try {
    storage.removeItem('sessionToken');
    storage.removeItem('user');
  } catch (error) {
    console.error('[auth] Failed to clear session.', error);
  }
};

export const getStoredToken = () => getSessionStorage()?.getItem('sessionToken') ?? null;

export const getStoredUser = (): SessionUser | null => {
  const storage = getSessionStorage();
  const raw = storage?.getItem('user');
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionUser;
  } catch (error) {
    console.error('[auth] Failed to parse stored user session. Clearing invalid session state.', error);
    if (storage) {
      clearSessionStorage(storage);
    }
    return null;
  }
};

export const storeSession = (sessionToken: string, user: SessionUser) => {
  const storage = getSessionStorage();
  if (!storage) {
    console.error('[auth] Unable to store session because session storage is unavailable.');
    return;
  }

  try {
    storage.setItem('sessionToken', sessionToken);
    storage.setItem('user', JSON.stringify(user));
  } catch (error) {
    console.error('[auth] Failed to persist session.', error);
  }
};

export const hasValidStoredAdminSession = () => {
  const token = getStoredToken();
  const user = getStoredUser();

  return Boolean(token && isAdminUser(user));
};

export const hasStoredSession = () => Boolean(getStoredToken() && getStoredUser());

export const clearSession = () => {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  clearSessionStorage(storage);
};

export const isAdminUser = (user: SessionUser | null) =>
  Boolean(user && (user.role === 'admin' || user.isAdmin));

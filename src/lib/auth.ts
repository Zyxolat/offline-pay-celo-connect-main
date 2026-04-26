export type AppRole = 'admin' | 'user';
export type SessionScope = 'admin' | 'user';

export interface SessionUser {
  id: string;
  email: string;
  role: AppRole;
  isAdmin?: boolean;
  walletAddress?: string;
  authMethod?: 'google' | 'passkey' | 'password' | 'admin';
}

type BrowserStorageMode = 'local' | 'session';

const SESSION_STORAGE_KEYS: Record<SessionScope, { token: string; user: string }> = {
  admin: {
    token: 'offlinepay.admin.sessionToken',
    user: 'offlinepay.admin.user',
  },
  user: {
    token: 'offlinepay.user.sessionToken',
    user: 'offlinepay.user.user',
  },
};

const LEGACY_SESSION_STORAGE_KEYS = {
  token: 'sessionToken',
  user: 'user',
} as const;

const memorySessions: Record<SessionScope, { sessionToken: string | null; user: string | null }> = {
  admin: {
    sessionToken: null,
    user: null,
  },
  user: {
    sessionToken: null,
    user: null,
  },
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

const clearScopedSessionStorage = (storage: Storage, scope: SessionScope) => {
  const keys = SESSION_STORAGE_KEYS[scope];

  try {
    storage.removeItem(keys.token);
    storage.removeItem(keys.user);
  } catch {
    // Ignore storage cleanup failures and continue with in-memory session state.
  }
};

const clearLegacySessionStorage = (storage: Storage) => {
  try {
    storage.removeItem(LEGACY_SESSION_STORAGE_KEYS.token);
    storage.removeItem(LEGACY_SESSION_STORAGE_KEYS.user);
  } catch {
    // Ignore storage cleanup failures and continue with in-memory session state.
  }
};

const parseStoredUser = (raw: string | null): SessionUser | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
};

const getSessionScopeForUser = (user: SessionUser | null): SessionScope | null => {
  if (!user) {
    return null;
  }

  return isAdminUser(user) ? 'admin' : 'user';
};

const getStoredSessionRecord = (scope: SessionScope) => {
  for (const storage of getAllStorages()) {
    const keys = SESSION_STORAGE_KEYS[scope];
    const token = storage.getItem(keys.token);
    const user = parseStoredUser(storage.getItem(keys.user));

    if (!token && !user) {
      continue;
    }

    if (!token || !user) {
      clearScopedSessionStorage(storage, scope);
      continue;
    }

    return {
      sessionToken: token,
      user,
    };
  }

  for (const storage of getAllStorages()) {
    const legacyToken = storage.getItem(LEGACY_SESSION_STORAGE_KEYS.token);
    const legacyUser = parseStoredUser(storage.getItem(LEGACY_SESSION_STORAGE_KEYS.user));

    if (!legacyToken && !legacyUser) {
      continue;
    }

    if (!legacyToken || !legacyUser) {
      clearLegacySessionStorage(storage);
      continue;
    }

    const legacyScope = getSessionScopeForUser(legacyUser);
    if (legacyScope !== scope) {
      continue;
    }

    memorySessions[scope].sessionToken = legacyToken;
    memorySessions[scope].user = JSON.stringify(legacyUser);

    for (const targetStorage of getAllStorages()) {
      clearLegacySessionStorage(targetStorage);
      const keys = SESSION_STORAGE_KEYS[scope];

      try {
        targetStorage.setItem(keys.token, legacyToken);
        targetStorage.setItem(keys.user, JSON.stringify(legacyUser));
      } catch {
        // Ignore persistence failures and continue with in-memory session state.
      }
    }

    return {
      sessionToken: legacyToken,
      user: legacyUser,
    };
  }

  const inMemoryUser = parseStoredUser(memorySessions[scope].user);
  if (!memorySessions[scope].sessionToken || !inMemoryUser) {
    memorySessions[scope].sessionToken = null;
    memorySessions[scope].user = null;
    return null;
  }

  return {
    sessionToken: memorySessions[scope].sessionToken,
    user: inMemoryUser,
  };
};

const getPreferredScopes = (scope?: SessionScope) => (scope ? [scope] : (['user', 'admin'] as const));

export const getStoredToken = (scope?: SessionScope) => {
  for (const currentScope of getPreferredScopes(scope)) {
    const session = getStoredSessionRecord(currentScope);
    if (session?.sessionToken) {
      return session.sessionToken;
    }
  }

  return null;
};

export const getStoredUser = (scope?: SessionScope): SessionUser | null => {
  for (const currentScope of getPreferredScopes(scope)) {
    const session = getStoredSessionRecord(currentScope);
    if (session?.user) {
      return session.user;
    }
  }

  return null;
};

export const storeSession = (sessionToken: string, user: SessionUser) => {
  const scope = getSessionScopeForUser(user);
  if (!scope) {
    return;
  }

  memorySessions[scope].sessionToken = sessionToken;
  memorySessions[scope].user = JSON.stringify(user);

  const keys = SESSION_STORAGE_KEYS[scope];
  for (const storage of getAllStorages()) {
    clearScopedSessionStorage(storage, scope);
    clearLegacySessionStorage(storage);

    try {
      storage.setItem(keys.token, sessionToken);
      storage.setItem(keys.user, JSON.stringify(user));
    } catch {
      // Ignore persistence failures and continue with in-memory session state.
    }
  }
};

export const hasValidStoredAdminSession = () => {
  const token = getStoredToken('admin');
  const user = getStoredUser('admin');

  return Boolean(token && isAdminUser(user));
};

export const hasStoredSession = (scope?: SessionScope) => Boolean(getStoredToken(scope) && getStoredUser(scope));

export const clearSession = (scope?: SessionScope) => {
  const scopes = scope ? [scope] : (['user', 'admin'] as const);

  scopes.forEach((currentScope) => {
    memorySessions[currentScope].sessionToken = null;
    memorySessions[currentScope].user = null;
  });

  const storages = getAllStorages();
  if (storages.length === 0) {
    return;
  }

  storages.forEach((storage) => {
    scopes.forEach((currentScope) => {
      clearScopedSessionStorage(storage, currentScope);
    });

    if (!scope) {
      clearLegacySessionStorage(storage);
    }
  });
};

export const isAdminUser = (user: SessionUser | null) =>
  Boolean(user && (user.role === 'admin' || user.isAdmin));

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSession,
  getStoredToken,
  getStoredUser,
  hasStoredSession,
  storeSession,
  type SessionUser,
} from '@/lib/auth';

const userSession: SessionUser = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'user',
  authMethod: 'password',
};

const adminSession: SessionUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'admin',
  isAdmin: true,
  authMethod: 'admin',
};

describe('auth storage isolation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    clearSession();
  });

  it('stores admin and user sessions independently', () => {
    storeSession('user-token', userSession);
    storeSession('admin-token', adminSession);

    expect(getStoredToken('user')).toBe('user-token');
    expect(getStoredUser('user')).toEqual(userSession);
    expect(getStoredToken('admin')).toBe('admin-token');
    expect(getStoredUser('admin')).toEqual(adminSession);
  });

  it('does not treat an admin session as a valid user session', () => {
    storeSession('admin-token', adminSession);

    expect(hasStoredSession('user')).toBe(false);
    expect(getStoredToken('user')).toBeNull();
    expect(getStoredUser('user')).toBeNull();
    expect(hasStoredSession('admin')).toBe(true);
  });

  it('migrates legacy shared storage into the matching scoped session', () => {
    window.localStorage.setItem('sessionToken', 'legacy-user-token');
    window.localStorage.setItem('user', JSON.stringify(userSession));

    expect(getStoredToken('user')).toBe('legacy-user-token');
    expect(getStoredUser('user')).toEqual(userSession);
    expect(window.localStorage.getItem('sessionToken')).toBeNull();
    expect(window.localStorage.getItem('offlinepay.user.sessionToken')).toBe('legacy-user-token');
  });

  it('clears only the requested session scope', () => {
    storeSession('user-token', userSession);
    storeSession('admin-token', adminSession);

    clearSession('user');

    expect(hasStoredSession('user')).toBe(false);
    expect(hasStoredSession('admin')).toBe(true);
    expect(getStoredToken('admin')).toBe('admin-token');
  });
});

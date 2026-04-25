import 'express';

type AuthenticatedRequestUser = {
  userId: string;
  email: string;
  role: 'admin' | 'user';
  authMethod: 'google' | 'passkey' | 'password' | 'admin';
  isAdmin: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedRequestUser;
    }
  }
}

export {};

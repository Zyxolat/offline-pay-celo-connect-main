import jwt from 'jsonwebtoken';
import { config } from '../config/index';
import { normalizeError } from '../utils/logger';

export interface TokenPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
  authMethod: 'google' | 'passkey' | 'password' | 'admin';
  iat?: number;
  exp?: number;
}

export type TokenVerificationResult =
  | { valid: true; payload: TokenPayload }
  | { valid: false; reason: 'expired' | 'invalid' };

export const tokenService = {
  generateToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload as object, config.jwt.secret as string, {
      expiresIn: config.jwt.expiry,
    } as jwt.SignOptions);
  },

  verifyToken(token: string): TokenPayload | null {
    const result = this.verifyTokenDetailed(token);
    return result.valid ? result.payload : null;
  },

  verifyTokenDetailed(token: string): TokenVerificationResult {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as TokenPayload;
      return {
        valid: true,
        payload: decoded,
      };
    } catch (error) {
      console.error('Token verification failed:', normalizeError(error));

      if (error instanceof jwt.TokenExpiredError) {
        return {
          valid: false,
          reason: 'expired',
        };
      }

      return {
        valid: false,
        reason: 'invalid',
      };
    }
  },

  parseAuthHeader(authHeader?: string): string | null {
    if (!authHeader) {
      return null;
    }

    const [scheme, token] = authHeader.trim().split(/\s+/, 2);
    if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
      return null;
    }

    return token.trim() || null;
  },
};

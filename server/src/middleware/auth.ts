import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { AuthSessionModel } from '../models/AuthSession.js';
import { tokenService } from '../services/tokenService.js';

const normalizeIp = (value?: string | null) => value?.replace(/^::ffff:/, '') ?? '';

const respondUnauthorized = (res: Response, reason: 'missing' | 'expired' | 'invalid' | 'session') => {
  const messageByReason = {
    missing: 'Unauthorized: Missing token',
    expired: 'Unauthorized: Token expired',
    invalid: 'Unauthorized: Invalid token',
    session: 'Unauthorized: Session expired',
  } as const;

  return res.status(401).json({ error: messageByReason[reason] });
};

const authenticateRequest = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = tokenService.parseAuthHeader(authHeader);

    if (!token) {
      respondUnauthorized(res, 'missing');
      return null;
    }

    const verification = tokenService.verifyTokenDetailed(token);
    if (!verification.valid) {
      respondUnauthorized(res, verification.reason);
      return null;
    }

    const session = await AuthSessionModel.findActiveSession(token);
    if (!session) {
      respondUnauthorized(res, 'session');
      return null;
    }

    const payload = verification.payload;

    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      authMethod: payload.authMethod,
      isAdmin: payload.role === 'admin',
    };

    await AuthSessionModel.touch(token);

    return {
      payload,
      session,
      token,
    };
  } catch {
    respondUnauthorized(res, 'invalid');
    return null;
  }
};

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const authenticated = await authenticateRequest(req, res);
  if (!authenticated) {
    return;
  }

  next();
};

export const requireAdminAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authenticated = await authenticateRequest(req, res);
  if (!authenticated) {
    return;
  }

  const { payload, session } = authenticated;

  if (payload.email !== config.admin.email || payload.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const allowedIps = config.admin.allowedIps.map((ip) => normalizeIp(ip));
  const requestIp = normalizeIp(req.ip);
  if (allowedIps.length > 0 && !allowedIps.includes(requestIp)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!session || !session.is_admin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  req.user = {
    userId: payload.userId,
    email: payload.email,
    role: 'admin',
    authMethod: 'admin',
    isAdmin: true,
  };

  next();
};

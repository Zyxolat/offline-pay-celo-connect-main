import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { AuthSessionModel } from '../models/AuthSession.js';
import { tokenService } from '../services/tokenService.js';

const normalizeIp = (value?: string | null) => value?.replace(/^::ffff:/, '') ?? '';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = tokenService.parseAuthHeader(authHeader);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const payload = tokenService.verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  req.user = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    authMethod: payload.authMethod,
    isAdmin: payload.role === 'admin',
  };

  next();
};

export const requireAdminAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = tokenService.parseAuthHeader(authHeader);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const payload = tokenService.verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  if (payload.email !== config.admin.email || payload.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const allowedIps = config.admin.allowedIps.map((ip) => normalizeIp(ip));
  const requestIp = normalizeIp(req.ip);
  if (allowedIps.length > 0 && !allowedIps.includes(requestIp)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const session = await AuthSessionModel.findActiveSession(token);
  if (!session || !session.is_admin) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  req.user = {
    userId: payload.userId,
    email: payload.email,
    role: 'admin',
    authMethod: 'admin',
    isAdmin: true,
  };

  await AuthSessionModel.touch(token);
  next();
};

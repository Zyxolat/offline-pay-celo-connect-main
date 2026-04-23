import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { AuthSessionModel } from '../models/AuthSession.js';
import { UserModel } from '../models/User.js';
import { tokenService } from '../services/tokenService.js';
import { celoService } from '../services/celoService.js';
import { normalizeError } from '../utils/logger.js';
import { errorResponse, successResponse, validateWithSchema } from '../utils/validators.js';

const adminLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const disabledAuthMessage = 'Unauthorized';

const normalizeIp = (value?: string | null) => value?.replace(/^::ffff:/, '') ?? '';

const assertAdminIpAllowed = (req: Request) => {
  const allowedIps = config.admin.allowedIps.map((ip) => normalizeIp(ip));
  if (allowedIps.length === 0) {
    return true;
  }

  return allowedIps.includes(normalizeIp(req.ip));
};

export const authController = {
  async adminLogin(req: Request, res: Response) {
    try {
      const payload = validateWithSchema(res, adminLoginSchema, req.body);
      if (!payload) {
        return;
      }

      const email = payload.email.trim().toLowerCase();
      if (email !== config.admin.email.toLowerCase()) {
        return errorResponse(res, disabledAuthMessage, 403);
      }

      if (!assertAdminIpAllowed(req)) {
        return errorResponse(res, disabledAuthMessage, 403);
      }

      const passwordMatches = await bcrypt.compare(payload.password, config.admin.passwordHash);
      if (!passwordMatches) {
        return errorResponse(res, disabledAuthMessage, 403);
      }

      const adminUser = await UserModel.ensureSingleAdminAccount(
        config.admin.email,
        celoService.generateWalletAddress()
      );

      const sessionToken = tokenService.generateToken({
        userId: adminUser.id,
        email: adminUser.email,
        role: 'admin',
        authMethod: 'admin',
      });

      await AuthSessionModel.create(sessionToken, {
        userId: adminUser.id,
        isAdmin: true,
        sessionType: 'admin',
      });

      successResponse(res, {
        sessionToken,
        user: {
          id: adminUser.id,
          email: adminUser.email,
          role: 'admin' as const,
          isAdmin: true,
          authMethod: 'admin' as const,
          walletAddress: adminUser.wallet_address,
        },
      });
    } catch (error) {
      console.error('Admin login error:', normalizeError(error));
      errorResponse(res, 'Failed to log in', 500);
    }
  },

  async authDisabled(_req: Request, res: Response) {
    errorResponse(res, disabledAuthMessage, 403);
  },

  async logout(req: Request, res: Response) {
    try {
      const token = tokenService.parseAuthHeader(req.headers.authorization);
      if (token) {
        await AuthSessionModel.revoke(token);
      }
      successResponse(res, { message: 'Logged out successfully' });
    } catch (error) {
      console.error('Logout error:', normalizeError(error));
      errorResponse(res, 'Logout failed', 500);
    }
  },
};

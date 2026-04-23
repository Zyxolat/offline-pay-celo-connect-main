import { Request, Response } from 'express';
import { queueService } from '../services/queueService.js';
import { normalizeError } from '../utils/logger.js';
import { successResponse, errorResponse, validateWithSchema } from '../utils/validators.js';
import { z } from 'zod';

const addToQueueSchema = z.object({
  recipient: z.string().trim().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  amount: z.string().trim().min(1).optional(),
  currency: z.enum(['cUSD', 'CELO']).optional(),
  signedTx: z.string().trim().min(1),
  note: z.string().trim().max(500).optional(),
  timestamp: z.union([z.string(), z.date()]).optional(),
});

const syncQueueSchema = z.object({
  queueIds: z.array(z.string().trim().min(1)).optional(),
});

export const queueController = {
  async addToQueue(req: Request, res: Response) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Unauthorized', 401);
      }

      const payload = validateWithSchema(res, addToQueueSchema, req.body);
      if (!payload) {
        return;
      }
      const { signedTx } = payload;

      const result = await queueService.addToQueue(req.user.userId, signedTx);

      successResponse(res, result, 201);
    } catch (error) {
      const normalizedError = normalizeError(error);
      console.error('Add to queue error:', normalizedError);
      errorResponse(res, `Failed to queue transaction: ${normalizedError.message}`, 400);
    }
  },

  async getPending(req: Request, res: Response) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Unauthorized', 401);
      }

      const result = await queueService.getPendingQueue(req.user.userId);
      successResponse(res, result);
    } catch (error) {
      console.error('Get pending queue error:', normalizeError(error));
      errorResponse(res, 'Failed to fetch pending transactions', 500);
    }
  },

  async sync(req: Request, res: Response) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Unauthorized', 401);
      }

      const payload = validateWithSchema(res, syncQueueSchema, req.body ?? {});
      if (!payload) {
        return;
      }
      const { queueIds } = payload;

      const result = await queueService.syncQueue(req.user.userId, queueIds);
      successResponse(res, result);
    } catch (error) {
      console.error('Sync queue error:', normalizeError(error));
      errorResponse(res, 'Failed to sync transactions', 500);
    }
  },
};

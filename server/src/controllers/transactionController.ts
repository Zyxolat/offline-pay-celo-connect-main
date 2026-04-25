import { Request, Response } from 'express';
import { TransactionModel } from '../models/Transaction';
import { UserModel } from '../models/User';
import { normalizeError } from '../utils/logger';
import { successResponse, errorResponse, validateWithSchema } from '../utils/validators';
import { z } from 'zod';

const transactionDetailParamsSchema = z.object({
  txId: z.string().trim().min(1),
});

const batchStatusQuerySchema = z.object({
  txHashes: z
    .union([z.string().trim().min(1), z.array(z.string().trim().min(1))])
    .optional(),
});

export const transactionController = {
  async getDetail(req: Request, res: Response) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Unauthorized', 401);
      }

      const params = validateWithSchema(res, transactionDetailParamsSchema, req.params);
      if (!params) {
        return;
      }
      const { txId } = params;

      const tx = await TransactionModel.findById(txId);
      if (!tx || tx.user_id !== req.user.userId) {
        return errorResponse(res, 'Transaction not found', 404);
      }

      const user = await UserModel.findById(req.user.userId);
      if (!user) {
        return errorResponse(res, 'User not found', 404);
      }

      successResponse(res, {
        id: tx.id,
        status: tx.status,
        from: user.wallet_address,
        to: tx.recipient,
        amount: tx.amount,
        currency: tx.currency,
        txHash: tx.tx_hash,
        timestamp: tx.created_at,
        submittedAt: tx.submitted_at,
        confirmedAt: tx.confirmed_at,
        confirmations: tx.confirmations,
        note: tx.note,
      });
    } catch (error) {
      console.error('Get transaction detail error:', normalizeError(error));
      errorResponse(res, 'Failed to fetch transaction', 500);
    }
  },

  async getStatusBatch(req: Request, res: Response) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Unauthorized', 401);
      }

      const query = validateWithSchema(res, batchStatusQuerySchema, req.query);
      if (!query) {
        return;
      }
      const { txHashes } = query;
      const hashes = Array.isArray(txHashes) ? txHashes : (txHashes ? [txHashes] : []);

      const results = [];

      for (const hash of hashes) {
        const tx = await TransactionModel.findByTxHash(hash as string);
        if (tx && tx.user_id === req.user.userId) {
          results.push({
            txHash: hash,
            status: tx.status,
            confirmations: tx.confirmations,
          });
        }
      }

      successResponse(res, { transactions: results });
    } catch (error) {
      console.error('Get batch status error:', normalizeError(error));
      errorResponse(res, 'Failed to fetch transaction status', 500);
    }
  },
};

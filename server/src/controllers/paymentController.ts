import { Request, Response } from 'express';
import { transactionService } from '../services/transactionService';
import { ChallengeModel } from '../models/Challenge';
import { celoService } from '../services/celoService';
import { normalizeError } from '../utils/logger';
import {
  successResponse,
  errorResponse,
  validateWithSchema,
} from '../utils/validators';
import { randomBytes } from 'crypto';
import { z } from 'zod';

const authorizeChallengeSchema = z.object({
  recipient: z.string().trim().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().trim().refine((value) => !Number.isNaN(Number(value)) && Number(value) > 0),
  currency: z.enum(['cUSD', 'CELO']),
  note: z.string().trim().max(500).optional(),
});

const authorizeVerifySchema = z.object({
  paymentId: z.string().trim().min(1),
  credentialId: z.string().trim().min(1),
  response: z.unknown(),
});

const submitPaymentSchema = z.object({
  paymentId: z.string().trim().min(1),
  signedTx: z.string().trim().min(1),
  offline: z.boolean().optional(),
});

export const paymentController = {
  async authorizeChallenge(req: Request, res: Response) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Unauthorized', 401);
      }

      const payload = validateWithSchema(res, authorizeChallengeSchema, req.body);
      if (!payload) {
        return;
      }
      const { recipient, amount, currency, note } = payload;

      // Create payment record
      const payment = await transactionService.createPayment(
        req.user.userId,
        recipient,
        amount,
        currency,
        note
      );

      // Generate challenge
      const challenge = randomBytes(32);
      await ChallengeModel.create(challenge, 'payment', req.user.userId, payment.id);

      // Estimate fee
      const estimatedFee = await celoService.estimateGasFee();

      successResponse(res, {
        challenge: challenge.toString('base64'),
        paymentId: payment.id,
        timeout: 60000,
        details: {
          recipient,
          amount,
          currency,
          estimatedFee,
        },
      });
    } catch (error) {
      const normalizedError = normalizeError(error);
      console.error('Authorize challenge error:', normalizedError);
      errorResponse(res, `Failed to authorize payment: ${normalizedError.message}`, 400);
    }
  },

  async authorizeVerify(req: Request, res: Response) {
    try {
      const payload = validateWithSchema(res, authorizeVerifySchema, req.body);
      if (!payload) {
        return;
      }
      const { paymentId, credentialId, response } = payload;

      // Verify challenge exists and hasn't expired
      // In production, would verify the WebAuthn response here
      const challenge = await ChallengeModel.findActivePaymentChallenge(paymentId);
      if (!challenge) {
        return errorResponse(res, 'Challenge not found or expired', 400);
      }

      await ChallengeModel.delete(challenge.id);

      // Authorization successful
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      successResponse(res, {
        success: true,
        paymentId,
        authorized: true,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      console.error('Authorize verify error:', normalizeError(error));
      errorResponse(res, 'Failed to verify authorization', 400);
    }
  },

  async submitPayment(req: Request, res: Response) {
    try {
      if (!req.user) {
        return errorResponse(res, 'Unauthorized', 401);
      }

      const payload = validateWithSchema(res, submitPaymentSchema, req.body);
      if (!payload) {
        return;
      }
      const { paymentId, signedTx, offline } = payload;

      if (offline) {
        // Queue the transaction for later sync
        successResponse(
          res,
          {
            queueId: paymentId,
            status: 'pending_sync',
            message: 'Transaction queued. Will sync when online.',
          },
          202
        );
      } else {
        // Submit immediately
        const result = await transactionService.submitTransaction(req.user.userId, paymentId, signedTx);

        successResponse(res, result);
      }
    } catch (error) {
      const normalizedError = normalizeError(error);
      console.error('Submit payment error:', normalizedError);
      errorResponse(res, `Failed to submit payment: ${normalizedError.message}`, 400);
    }
  },
};

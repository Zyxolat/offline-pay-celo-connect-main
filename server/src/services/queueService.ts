import { OfflineQueueModel } from '../models/OfflineQueue';
import { TransactionModel } from '../models/Transaction';
import { celoService } from './celoService';
import { normalizeError } from '../utils/logger';

export const queueService = {
  async addToQueue(userId: string, signedTx: string, transactionId?: string): Promise<any> {
    const queueItem = await OfflineQueueModel.create(userId, signedTx, transactionId);

    return {
      queueId: queueItem.id,
      status: 'pending_sync',
      createdAt: queueItem.created_at,
    };
  },

  async getPendingQueue(userId: string): Promise<any> {
    const items = await OfflineQueueModel.findPendingByUser(userId);
    const count = await OfflineQueueModel.countPendingByUser(userId);

    return {
      pendingCount: count,
      transactions: items.map(item => ({
        queueId: item.id,
        transactionId: item.transaction_id,
        status: 'pending_sync',
        createdAt: item.created_at,
        attempts: item.attempts,
      })),
    };
  },

  async syncQueue(userId: string, queueIds?: string[]): Promise<any> {
    let items = await OfflineQueueModel.findPendingByUser(userId);

    if (queueIds) {
      items = items.filter(item => queueIds.includes(item.id));
    }

    const results = [];
    let synced = 0;
    let failed = 0;

    for (const item of items) {
      try {
        // Verify and submit transaction
        const isValid = await celoService.verifyTransaction(item.signed_tx);
        if (!isValid) {
          throw new Error('Invalid signed transaction');
        }

        const txHash = await celoService.submitTransaction(item.signed_tx);

        // Update queue item
        await OfflineQueueModel.updateStatus(item.id, 'synced', undefined, new Date());

        // Update transaction record if exists
        if (item.transaction_id) {
          await TransactionModel.updateStatus(item.transaction_id, 'submitted', txHash);
        }

        results.push({
          queueId: item.id,
          txHash,
          status: 'submitted',
          syncedAt: new Date(),
        });

        synced++;
      } catch (error) {
        const normalizedError = normalizeError(error);
        failed++;
        await OfflineQueueModel.incrementAttempts(item.id);

        // Mark as failed if too many attempts
        const updatedItem = await OfflineQueueModel.findById(item.id);
        if (updatedItem && updatedItem.attempts >= 3) {
          await OfflineQueueModel.updateStatus(
            item.id,
            'failed',
            `Failed after ${updatedItem.attempts} attempts: ${normalizedError.message}`
          );
        }
      }
    }

    return {
      synced,
      failed,
      transactions: results,
    };
  },
};

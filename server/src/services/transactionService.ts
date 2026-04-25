import type { PoolClient } from 'pg';
import { TransactionModel } from '../models/Transaction';
import { UserModel } from '../models/User';
import { celoService } from './celoService';
import { normalizeError } from '../utils/logger';
import type { TransactionStatus } from '../models/Transaction';

export const transactionService = {
  async createPayment(
    userId: string,
    recipient: string,
    amount: string,
    currency: string,
    note?: string
  ): Promise<any> {
    // Validate user exists
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('User not found');

    // Validate recipient address
    const isValid = await celoService.validateAddress(recipient);
    if (!isValid) throw new Error('Invalid recipient address');

    // Can't send to self
    if (recipient.toLowerCase() === user.wallet_address.toLowerCase()) {
      throw new Error('Cannot send payment to yourself');
    }

    // Create transaction record
    const tx = await TransactionModel.create(userId, recipient, amount, currency, note);

    return {
      id: tx.id,
      status: tx.status,
      recipient: tx.recipient,
      amount: tx.amount,
      currency: tx.currency,
      createdAt: tx.created_at,
    };
  },

  async getTransactionDetails(userId: string, txId: string): Promise<any> {
    const tx = await TransactionModel.findById(txId);
    if (!tx || tx.user_id !== userId) {
      throw new Error('Transaction not found');
    }

    return {
      id: tx.id,
      status: tx.status,
      from: (await UserModel.findById(userId))?.wallet_address,
      to: tx.recipient,
      amount: tx.amount,
      currency: tx.currency,
      txHash: tx.tx_hash,
      timestamp: tx.created_at,
      submittedAt: tx.submitted_at,
      confirmedAt: tx.confirmed_at,
      confirmations: tx.confirmations,
      note: tx.note,
    };
  },

  async submitTransaction(userId: string, txId: string, signedTx: string): Promise<any> {
    const tx = await TransactionModel.findById(txId);
    if (!tx || tx.user_id !== userId) {
      throw new Error('Transaction not found');
    }

    // Verify the signed transaction
    const isValid = await celoService.verifyTransaction(signedTx);
    if (!isValid) throw new Error('Invalid signed transaction');

    try {
      // Submit to blockchain
      const txHash = await celoService.submitTransaction(signedTx);

      // Update transaction record
      const updated = await TransactionModel.updateStatus(txId, 'submitted', txHash, undefined, {
        reason: 'transaction_submitted',
        metadata: { txHash },
      });

      return {
        txHash,
        status: 'submitted',
        confirmations: 0,
      };
    } catch (error) {
      throw new Error(`Failed to submit transaction: ${normalizeError(error).message}`);
    }
  },

  async updateTransactionStatus(txHash: string): Promise<void> {
    const tx = await TransactionModel.findByTxHash(txHash);
    if (!tx) return;

    const statusInfo = await celoService.getTransactionStatus(txHash);
    if (!statusInfo) return;

    const status = statusInfo.status === 'confirmed' ? 'confirmed' : 'failed';
    if (tx.status === status && tx.confirmations === statusInfo.confirmations) {
      return;
    }

    await TransactionModel.updateStatus(tx.id, status as any, undefined, undefined, {
      reason: 'status_reconcile',
      metadata: { txHash },
    });
    await TransactionModel.updateConfirmations(txHash, statusInfo.confirmations);
  },

  async recordContractTransaction(
    userId: string,
    payload: {
      txHash: string;
      recipient: string;
      amount: string;
      currency: string;
      status: Extract<TransactionStatus, 'submitted' | 'pending' | 'confirmed' | 'failed'>;
      confirmations?: number;
      note?: string;
    },
    client?: PoolClient,
  ) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const existing = await TransactionModel.findByTxHash(payload.txHash, client);

    if (existing) {
      const metadataMatches =
        existing.recipient === payload.recipient &&
        existing.amount === payload.amount &&
        existing.currency === payload.currency &&
        (existing.note ?? null) === (payload.note ?? null) &&
        (existing.tx_hash ?? null) === payload.txHash;
      const statusMatches = existing.status === payload.status;
      const confirmationsMatch =
        typeof payload.confirmations !== 'number' || existing.confirmations === payload.confirmations;

      if (metadataMatches && statusMatches && confirmationsMatch) {
        return existing;
      }

      await TransactionModel.updateMetadata(existing.id, {
        recipient: payload.recipient,
        amount: payload.amount,
        currency: payload.currency,
        note: payload.note,
        tx_hash: payload.txHash,
      }, client);

      const updated = await TransactionModel.updateStatus(existing.id, payload.status, payload.txHash, client, {
        reason: 'contract_indexer_replay',
        metadata: {
          txHash: payload.txHash,
          confirmations: payload.confirmations ?? null,
        },
      });

      if (typeof payload.confirmations === 'number') {
        await TransactionModel.updateConfirmations(payload.txHash, payload.confirmations, client);
      }

      return updated;
    }

    const created = await TransactionModel.create(
      userId,
      payload.recipient,
      payload.amount,
      payload.currency,
      payload.note,
      {
        status: payload.status,
        txHash: payload.txHash,
        confirmations: payload.confirmations ?? 0,
      },
      client,
    );

    if (typeof payload.confirmations === 'number') {
      await TransactionModel.updateConfirmations(payload.txHash, payload.confirmations, client);
    }

    return created;
  },

  async reconcileTrackedTransactions(): Promise<void> {
    const unsettledTransactions = await TransactionModel.findByStatuses(['submitted', 'pending', 'pending_sync']);

    await Promise.all(
      unsettledTransactions.map(async (transaction) => {
        if (!transaction.tx_hash) {
          return;
        }

        const statusInfo = await celoService.getTransactionStatus(transaction.tx_hash);
        if (!statusInfo) {
          return;
        }

        const nextStatus = statusInfo.status === 'confirmed' ? 'confirmed' : 'failed';
        if (transaction.status === nextStatus && transaction.confirmations === statusInfo.confirmations) {
          return;
        }

        await TransactionModel.updateStatus(transaction.id, nextStatus, transaction.tx_hash, undefined, {
          reason: 'chain_reconcile',
          metadata: {
            txHash: transaction.tx_hash,
            confirmations: statusInfo.confirmations,
          },
        });
        await TransactionModel.updateConfirmations(transaction.tx_hash, statusInfo.confirmations);
      })
    );
  },

  async rollbackIndexedTransactions(txHashes: string[], client?: PoolClient): Promise<number> {
    return TransactionModel.rollbackByTxHashes([...new Set(txHashes)], client);
  },
};

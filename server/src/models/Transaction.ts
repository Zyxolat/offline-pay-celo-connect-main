import type { PoolClient } from 'pg';
import pool from '../config/database';
import { randomUUID } from 'crypto';
import { TransactionHistoryModel } from './TransactionHistory';

export type TransactionStatus = 'draft' | 'pending_sync' | 'submitted' | 'pending' | 'confirmed' | 'failed';
export type TransactionType = 'send' | 'receive';

export interface Transaction {
  id: string;
  user_id: string;
  recipient: string;
  amount: string;
  currency: string;
  status: TransactionStatus;
  tx_hash?: string;
  signed_tx?: string;
  note?: string;
  created_at: Date;
  updated_at?: Date;
  submitted_at?: Date;
  confirmed_at?: Date;
  confirmations: number;
}

type RecomputedTransactionState = {
  status: TransactionStatus;
  submitted_at: Date | null;
  confirmed_at: Date | null;
  confirmations: number;
};

type Queryable = PoolClient | typeof pool;

function getDb(client?: PoolClient): Queryable {
  return client ?? pool;
}

function deriveFallbackStatus(transaction: Transaction): TransactionStatus {
  if (transaction.signed_tx) {
    return 'submitted';
  }

  if (transaction.tx_hash) {
    return 'pending';
  }

  return 'draft';
}

function buildDerivedState(
  transaction: Transaction,
  nextStatus: TransactionStatus,
  now: Date,
): RecomputedTransactionState {
  return {
    status: nextStatus,
    submitted_at:
      nextStatus === 'submitted' || nextStatus === 'confirmed'
        ? (transaction.submitted_at ?? now)
        : null,
    confirmed_at: nextStatus === 'confirmed' ? (transaction.confirmed_at ?? now) : null,
    confirmations: nextStatus === 'confirmed' ? Math.max(1, transaction.confirmations) : 0,
  };
}

export const TransactionModel = {
  async create(
    userId: string,
    recipient: string,
    amount: string,
    currency: string,
    note?: string,
    options?: {
      status?: TransactionStatus;
      txHash?: string;
      confirmations?: number;
    },
    client?: PoolClient,
  ): Promise<Transaction> {
    const id = randomUUID();
    const now = new Date();
    const status = options?.status ?? 'draft';
    const txHash = options?.txHash ?? null;
    const confirmations = options?.confirmations ?? 0;
    const submittedAt = status === 'submitted' ? now : null;
    const confirmedAt = status === 'confirmed' ? now : null;
    const result = await getDb(client).query(
      `INSERT INTO transactions (
         id, user_id, recipient, amount, currency, status, tx_hash, note,
         created_at, updated_at, submitted_at, confirmed_at, confirmations
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [id, userId, recipient, amount, currency, status, txHash, note || null, now, now, submittedAt, confirmedAt, confirmations]
    );
    await TransactionHistoryModel.record({
      transactionId: id,
      txHash,
      previousStatus: null,
      nextStatus: status,
      reason: options?.txHash ? 'created_from_chain' : 'created',
      metadata: {
        recipient,
        amount,
        currency,
      },
    }, client);
    return result.rows[0];
  },

  async findById(id: string, client?: PoolClient): Promise<Transaction | null> {
    const result = await getDb(client).query('SELECT * FROM transactions WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByUser(userId: string, limit: number = 50, offset: number = 0): Promise<Transaction[]> {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );
    return result.rows;
  },

  async findByTxHash(txHash: string, client?: PoolClient): Promise<Transaction | null> {
    const result = await getDb(client).query('SELECT * FROM transactions WHERE tx_hash = $1', [txHash]);
    return result.rows[0] || null;
  },

  async findByStatuses(statuses: TransactionStatus[]): Promise<Transaction[]> {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE status = ANY($1::text[]) ORDER BY created_at DESC',
      [statuses]
    );
    return result.rows;
  },

  async findByTxHashes(txHashes: string[], client?: PoolClient): Promise<Transaction[]> {
    if (txHashes.length === 0) {
      return [];
    }

    const result = await getDb(client).query(
      'SELECT * FROM transactions WHERE tx_hash = ANY($1::text[]) ORDER BY created_at DESC',
      [txHashes]
    );
    return result.rows;
  },

  async updateStatus(
    id: string,
    status: TransactionStatus,
    txHash?: string,
    client?: PoolClient,
    options?: {
      reason?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Transaction> {
    const existing = await this.findById(id, client);
    if (!existing) {
      throw new Error(`Transaction ${id} not found`);
    }

    if (existing.status === status && (!txHash || existing.tx_hash === txHash)) {
      return existing;
    }

    const updates: Record<string, TransactionStatus | string | Date> = {
      status,
      updated_at: new Date(),
    };
    if (txHash) {
      updates.tx_hash = txHash;
    }
    if (status === 'submitted') {
      updates.submitted_at = new Date();
    } else if (status === 'confirmed') {
      updates.confirmed_at = new Date();
    }

    const fields = Object.keys(updates).map((key, i) => `${key} = $${i + 1}`);
    const values = Object.values(updates);
    values.push(id);

    const result = await getDb(client).query(
      `UPDATE transactions SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    await TransactionHistoryModel.record({
      transactionId: existing.id,
      txHash: txHash ?? existing.tx_hash ?? null,
      previousStatus: existing.status,
      nextStatus: status,
      reason: options?.reason ?? 'status_update',
      metadata: options?.metadata,
    }, client);
    return result.rows[0];
  },

  async updateConfirmations(txHash: string, confirmations: number, client?: PoolClient): Promise<void> {
    await getDb(client).query(
      'UPDATE transactions SET confirmations = $1, updated_at = NOW() WHERE tx_hash = $2 AND confirmations IS DISTINCT FROM $1',
      [confirmations, txHash]
    );
  },

  async updateMetadata(
    id: string,
    fields: Partial<Pick<Transaction, 'recipient' | 'amount' | 'currency' | 'note' | 'tx_hash'>>,
    client?: PoolClient,
  ): Promise<Transaction> {
    const updates: Record<string, string | Date | null> = {
      updated_at: new Date(),
    };

    if (fields.recipient !== undefined) {
      updates.recipient = fields.recipient;
    }
    if (fields.amount !== undefined) {
      updates.amount = fields.amount;
    }
    if (fields.currency !== undefined) {
      updates.currency = fields.currency;
    }
    if (fields.note !== undefined) {
      updates.note = fields.note ?? null;
    }
    if (fields.tx_hash !== undefined) {
      updates.tx_hash = fields.tx_hash ?? null;
    }

    const keys = Object.keys(updates);
    const values = Object.values(updates);
    values.push(id);

    const result = await getDb(client).query(
      `UPDATE transactions SET ${keys.map((key, index) => `${key} = $${index + 1}`).join(', ')}
       WHERE id = $${values.length} RETURNING *`,
      values
    );

    return result.rows[0];
  },

  async rollbackByTxHashes(txHashes: string[], client?: PoolClient): Promise<number> {
    if (txHashes.length === 0) {
      return 0;
    }

    const transactions = await this.findByTxHashes(txHashes, client);
    let updatedCount = 0;

    for (const transaction of transactions) {
      const fallbackStatus = deriveFallbackStatus(transaction);
      const derivedState = buildDerivedState(transaction, fallbackStatus, new Date());

      const result = await getDb(client).query(
        `
          UPDATE transactions
          SET status = $1,
              submitted_at = $2,
              confirmed_at = $3,
              confirmations = $4,
              updated_at = NOW()
          WHERE id = $5
            AND (
              status IS DISTINCT FROM $1 OR
              submitted_at IS DISTINCT FROM $2 OR
              confirmed_at IS DISTINCT FROM $3 OR
              confirmations IS DISTINCT FROM $4
            )
        `,
        [
          derivedState.status,
          derivedState.submitted_at,
          derivedState.confirmed_at,
          derivedState.confirmations,
          transaction.id,
        ]
      );

      if ((result.rowCount ?? 0) > 0) {
        await TransactionHistoryModel.record({
          transactionId: transaction.id,
          txHash: transaction.tx_hash ?? null,
          previousStatus: transaction.status,
          nextStatus: derivedState.status,
          reason: 'reorg_rollback',
          metadata: {
            submittedAt: derivedState.submitted_at?.toISOString() ?? null,
            confirmedAt: derivedState.confirmed_at?.toISOString() ?? null,
            confirmations: derivedState.confirmations,
          },
        }, client);
      }

      updatedCount += result.rowCount ?? 0;
    }

    return updatedCount;
  },

  async countByUser(userId: string): Promise<number> {
    const result = await pool.query('SELECT COUNT(*) FROM transactions WHERE user_id = $1', [userId]);
    return parseInt(result.rows[0].count, 10);
  },
};

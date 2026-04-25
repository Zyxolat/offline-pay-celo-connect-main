import type { PoolClient } from 'pg';
import pool from '../config/database';

type Queryable = PoolClient | typeof pool;

function getDb(client?: PoolClient): Queryable {
  return client ?? pool;
}

export const TransactionHistoryModel = {
  async record(
    payload: {
      transactionId: string;
      txHash?: string | null;
      previousStatus?: string | null;
      nextStatus: string;
      reason: string;
      metadata?: Record<string, unknown>;
    },
    client?: PoolClient,
  ): Promise<void> {
    await getDb(client).query(
      `
        INSERT INTO transaction_history (
          transaction_id,
          tx_hash,
          previous_status,
          next_status,
          reason,
          metadata,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
      `,
      [
        payload.transactionId,
        payload.txHash ?? null,
        payload.previousStatus ?? null,
        payload.nextStatus,
        payload.reason,
        JSON.stringify(payload.metadata ?? {}),
      ]
    );
  },
};

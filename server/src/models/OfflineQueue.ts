import pool from '../config/database';
import { randomUUID } from 'crypto';

export type QueueStatus = 'pending' | 'synced' | 'failed';

export interface OfflineQueue {
  id: string;
  user_id: string;
  transaction_id?: string;
  signed_tx: string;
  status: QueueStatus;
  error?: string;
  attempts: number;
  created_at: Date;
  synced_at?: Date;
}

export const OfflineQueueModel = {
  async create(userId: string, signedTx: string, transactionId?: string): Promise<OfflineQueue> {
    const id = randomUUID();
    const result = await pool.query(
      `INSERT INTO offline_queue (id, user_id, transaction_id, signed_tx, status, attempts, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, userId, transactionId || null, signedTx, 'pending', 0, new Date()]
    );
    return result.rows[0];
  },

  async findPendingByUser(userId: string): Promise<OfflineQueue[]> {
    const result = await pool.query(
      'SELECT * FROM offline_queue WHERE user_id = $1 AND status = $2 ORDER BY created_at ASC',
      [userId, 'pending']
    );
    return result.rows;
  },

  async findById(id: string): Promise<OfflineQueue | null> {
    const result = await pool.query('SELECT * FROM offline_queue WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async updateStatus(id: string, status: QueueStatus, error?: string, syncedAt?: Date): Promise<OfflineQueue> {
    const result = await pool.query(
      `UPDATE offline_queue SET status = $1, error = $2, synced_at = $3 WHERE id = $4 RETURNING *`,
      [status, error || null, syncedAt || null, id]
    );
    return result.rows[0];
  },

  async incrementAttempts(id: string): Promise<void> {
    await pool.query('UPDATE offline_queue SET attempts = attempts + 1 WHERE id = $1', [id]);
  },

  async countPendingByUser(userId: string): Promise<number> {
    const result = await pool.query(
      'SELECT COUNT(*) FROM offline_queue WHERE user_id = $1 AND status = $2',
      [userId, 'pending']
    );
    return parseInt(result.rows[0].count, 10);
  },
};

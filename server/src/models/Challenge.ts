import pool from '../config/database.js';
import { randomUUID } from 'crypto';

export interface WebAuthnChallenge {
  id: string;
  challenge: Buffer;
  purpose: 'registration' | 'login' | 'payment';
  user_id?: string;
  payment_id?: string;
  expires_at: Date;
  created_at: Date;
}

export const ChallengeModel = {
  async create(
    challenge: Buffer,
    purpose: 'registration' | 'login' | 'payment',
    userId?: string,
    paymentId?: string
  ): Promise<WebAuthnChallenge> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const result = await pool.query(
      `INSERT INTO webauthn_challenges (id, challenge, purpose, user_id, payment_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, challenge, purpose, userId || null, paymentId || null, expiresAt, new Date()]
    );
    return result.rows[0];
  },

  async findById(id: string): Promise<WebAuthnChallenge | null> {
    const result = await pool.query('SELECT * FROM webauthn_challenges WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findLatestActiveByUser(userId: string, purpose: 'registration' | 'login' | 'payment') {
    const result = await pool.query(
      `
        SELECT *
        FROM webauthn_challenges
        WHERE user_id = $1
          AND purpose = $2
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [userId, purpose]
    );
    return result.rows[0] || null;
  },

  async deleteActiveByUser(userId: string, purpose: 'registration' | 'login' | 'payment'): Promise<void> {
    await pool.query(
      `
        DELETE FROM webauthn_challenges
        WHERE user_id = $1
          AND purpose = $2
      `,
      [userId, purpose]
    );
  },

  async findActivePaymentChallenge(paymentId: string): Promise<WebAuthnChallenge | null> {
    const result = await pool.query(
      `SELECT * FROM webauthn_challenges
       WHERE payment_id = $1 AND purpose = 'payment' AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [paymentId]
    );
    return result.rows[0] || null;
  },

  async delete(id: string): Promise<void> {
    await pool.query('DELETE FROM webauthn_challenges WHERE id = $1', [id]);
  },

  async deleteExpired(): Promise<void> {
    await pool.query('DELETE FROM webauthn_challenges WHERE expires_at < NOW()');
  },
};

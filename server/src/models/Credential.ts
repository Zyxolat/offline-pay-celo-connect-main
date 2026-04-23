import pool from '../config/database.js';
import { randomUUID } from 'crypto';

export interface Credential {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  credential_public_key: Record<string, unknown>;
  transports: string[];
  counter: number;
  created_at: Date;
}

export const CredentialModel = {
  async create(
    userId: string,
    credentialId: string,
    publicKey: Buffer,
    credentialPublicKey: Record<string, unknown>,
    transports: string[] = [],
    counter = 0
  ): Promise<Credential> {
    const id = randomUUID();
    const result = await pool.query(
      'INSERT INTO credentials (id, user_id, credential_id, public_key, credential_public_key, transports, counter, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [id, userId, credentialId, publicKey, JSON.stringify(credentialPublicKey), transports, counter, new Date()]
    );
    return result.rows[0];
  },

  async findByCredentialId(credentialId: string): Promise<Credential | null> {
    const result = await pool.query('SELECT * FROM credentials WHERE credential_id = $1', [credentialId]);
    return result.rows[0] || null;
  },

  async findByUserId(userId: string): Promise<Credential[]> {
    const result = await pool.query('SELECT * FROM credentials WHERE user_id = $1', [userId]);
    return result.rows;
  },

  async findByUserEmail(email: string): Promise<Credential[]> {
    const result = await pool.query(
      `
        SELECT c.*
        FROM credentials c
        JOIN users u ON u.id = c.user_id
        WHERE u.email = $1
      `,
      [email]
    );
    return result.rows;
  },

  async updateCounter(credentialId: string, counter: number): Promise<void> {
    await pool.query('UPDATE credentials SET counter = $1 WHERE credential_id = $2', [counter, credentialId]);
  },

  async delete(credentialId: string): Promise<void> {
    await pool.query('DELETE FROM credentials WHERE credential_id = $1', [credentialId]);
  },
};

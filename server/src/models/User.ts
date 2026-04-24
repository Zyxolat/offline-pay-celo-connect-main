import pool from '../config/database.js';
import { randomUUID } from 'crypto';

export interface User {
  id: string;
  email: string;
  wallet_address: string;
  google_id?: string | null;
  passkey_id?: string | null;
  is_admin?: boolean;
  created_at: Date;
  updated_at: Date;
}

export const UserModel = {
  async create(email: string, walletAddress: string): Promise<User> {
    const id = randomUUID();
    const now = new Date();

    const result = await pool.query(
      `INSERT INTO users (id, email, wallet_address, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, email, walletAddress, now, now]
    );

    await pool.query(
      `INSERT INTO wallets (user_id, address, created_at, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
       SET address = EXCLUDED.address,
           updated_at = EXCLUDED.updated_at`,
      [id, walletAddress, now, now]
    );

    return result.rows[0];
  },

  async findByEmail(email: string): Promise<User | null> {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  },

  async findById(id: string): Promise<User | null> {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findAdminByEmail(email: string): Promise<User | null> {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_admin = TRUE',
      [email]
    );
    return result.rows[0] || null;
  },

  async ensureSingleAdminAccount(email: string, walletAddress: string): Promise<User> {
    let user = await UserModel.findByEmail(email);

    if (!user) {
      user = await UserModel.create(email, walletAddress);
    }

    await pool.query(
      `
        UPDATE users
        SET is_admin = CASE WHEN email = $1 THEN TRUE ELSE FALSE END,
            updated_at = NOW()
        WHERE is_admin = TRUE OR email = $1
      `,
      [email]
    );

    const adminUser = await UserModel.findByEmail(email);
    if (!adminUser) {
      throw new Error('Failed to ensure single admin account');
    }

    return adminUser;
  },

  async findByWalletAddress(walletAddress: string): Promise<User | null> {
    const result = await pool.query('SELECT * FROM users WHERE wallet_address = $1', [walletAddress]);
    return result.rows[0] || null;
  },

  async findByGoogleId(googleId: string): Promise<User | null> {
    const result = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
    return result.rows[0] || null;
  },

  async upsertGoogleUser(email: string, googleId: string, walletAddress: string): Promise<User> {
    const existingByEmail = await UserModel.findByEmail(email);

    if (existingByEmail) {
      const result = await pool.query(
        `
          UPDATE users
          SET google_id = $1,
              updated_at = NOW()
          WHERE email = $2
          RETURNING *
        `,
        [googleId, email]
      );
      return result.rows[0];
    }

    const created = await UserModel.create(email, walletAddress);
    const result = await pool.query(
      'UPDATE users SET google_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [googleId, created.id]
    );
    return result.rows[0];
  },

  async setPasskeyId(userId: string, credentialId: string): Promise<User> {
    const result = await pool.query(
      'UPDATE users SET passkey_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [credentialId, userId]
    );
    return result.rows[0];
  },

  async update(id: string, updates: Partial<User>): Promise<User> {
    const now = new Date();
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updates.email !== undefined) {
      fields.push(`email = $${paramCount++}`);
      values.push(updates.email);
    }
    if (updates.wallet_address !== undefined) {
      fields.push(`wallet_address = $${paramCount++}`);
      values.push(updates.wallet_address);
    }
    if (updates.google_id !== undefined) {
      fields.push(`google_id = $${paramCount++}`);
      values.push(updates.google_id);
    }
    if (updates.passkey_id !== undefined) {
      fields.push(`passkey_id = $${paramCount++}`);
      values.push(updates.passkey_id);
    }
    if (updates.is_admin !== undefined) {
      fields.push(`is_admin = $${paramCount++}`);
      values.push(updates.is_admin);
    }

    fields.push(`updated_at = $${paramCount++}`);
    values.push(now);
    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return result.rows[0];
  },
};

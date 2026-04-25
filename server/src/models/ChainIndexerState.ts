import type { PoolClient } from 'pg';
import pool from '../config/database';

type Queryable = PoolClient | typeof pool;

function getDb(client?: PoolClient): Queryable {
  return client ?? pool;
}

export const ChainIndexerStateModel = {
  async get(key: string, client?: PoolClient): Promise<string | null> {
    const result = await getDb(client).query('SELECT value FROM chain_indexer_state WHERE key = $1', [key]);
    return result.rows[0]?.value ?? null;
  },

  async getNumber(key: string, client?: PoolClient): Promise<number | null> {
    const value = await this.get(key, client);
    if (value === null) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  },

  async set(key: string, value: string, client?: PoolClient): Promise<void> {
    await getDb(client).query(
      `
        INSERT INTO chain_indexer_state (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = NOW()
      `,
      [key, value]
    );
  },
};

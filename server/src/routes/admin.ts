import { Response, Router } from 'express';
import type { PoolClient } from 'pg';
import pool from '../config/database.js';
import { AuthRequest, requireAdminAuth } from '../middleware/auth.js';
import { transactionService } from '../services/transactionService.js';
import { normalizeError } from '../utils/logger.js';

const router = Router();

async function withReadSnapshot<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

router.use(requireAdminAuth);

router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    await transactionService.reconcileTrackedTransactions();
    const snapshot = await withReadSnapshot(async (client) => {
      const userStats = await client.query(`
          SELECT
            COUNT(*)::int AS total_users,
            COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END)::int AS new_users_24h,
            COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END)::int AS new_users_7d
          FROM users
          WHERE is_admin = FALSE
        `);
      const txStats = await client.query(`
          SELECT
            COUNT(*)::int AS total_transactions,
            COUNT(CASE WHEN status = 'confirmed' THEN 1 END)::int AS completed_transactions,
            COUNT(CASE WHEN status IN ('draft', 'pending_sync', 'submitted', 'pending') THEN 1 END)::int AS pending_transactions,
            COUNT(CASE WHEN status = 'failed' THEN 1 END)::int AS failed_transactions,
            COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount END), 0) AS total_volume,
            COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END)::int AS transactions_24h
          FROM transactions
        `);
      const walletStats = await client.query(`
          SELECT
            COUNT(*)::int AS total_wallets,
            COALESCE(SUM(celo_balance), 0) AS total_celo_balance,
            COALESCE(SUM(cusd_balance), 0) AS total_cusd_balance
          FROM wallets
        `);
      const recentUsers = await client.query(`
          SELECT u.id, u.email, w.address AS wallet_address, u.created_at
          FROM users u
          LEFT JOIN wallets w ON w.user_id = u.id
          WHERE u.is_admin = FALSE
          ORDER BY u.created_at DESC
          LIMIT 10
        `);
      const recentTransactions = await client.query(`
          SELECT t.id, t.user_id, u.email AS user_email, t.recipient, t.amount, t.currency, t.status, t.created_at
          FROM transactions t
          LEFT JOIN users u ON t.user_id = u.id
          ORDER BY t.created_at DESC
          LIMIT 10
        `);

      return { userStats, txStats, walletStats, recentUsers, recentTransactions };
    });

    res.json({
      data: {
        users: snapshot.userStats.rows[0],
        transactions: snapshot.txStats.rows[0],
        wallets: snapshot.walletStats.rows[0],
        recentUsers: snapshot.recentUsers.rows,
        recentTransactions: snapshot.recentTransactions.rows,
      },
    });
  } catch (error) {
    console.error('Admin stats error:', normalizeError(error));
    res.status(500).json({ error: 'Failed to fetch admin statistics' });
  }
});

router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;

    const snapshot = await withReadSnapshot(async (client) => {
      const users = await client.query(
        `
          SELECT
            u.id,
            u.email,
            u.created_at,
            u.updated_at,
            w.address AS wallet_address,
            COALESCE(w.celo_balance, 0) AS celo_balance,
            COALESCE(w.cusd_balance, 0) AS cusd_balance,
            COUNT(t.id)::int AS transaction_count,
            COALESCE(SUM(CASE WHEN t.status = 'confirmed' THEN t.amount END), 0) AS total_volume
          FROM users u
          LEFT JOIN wallets w ON w.user_id = u.id
          LEFT JOIN transactions t ON u.id = t.user_id
          WHERE u.is_admin = FALSE
          GROUP BY u.id, u.email, u.created_at, u.updated_at, w.address, w.celo_balance, w.cusd_balance
          ORDER BY u.created_at DESC
          LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );
      const total = await client.query(`SELECT COUNT(*)::int AS count FROM users WHERE is_admin = FALSE`);

      return { users, total };
    });

    res.json({
      data: {
        users: snapshot.users.rows,
        pagination: {
          page,
          limit,
          total: snapshot.total.rows[0].count,
          pages: Math.ceil(snapshot.total.rows[0].count / limit),
        },
      },
    });
  } catch (error) {
    console.error('Admin users error:', normalizeError(error));
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/transactions', async (req: AuthRequest, res: Response) => {
  try {
    await transactionService.reconcileTrackedTransactions();

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;

    const snapshot = await withReadSnapshot(async (client) => {
      const transactions = await client.query(
        `
          SELECT
            t.id,
            t.user_id,
            u.email AS user_email,
            t.recipient,
            t.amount,
            t.currency,
            t.status,
            t.tx_hash,
            t.created_at,
            t.updated_at
          FROM transactions t
          LEFT JOIN users u ON t.user_id = u.id
          ORDER BY t.created_at DESC
          LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );
      const total = await client.query('SELECT COUNT(*)::int AS count FROM transactions');

      return { transactions, total };
    });

    res.json({
      data: {
        transactions: snapshot.transactions.rows,
        pagination: {
          page,
          limit,
          total: snapshot.total.rows[0].count,
          pages: Math.ceil(snapshot.total.rows[0].count / limit),
        },
      },
    });
  } catch (error) {
    console.error('Admin transactions error:', normalizeError(error));
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

router.get('/wallets', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;

    const snapshot = await withReadSnapshot(async (client) => {
      const wallets = await client.query(
        `
          SELECT
            w.id,
            w.user_id,
            u.email AS user_email,
            w.address,
            w.celo_balance,
            w.cusd_balance,
            w.created_at,
            w.updated_at
          FROM wallets w
          LEFT JOIN users u ON w.user_id = u.id
          ORDER BY w.created_at DESC
          LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );
      const total = await client.query('SELECT COUNT(*)::int AS count FROM wallets');

      return { wallets, total };
    });

    res.json({
      data: {
        wallets: snapshot.wallets.rows,
        pagination: {
          page,
          limit,
          total: snapshot.total.rows[0].count,
          pages: Math.ceil(snapshot.total.rows[0].count / limit),
        },
      },
    });
  } catch (error) {
    console.error('Admin wallets error:', normalizeError(error));
    res.status(500).json({ error: 'Failed to fetch wallets' });
  }
});

export default router;

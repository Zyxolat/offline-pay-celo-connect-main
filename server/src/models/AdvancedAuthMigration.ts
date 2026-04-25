import pool from '../config/database';
import { config } from '../config/index';

const migrationStatements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      wallet_address VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      google_id VARCHAR(255) UNIQUE,
      passkey_id VARCHAR(1000),
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS passkey_id VARCHAR(1000);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
  `,
  `
    CREATE TABLE IF NOT EXISTS wallets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      address VARCHAR(255) UNIQUE NOT NULL,
      celo_balance NUMERIC(36, 18) NOT NULL DEFAULT 0,
      cusd_balance NUMERIC(36, 18) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
  `,
  `
    CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
      recipient VARCHAR(255) NOT NULL,
      amount NUMERIC(36, 18) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      status VARCHAR(50) NOT NULL,
      tx_hash VARCHAR(255) UNIQUE,
      signed_tx TEXT,
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMP,
      confirmed_at TIMESTAMP,
      confirmations INT NOT NULL DEFAULT 0
    );
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(255);
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS signed_tx TEXT;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS note TEXT;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS confirmations INT NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
  `,
  `
    CREATE TABLE IF NOT EXISTS chain_indexer_state (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS chain_indexer_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_name VARCHAR(100) NOT NULL,
      contract_address VARCHAR(255),
      abi_version VARCHAR(32) NOT NULL DEFAULT 'v1',
      tx_hash VARCHAR(255) NOT NULL,
      log_index INT NOT NULL,
      block_number BIGINT NOT NULL,
      block_hash VARCHAR(255),
      processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(tx_hash, log_index)
    );
    ALTER TABLE chain_indexer_events ADD COLUMN IF NOT EXISTS event_name VARCHAR(100);
    ALTER TABLE chain_indexer_events ADD COLUMN IF NOT EXISTS contract_address VARCHAR(255);
    ALTER TABLE chain_indexer_events ADD COLUMN IF NOT EXISTS abi_version VARCHAR(32) NOT NULL DEFAULT 'v1';
    ALTER TABLE chain_indexer_events ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(255);
    ALTER TABLE chain_indexer_events ADD COLUMN IF NOT EXISTS log_index INT;
    ALTER TABLE chain_indexer_events ADD COLUMN IF NOT EXISTS block_number BIGINT;
    ALTER TABLE chain_indexer_events ADD COLUMN IF NOT EXISTS block_hash VARCHAR(255);
    ALTER TABLE chain_indexer_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP NOT NULL DEFAULT NOW();
    ALTER TABLE chain_indexer_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chain_indexer_events_tx_hash_log_index
      ON chain_indexer_events (tx_hash, log_index);
    CREATE INDEX IF NOT EXISTS idx_chain_indexer_events_block_number
      ON chain_indexer_events (block_number);
    CREATE INDEX IF NOT EXISTS idx_chain_indexer_events_contract_block
      ON chain_indexer_events (contract_address, block_number);
  `,
  `
    CREATE TABLE IF NOT EXISTS transaction_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      tx_hash VARCHAR(255),
      previous_status VARCHAR(50),
      next_status VARCHAR(50) NOT NULL,
      reason VARCHAR(100) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE transaction_history ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(255);
    ALTER TABLE transaction_history ADD COLUMN IF NOT EXISTS previous_status VARCHAR(50);
    ALTER TABLE transaction_history ADD COLUMN IF NOT EXISTS next_status VARCHAR(50);
    ALTER TABLE transaction_history ADD COLUMN IF NOT EXISTS reason VARCHAR(100);
    ALTER TABLE transaction_history ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE transaction_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_transaction_history_transaction_id
      ON transaction_history (transaction_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transaction_history_tx_hash
      ON transaction_history (tx_hash);
  `,
  `
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      session_token TEXT UNIQUE NOT NULL,
      session_type VARCHAR(32) NOT NULL DEFAULT 'user',
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(session_token);
  `,
  `
    CREATE TABLE IF NOT EXISTS offline_queue (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
      signed_tx TEXT NOT NULL,
      status VARCHAR(50) NOT NULL,
      error TEXT,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      synced_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_offline_queue_user_id ON offline_queue(user_id);
    CREATE INDEX IF NOT EXISTS idx_offline_queue_status ON offline_queue(status);
  `,
  `
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id UUID PRIMARY KEY,
      challenge BYTEA NOT NULL,
      purpose VARCHAR(50) NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      payment_id UUID,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS credentials (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id VARCHAR(1000) UNIQUE NOT NULL,
      public_key BYTEA NOT NULL,
      credential_public_key JSONB NOT NULL,
      transports TEXT[] NOT NULL DEFAULT array[]::text[],
      counter INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON credentials(user_id);
  `,
  `
    CREATE TABLE IF NOT EXISTS oauth_providers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(50) NOT NULL,
      provider_id VARCHAR(255) NOT NULL,
      provider_email VARCHAR(255),
      linked_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(provider, provider_id)
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_providers_user_id ON oauth_providers(user_id);
  `,
];

async function backfillWallets() {
  await pool.query(`
    INSERT INTO wallets (user_id, address, created_at, updated_at)
    SELECT u.id, u.wallet_address, NOW(), NOW()
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM wallets w WHERE w.user_id = u.id
    )
  `);

  await pool.query(`
    UPDATE transactions t
    SET wallet_id = w.id
    FROM wallets w
    WHERE t.user_id = w.user_id
      AND t.wallet_id IS NULL
  `);
}

async function ensureAdminUser() {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO users (id, email, wallet_address, is_admin, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, TRUE, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE
      SET is_admin = TRUE,
          updated_at = NOW()
      RETURNING id
    `,
    [config.admin.email, `admin-${Date.now()}@wallet.local`]
  );

  await pool.query(
    `
      INSERT INTO wallets (user_id, address, created_at, updated_at)
      SELECT u.id, u.wallet_address, NOW(), NOW()
      FROM users u
      WHERE u.id = $1
        AND NOT EXISTS (
          SELECT 1 FROM wallets w WHERE w.user_id = u.id
        )
    `,
    [result.rows[0].id]
  );
}

export async function createAdvancedAuthTables() {
  for (const statement of migrationStatements) {
    await pool.query(statement);
  }

  await backfillWallets();
  await ensureAdminUser();
}

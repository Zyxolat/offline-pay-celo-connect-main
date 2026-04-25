import type { PoolClient } from 'pg';
import pool from '../config/database';

export interface ChainIndexerEventRecord {
  id: string;
  event_name: string;
  contract_address?: string | null;
  abi_version: string;
  tx_hash: string;
  log_index: number;
  block_number: string;
  block_hash?: string | null;
  processed_at: Date;
  created_at: Date;
}

export interface ChainIndexerEventSample {
  event_name: string;
  contract_address?: string | null;
  abi_version: string;
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_hash?: string | null;
}

type Queryable = PoolClient | typeof pool;

function getDb(client?: PoolClient): Queryable {
  return client ?? pool;
}

export const ChainIndexerEventModel = {
  async findByTxHashAndLogIndex(txHash: string, logIndex: number, client?: PoolClient): Promise<ChainIndexerEventRecord | null> {
    const result = await getDb(client).query(
      'SELECT * FROM chain_indexer_events WHERE tx_hash = $1 AND log_index = $2',
      [txHash, logIndex]
    );

    return result.rows[0] ?? null;
  },

  async insert(
    payload: {
      eventName: string;
      contractAddress?: string | null;
      abiVersion?: string;
      txHash: string;
      logIndex: number;
      blockNumber: number;
      blockHash?: string | null;
    },
    client?: PoolClient,
  ): Promise<ChainIndexerEventRecord | null> {
    const result = await getDb(client).query(
      `
        INSERT INTO chain_indexer_events (
          event_name,
          contract_address,
          abi_version,
          tx_hash,
          log_index,
          block_number,
          block_hash,
          processed_at,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        ON CONFLICT (tx_hash, log_index) DO NOTHING
        RETURNING *
      `,
      [
        payload.eventName,
        payload.contractAddress ?? null,
        payload.abiVersion ?? 'v1',
        payload.txHash,
        payload.logIndex,
        payload.blockNumber,
        payload.blockHash ?? null,
      ]
    );

    return result.rows[0] ?? null;
  },

  async getRecentIndexedBlocks(limit: number, client?: PoolClient): Promise<Array<{ block_number: number; block_hash: string | null }>> {
    const result = await getDb(client).query(
      `
        SELECT block_number::int AS block_number, block_hash
        FROM chain_indexer_events
        WHERE block_hash IS NOT NULL
        GROUP BY block_number, block_hash
        ORDER BY block_number DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows;
  },

  async deleteFromBlock(blockNumber: number, client?: PoolClient): Promise<Array<{ tx_hash: string }>> {
    const result = await getDb(client).query(
      `
        DELETE FROM chain_indexer_events
        WHERE block_number >= $1
        RETURNING tx_hash
      `,
      [blockNumber]
    );

    return result.rows;
  },

  async countInBlockRange(fromBlock: number, toBlock: number, client?: PoolClient): Promise<number> {
    const result = await getDb(client).query(
      `
        SELECT COUNT(*)::int AS count
        FROM chain_indexer_events
        WHERE block_number BETWEEN $1 AND $2
      `,
      [fromBlock, toBlock]
    );

    return result.rows[0]?.count ?? 0;
  },

  async getRecentSamples(limit: number, client?: PoolClient): Promise<ChainIndexerEventSample[]> {
    const result = await getDb(client).query(
      `
        SELECT event_name, tx_hash, log_index, block_number::int AS block_number, block_hash
             , contract_address, abi_version
        FROM chain_indexer_events
        ORDER BY block_number DESC, log_index DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows;
  },
};

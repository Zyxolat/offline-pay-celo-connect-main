import type { PoolClient } from 'pg';
import pool from '../config/database.js';
import { getDatabaseStatus } from '../config/database.js';
import { ethers, type EventLog, type Log, type TransactionReceipt, type TransactionResponse } from 'ethers';
import { config } from '../config/index.js';
import { TIMELOCK_CONTRACT_ABI, type IndexedPaymentEventName, type TimeLockAbiVersion } from '../contracts/timeLock.js';
import { ChainIndexerEventModel } from '../models/ChainIndexerEvent.js';
import { ChainIndexerStateModel } from '../models/ChainIndexerState.js';
import { UserModel } from '../models/User.js';
import { transactionService } from './transactionService.js';
import { celoService } from './celoService.js';
import { log, normalizeError } from '../utils/logger.js';

type SupportedContractMethod = 'createPayment' | 'claimPayment' | 'acceptPayment' | 'refundPayment' | 'cancelPayment';
type VerifiedStatus = 'submitted' | 'pending' | 'confirmed' | 'failed';
type IndexerMode = 'websocket' | 'http-polling';
type IndexerAlertLevel = 'warn' | 'error';

type VerifiedTransaction = {
  txHash: string;
  actorAddress: string;
  recipient: string;
  amount: string;
  status: VerifiedStatus;
  confirmations: number;
  note: string;
  contractAddress: string;
  abiVersion: string;
};

type IndexerStatus = {
  started: boolean;
  mode: IndexerMode;
  recoveryMode: 'normal' | 'backfill';
  wsConfigured: boolean;
  wsConnected: boolean;
  wsReconnectAttempts: number;
  lastWsConnectedAt: string | null;
  lastWsError: { message: string; at: string } | null;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncReason: string | null;
  lastSyncError: { message: string; at: string } | null;
  currentBlock: number | null;
  confirmedBlock: number | null;
  storedCheckpointBlock: number | null;
  lastProcessedBlock: number | null;
  nextSyncFromBlock: number | null;
  lagBlocks: number | null;
  lastReorgAt: string | null;
  lastReorgRollbackBlock: number | null;
  reorgRollbackCount: number;
  consecutiveSyncFailures: number;
  effectiveSyncIntervalMs: number;
  integrityLastCheckedAt: string | null;
  integrityLastError: { message: string; at: string } | null;
  integrityLastSuccess: {
    checkedAt: string;
    sampledTransactions: number;
    dbEventCount: number;
    chainEventCount: number;
    lookbackFromBlock: number | null;
    lookbackToBlock: number | null;
  } | null;
};

type IndexerAlert = {
  level: IndexerAlertLevel;
  code: string;
  message: string;
};

const INDEXER_STATE_KEY = 'timelock:last_processed_block';
const PENDING_TX_POLL_INTERVAL_MS = 15_000;
const CONFIRMATIONS = Math.max(1, config.celo.eventIndexerConfirmations || 3);
const SAFETY_MARGIN = Math.max(CONFIRMATIONS, config.celo.eventIndexerSafetyMargin || 10);
const SYNC_POLL_INTERVAL_MS = Math.max(1_000, config.celo.eventIndexerPollingIntervalMs || 15_000);
const WS_RECONNECT_DELAY_MS = Math.max(1_000, config.celo.eventIndexerWsReconnectDelayMs || 5_000);
const MAX_BLOCKS_PER_QUERY = Math.max(1, config.celo.eventIndexerMaxBlocksPerQuery || 500);
const REORG_CHECK_WINDOW = Math.max(1, config.celo.eventIndexerReorgCheckWindow || 25);
const ALERT_LAG_BLOCKS = Math.max(SAFETY_MARGIN, config.celo.eventIndexerAlertLagBlocks || 20);
const ALERT_SYNC_STALE_MS = Math.max(SYNC_POLL_INTERVAL_MS, config.celo.eventIndexerAlertSyncStaleMs || 120_000);
const RECOVERY_POLLING_INTERVAL_MS = Math.max(1_000, config.celo.eventIndexerRecoveryPollingIntervalMs || 5_000);
const FAILURE_THRESHOLD = Math.max(1, config.celo.eventIndexerFailureThreshold || 3);
const INTEGRITY_INTERVAL_MS = Math.max(30_000, config.celo.eventIndexerIntegrityIntervalMs || 300_000);
const INTEGRITY_SAMPLE_SIZE = Math.max(1, config.celo.eventIndexerIntegritySampleSize || 5);
const INTEGRITY_LOOKBACK_BLOCKS = Math.max(1, config.celo.eventIndexerIntegrityLookbackBlocks || 250);
const INDEXED_EVENTS: IndexedPaymentEventName[] = ['PaymentCreated', 'PaymentClaimed', 'PaymentRefunded'];
const normalizeAddress = (address: string) => ethers.getAddress(address);
const indexedContracts = celoService.getIndexedContracts();
const contractInterfaceByAddress = new Map(
  indexedContracts.map((contract) => [normalizeAddress(contract.address), new ethers.Interface(contract.abi)])
);
const contractVersionByAddress = new Map(
  indexedContracts.map((contract) => [normalizeAddress(contract.address), contract.abiVersion])
);

const isEventLog = (logEntry: Log): logEntry is EventLog => 'fragment' in logEntry;

const indexedContractAddresses = new Set(indexedContracts.map((contract) => normalizeAddress(contract.address)));

const isContractAddress = (address: string | null | undefined) =>
  Boolean(address && indexedContractAddresses.has(normalizeAddress(address)));

const getContractInterfaceForAddress = (address: string) =>
  contractInterfaceByAddress.get(normalizeAddress(address)) ?? new ethers.Interface(TIMELOCK_CONTRACT_ABI);

const getContractVersionForAddress = (address: string) =>
  contractVersionByAddress.get(normalizeAddress(address)) ?? 'v1';

const getReceiptConfirmations = async (receipt: TransactionReceipt) => {
  const latestBlock = await celoService.getHttpProvider().getBlockNumber();
  return Math.max(0, latestBlock - receipt.blockNumber + 1);
};

const parseRelevantLogs = (receipt: TransactionReceipt) =>
  receipt.logs
    .filter((entry) => isContractAddress(entry.address))
    .map((entry) => {
      try {
        const parsed = getContractInterfaceForAddress(entry.address).parseLog({
          topics: [...entry.topics],
          data: entry.data,
        });

        return parsed ? { parsed, address: entry.address } : null;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

const parseContractTransaction = (transaction: TransactionResponse) => {
  try {
    if (!transaction.to || !isContractAddress(transaction.to)) {
      return null;
    }

    const parsed = getContractInterfaceForAddress(transaction.to).parseTransaction({
      data: transaction.data,
      value: transaction.value,
    });

    if (!parsed) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const resolveRecipientAndAmountFromPayment = async (paymentId: number, contractAddress: string, abiVersion: string) => {
  const payment = await celoService.getTimeLockContract(
    celoService.getHttpProvider(),
    contractAddress,
    abiVersion as TimeLockAbiVersion,
  ).getPayment(paymentId);

  return {
    recipient: normalizeAddress(payment.recipient),
    amount: ethers.formatEther(payment.amount),
  };
};

const buildVerifiedTransactionFromInput = async (
  transaction: TransactionResponse,
  receipt: TransactionReceipt | null,
): Promise<VerifiedTransaction | null> => {
  const parsed = parseContractTransaction(transaction);
  if (!parsed) {
    return null;
  }

  const actorAddress = normalizeAddress(transaction.from);
  const contractAddress = normalizeAddress(transaction.to!);
  const abiVersion = getContractVersionForAddress(contractAddress);
  const methodName = parsed.name as SupportedContractMethod;
  let recipient = actorAddress;
  let amount = ethers.formatEther(transaction.value);
  let note = `Contract transaction: ${methodName}`;

  if (methodName === 'createPayment') {
    recipient = normalizeAddress(String(parsed.args[0]));
    amount = ethers.formatEther(transaction.value);
    note = 'Contract payment created';
  } else {
    const paymentId = Number(parsed.args[0]);
    const paymentData = await resolveRecipientAndAmountFromPayment(paymentId, contractAddress, abiVersion);
    recipient = paymentData.recipient;
    amount = paymentData.amount;

    if (methodName === 'claimPayment' || methodName === 'acceptPayment') {
      note = `Contract payment #${paymentId} claimed`;
    } else {
      note = `Contract payment #${paymentId} refunded`;
    }
  }

  if (!receipt) {
    return {
      txHash: transaction.hash,
      actorAddress,
      recipient,
      amount,
      status: 'pending',
      confirmations: 0,
      note,
      contractAddress,
      abiVersion,
    };
  }

  return {
    txHash: transaction.hash,
    actorAddress,
    recipient,
    amount,
    status: receipt.status === 1 ? 'confirmed' : 'failed',
    confirmations: await getReceiptConfirmations(receipt),
    note,
    contractAddress,
    abiVersion,
  };
};

const buildVerifiedTransactionFromEvent = async (
  eventName: IndexedPaymentEventName,
  eventData: {
    transactionHash: string;
    args: EventLog['args'];
    address: string;
  },
  receipt: TransactionReceipt | null,
): Promise<VerifiedTransaction | null> => {
  const txHash = eventData.transactionHash;
  const confirmations = receipt ? await getReceiptConfirmations(receipt) : 0;
  const contractAddress = normalizeAddress(eventData.address);
  const abiVersion = getContractVersionForAddress(contractAddress);

  if (eventName === 'PaymentCreated') {
    return {
      txHash,
      actorAddress: normalizeAddress(String(eventData.args.sender)),
      recipient: normalizeAddress(String(eventData.args.recipient)),
      amount: ethers.formatEther(eventData.args.amount),
      status: receipt?.status === 0 ? 'failed' : 'confirmed',
      confirmations,
      note: `Contract payment #${String(eventData.args.paymentId)} created`,
      contractAddress,
      abiVersion,
    };
  }

  if (eventName === 'PaymentClaimed') {
    return {
      txHash,
      actorAddress: normalizeAddress(String(eventData.args.recipient)),
      recipient: normalizeAddress(String(eventData.args.recipient)),
      amount: ethers.formatEther(eventData.args.amount),
      status: receipt?.status === 0 ? 'failed' : 'confirmed',
      confirmations,
      note: `Contract payment #${String(eventData.args.paymentId)} claimed`,
      contractAddress,
      abiVersion,
    };
  }

  return {
    txHash,
    actorAddress: normalizeAddress(String(eventData.args.sender)),
    recipient: normalizeAddress(String(eventData.args.sender)),
    amount: ethers.formatEther(eventData.args.amount),
    status: receipt?.status === 0 ? 'failed' : 'confirmed',
    confirmations,
    note: `Contract payment #${String(eventData.args.paymentId)} refunded`,
    contractAddress,
    abiVersion,
  };
};

async function persistVerifiedTransaction(verifiedTransaction: VerifiedTransaction, client?: PoolClient) {
  const user = await UserModel.findByWalletAddress(verifiedTransaction.actorAddress);
  if (!user) {
    return null;
  }

  return transactionService.recordContractTransaction(user.id, {
    txHash: verifiedTransaction.txHash,
    recipient: verifiedTransaction.recipient,
    amount: verifiedTransaction.amount,
    currency: 'CELO',
    status: verifiedTransaction.status,
    confirmations: verifiedTransaction.confirmations,
    note: verifiedTransaction.note,
  }, client);
}

function getEventName(eventLog: EventLog): IndexedPaymentEventName | null {
  const eventName = eventLog.eventName as IndexedPaymentEventName;
  return INDEXED_EVENTS.includes(eventName) ? eventName : null;
}

function getEventLogIndex(eventLog: EventLog): number {
  return eventLog.index;
}

async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitIndexerAlert(level: IndexerAlertLevel, code: string, message: string, meta?: Record<string, unknown>) {
  log(level === 'error' ? 'ERROR' : 'WARN', message, {
    alertType: 'indexer',
    alertCode: code,
    ...meta,
  });
}

function getWsTransport(provider: ethers.WebSocketProvider) {
  return (provider as unknown as {
    websocket?: {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeAllListeners?: () => void;
      close?: () => void;
      terminate?: () => void;
    };
  }).websocket;
}

export const contractIndexerService = {
  isStarted: false,
  pollTimer: null as NodeJS.Timeout | null,
  syncTimer: null as NodeJS.Timeout | null,
  integrityTimer: null as NodeJS.Timeout | null,
  wsReconnectTimer: null as NodeJS.Timeout | null,
  wsProvider: null as ethers.WebSocketProvider | null,
  syncInFlight: null as Promise<void> | null,
  status: {
    started: false,
    mode: 'http-polling',
    recoveryMode: 'normal',
    wsConfigured: Boolean(config.celo.wsRpcUrl),
    wsConnected: false,
    wsReconnectAttempts: 0,
    lastWsConnectedAt: null,
    lastWsError: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncReason: null,
    lastSyncError: null,
    currentBlock: null,
    confirmedBlock: null,
    storedCheckpointBlock: null,
    lastProcessedBlock: null,
    nextSyncFromBlock: null,
    lagBlocks: null,
    lastReorgAt: null,
    lastReorgRollbackBlock: null,
    reorgRollbackCount: 0,
    consecutiveSyncFailures: 0,
    effectiveSyncIntervalMs: SYNC_POLL_INTERVAL_MS,
    integrityLastCheckedAt: null,
    integrityLastError: null,
    integrityLastSuccess: null,
  } as IndexerStatus,

  setMode(mode: IndexerMode) {
    this.status.mode = mode;
  },

  setRecoveryMode(recoveryMode: 'normal' | 'backfill') {
    this.status.recoveryMode = recoveryMode;
    this.status.effectiveSyncIntervalMs = recoveryMode === 'backfill'
      ? RECOVERY_POLLING_INTERVAL_MS
      : SYNC_POLL_INTERVAL_MS;
  },

  getCurrentSyncIntervalMs() {
    return this.status.recoveryMode === 'backfill'
      ? RECOVERY_POLLING_INTERVAL_MS
      : SYNC_POLL_INTERVAL_MS;
  },

  async refreshLag() {
    if (this.status.confirmedBlock === null || this.status.lastProcessedBlock === null) {
      this.status.lagBlocks = null;
      return;
    }

    this.status.lagBlocks = Math.max(0, this.status.confirmedBlock - this.status.lastProcessedBlock);
  },

  async initializeCheckpointWindow() {
    const storedCheckpointBlock = await ChainIndexerStateModel.getNumber(INDEXER_STATE_KEY);
    const configuredStartBlock = Math.max(0, config.celo.eventIndexerStartBlock || 0);
    const resumeFromBlock = storedCheckpointBlock === null
      ? configuredStartBlock
      : Math.max(configuredStartBlock, storedCheckpointBlock - SAFETY_MARGIN);

    this.status.storedCheckpointBlock = storedCheckpointBlock;
    this.status.lastProcessedBlock = storedCheckpointBlock;
    this.status.nextSyncFromBlock = resumeFromBlock;
  },

  async verifyAndRecordTransaction(txHash: string, expectedUserId?: string) {
    const transaction = await celoService.getTransaction(txHash);
    if (!transaction) {
      throw new Error('Transaction does not exist on-chain yet.');
    }

    if (!isContractAddress(transaction.to)) {
      throw new Error('Transaction target does not match the configured payment contract.');
    }

    const actorAddress = normalizeAddress(transaction.from);

    if (expectedUserId) {
      const user = await UserModel.findById(expectedUserId);
      if (!user) {
        throw new Error('User not found');
      }

      if (normalizeAddress(user.wallet_address) !== actorAddress) {
        throw new Error('Transaction sender does not match the authenticated wallet.');
      }
    }

    const receipt = await celoService.getTransactionReceipt(txHash);
    const relevantLogs = receipt ? parseRelevantLogs(receipt) : [];

    let verified = null as VerifiedTransaction | null;

    if (relevantLogs.length > 0) {
      const matchingEvent = relevantLogs.find((entry) => INDEXED_EVENTS.includes(entry.parsed.name as IndexedPaymentEventName));

      if (matchingEvent && receipt) {
        verified = await buildVerifiedTransactionFromEvent(
          matchingEvent.parsed.name as IndexedPaymentEventName,
          {
            transactionHash: txHash,
            args: matchingEvent.parsed.args as EventLog['args'],
            address: matchingEvent.address,
          },
          receipt,
        );
      }
    }

    if (!verified) {
      verified = await buildVerifiedTransactionFromInput(transaction, receipt);
    }

    if (!verified) {
      throw new Error('Transaction is not a supported OfflinePay contract interaction.');
    }

    const persisted = await persistVerifiedTransaction(verified);

    log('INFO', 'Verified contract transaction', {
      txHash,
      status: verified.status,
      actorAddress: verified.actorAddress,
      recipient: verified.recipient,
      expectedUserId: expectedUserId ?? null,
    });

    return {
      verified,
      persisted,
    };
  },

  async processEventLog(eventLog: EventLog, client?: PoolClient) {
    const eventName = getEventName(eventLog);
    if (!eventName) {
      return null;
    }

    const logIndex = getEventLogIndex(eventLog);
    const existing = await ChainIndexerEventModel.findByTxHashAndLogIndex(eventLog.transactionHash, logIndex, client);
    if (existing) {
      log('INFO', 'Skipped duplicate indexed contract event', {
        event: eventName,
        txHash: eventLog.transactionHash,
        logIndex,
        blockNumber: eventLog.blockNumber ?? null,
      });
      return null;
    }

    const receipt = await celoService.getTransactionReceipt(eventLog.transactionHash);
    const verified = await buildVerifiedTransactionFromEvent(eventName, {
      transactionHash: eventLog.transactionHash,
      args: eventLog.args,
      address: eventLog.address,
    }, receipt);

    if (!verified) {
      return null;
    }

    const inserted = await ChainIndexerEventModel.insert({
      eventName,
      contractAddress: verified.contractAddress,
      abiVersion: verified.abiVersion,
      txHash: eventLog.transactionHash,
      logIndex,
      blockNumber: eventLog.blockNumber,
      blockHash: eventLog.blockHash ?? null,
    }, client);

    if (!inserted) {
      log('INFO', 'Skipped duplicate indexed contract event after insert race', {
        event: eventName,
        txHash: eventLog.transactionHash,
        logIndex,
        blockNumber: eventLog.blockNumber ?? null,
      });
      return null;
    }

    const persisted = await persistVerifiedTransaction(verified, client);

    log('INFO', 'Indexed confirmed contract event', {
      event: eventName,
      txHash: eventLog.transactionHash,
      logIndex,
      blockNumber: eventLog.blockNumber ?? null,
      confirmations: verified.confirmations,
      actorAddress: verified.actorAddress,
      persisted: Boolean(persisted),
    });

    return persisted;
  },

  async queryConfirmedLogsChunk(fromBlock: number, toBlock: number) {
    const allLogs: EventLog[] = [];
    const contracts = celoService.getTimeLockContracts();

    for (const contractEntry of contracts) {
      const [createdLogs, claimedLogs, refundedLogs] = await Promise.all([
        contractEntry.contract.queryFilter(contractEntry.contract.filters.PaymentCreated(), fromBlock, toBlock),
        contractEntry.contract.queryFilter(contractEntry.contract.filters.PaymentClaimed(), fromBlock, toBlock),
        contractEntry.contract.queryFilter(contractEntry.contract.filters.PaymentRefunded(), fromBlock, toBlock),
      ]);

      allLogs.push(...[...createdLogs, ...claimedLogs, ...refundedLogs].filter(isEventLog));
    }

    return allLogs.sort((left, right) => {
      if (left.blockNumber !== right.blockNumber) {
        return left.blockNumber - right.blockNumber;
      }

      return left.index - right.index;
    });
  },

  async queryConfirmedLogs(fromBlock: number, toBlock: number) {
    const allLogs: EventLog[] = [];

    for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += MAX_BLOCKS_PER_QUERY) {
      const chunkTo = Math.min(toBlock, chunkFrom + MAX_BLOCKS_PER_QUERY - 1);
      allLogs.push(...await this.queryConfirmedLogsChunk(chunkFrom, chunkTo));
    }

    return allLogs.sort((left, right) => {
      if (left.blockNumber !== right.blockNumber) {
        return left.blockNumber - right.blockNumber;
      }

      return left.index - right.index;
    });
  },

  async fetchCanonicalBlockHashWithRetry(blockNumber: number, attempts: number = 2) {
    let lastHash: string | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const block = await celoService.getBlock(blockNumber);
      const blockHash = block?.hash ?? null;

      if (!blockHash) {
        if (attempt < attempts) {
          await sleep(250);
          continue;
        }

        return null;
      }

      if (lastHash !== null && lastHash === blockHash) {
        return blockHash;
      }

      lastHash = blockHash;

      if (attempt < attempts) {
        await sleep(250);
      }
    }

    return lastHash;
  },

  async confirmReorgMismatch(indexedBlock: { block_number: number; block_hash: string | null }) {
    if (!indexedBlock.block_hash) {
      return false;
    }

    const firstHash = await this.fetchCanonicalBlockHashWithRetry(indexedBlock.block_number, 2);
    if (!firstHash || firstHash === indexedBlock.block_hash) {
      return false;
    }

    await sleep(350);
    const secondHash = await this.fetchCanonicalBlockHashWithRetry(indexedBlock.block_number, 2);

    return Boolean(secondHash && secondHash === firstHash && secondHash !== indexedBlock.block_hash);
  },

  async detectReorgRollbackPoint() {
    const indexedBlocks = await ChainIndexerEventModel.getRecentIndexedBlocks(REORG_CHECK_WINDOW);

    for (const indexedBlock of indexedBlocks) {
      if (await this.confirmReorgMismatch(indexedBlock)) {
        return indexedBlock.block_number;
      }
    }

    return null;
  },

  async rollbackFromBlock(blockNumber: number, reason: string) {
    const rollbackToBlock = Math.max(0, blockNumber - 1);

    const rollback = await withTransaction(async (client) => {
      const deletedEvents = await ChainIndexerEventModel.deleteFromBlock(blockNumber, client);
      const txHashes = [...new Set(deletedEvents.map((event) => event.tx_hash))];
      const rolledBackTransactions = await transactionService.rollbackIndexedTransactions(txHashes, client);
      await ChainIndexerStateModel.set(INDEXER_STATE_KEY, String(rollbackToBlock), client);

      return {
        deletedEvents: deletedEvents.length,
        rolledBackTransactions,
        txHashes: txHashes.length,
      };
    });

    this.status.storedCheckpointBlock = rollbackToBlock;
    this.status.lastProcessedBlock = rollbackToBlock;
    this.status.nextSyncFromBlock = blockNumber;
    this.status.lastReorgAt = new Date().toISOString();
    this.status.lastReorgRollbackBlock = blockNumber;
    this.status.reorgRollbackCount += 1;
    this.setRecoveryMode('backfill');

    log('WARN', 'Indexer reorg rollback applied', {
      reason,
      rollbackFromBlock: blockNumber,
      rollbackToBlock,
      deletedEvents: rollback.deletedEvents,
      rolledBackTransactions: rollback.rolledBackTransactions,
      affectedTxHashes: rollback.txHashes,
    });
    emitIndexerAlert('warn', 'REORG_ROLLBACK', 'Indexer reorg rollback applied', {
      rollbackFromBlock: blockNumber,
      rollbackToBlock,
      deletedEvents: rollback.deletedEvents,
      rolledBackTransactions: rollback.rolledBackTransactions,
    });
  },

  async ensureCanonicalChain() {
    const rollbackBlock = await this.detectReorgRollbackPoint();
    if (rollbackBlock === null) {
      return;
    }

    await this.rollbackFromBlock(rollbackBlock, 'block-hash-mismatch');
  },

  async verifyIntegrity() {
    this.status.integrityLastCheckedAt = new Date().toISOString();

    try {
      const confirmedBlock = this.status.confirmedBlock ?? await celoService.getHttpProvider().getBlockNumber() - CONFIRMATIONS;
      if (confirmedBlock < 0) {
        return;
      }

      const fromBlock = Math.max(0, confirmedBlock - INTEGRITY_LOOKBACK_BLOCKS + 1);
      const [dbEventCount, chainEvents, samples] = await Promise.all([
        ChainIndexerEventModel.countInBlockRange(fromBlock, confirmedBlock),
        this.queryConfirmedLogs(fromBlock, confirmedBlock),
        ChainIndexerEventModel.getRecentSamples(INTEGRITY_SAMPLE_SIZE),
      ]);

      if (dbEventCount !== chainEvents.length) {
        throw new Error(`Integrity mismatch: DB has ${dbEventCount} events, chain has ${chainEvents.length} events in blocks ${fromBlock}-${confirmedBlock}`);
      }

      for (const sample of samples) {
        const receipt = await celoService.getTransactionReceipt(sample.tx_hash);
        if (!receipt) {
          throw new Error(`Integrity sample ${sample.tx_hash} is missing a receipt`);
        }

        const matchingLog = receipt.logs.find((logEntry) =>
          ('index' in logEntry ? logEntry.index : -1) === sample.log_index &&
          logEntry.transactionHash === sample.tx_hash &&
          logEntry.blockNumber === sample.block_number &&
          (!sample.contract_address || normalizeAddress(logEntry.address) === normalizeAddress(sample.contract_address))
        );

        if (!matchingLog) {
          throw new Error(`Integrity sample ${sample.tx_hash}:${sample.log_index} did not match on-chain receipt`);
        }
      }

      this.status.integrityLastError = null;
      this.status.integrityLastSuccess = {
        checkedAt: new Date().toISOString(),
        sampledTransactions: samples.length,
        dbEventCount,
        chainEventCount: chainEvents.length,
        lookbackFromBlock: fromBlock,
        lookbackToBlock: confirmedBlock,
      };
    } catch (error) {
      this.status.integrityLastError = {
        message: normalizeError(error).message,
        at: new Date().toISOString(),
      };

      log('ERROR', 'Indexer integrity verification failed', {
        ...normalizeError(error),
        confirmedBlock: this.status.confirmedBlock,
      });
    }
  },

  async processConfirmedRange(fromBlock: number, toBlock: number) {
    let indexedEvents = 0;

    const flushBlock = async (blockNumber: number, logsForBlock: EventLog[]) => {
      logsForBlock.sort((left, right) => {
        if (left.blockNumber !== right.blockNumber) {
          return left.blockNumber - right.blockNumber;
        }

        return getEventLogIndex(left) - getEventLogIndex(right);
      });

      await withTransaction(async (client) => {
        for (const eventLog of logsForBlock) {
          await this.processEventLog(eventLog, client);
        }

        await ChainIndexerStateModel.set(INDEXER_STATE_KEY, String(blockNumber), client);
      });

      this.status.storedCheckpointBlock = blockNumber;
      this.status.lastProcessedBlock = blockNumber;
      this.status.nextSyncFromBlock = blockNumber + 1;
      indexedEvents += logsForBlock.length;
    };

    for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += MAX_BLOCKS_PER_QUERY) {
      const chunkTo = Math.min(toBlock, chunkFrom + MAX_BLOCKS_PER_QUERY - 1);
      const allLogs = await this.queryConfirmedLogsChunk(chunkFrom, chunkTo);

      let currentBlock = chunkFrom;
      let blockLogs: EventLog[] = [];

      for (const eventLog of allLogs) {
        if (eventLog.blockNumber !== currentBlock) {
          if (blockLogs.length > 0) {
            await flushBlock(currentBlock, blockLogs);
          } else if (eventLog.blockNumber > currentBlock) {
            await withTransaction(async (client) => {
              await ChainIndexerStateModel.set(INDEXER_STATE_KEY, String(eventLog.blockNumber - 1), client);
            });

            this.status.storedCheckpointBlock = eventLog.blockNumber - 1;
            this.status.lastProcessedBlock = eventLog.blockNumber - 1;
            this.status.nextSyncFromBlock = eventLog.blockNumber;
          }

          currentBlock = eventLog.blockNumber;
          blockLogs = [];
        }

        blockLogs.push(eventLog);
      }

      if (blockLogs.length > 0) {
        await flushBlock(currentBlock, blockLogs);
      }

      if ((this.status.lastProcessedBlock === null || this.status.lastProcessedBlock < chunkTo) && allLogs.length === 0) {
        await withTransaction(async (client) => {
          await ChainIndexerStateModel.set(INDEXER_STATE_KEY, String(chunkTo), client);
        });

        this.status.storedCheckpointBlock = chunkTo;
        this.status.lastProcessedBlock = chunkTo;
        this.status.nextSyncFromBlock = chunkTo + 1;
      }
    }

    if (this.status.lastProcessedBlock === null || this.status.lastProcessedBlock < toBlock) {
      await withTransaction(async (client) => {
        await ChainIndexerStateModel.set(INDEXER_STATE_KEY, String(toBlock), client);
      });

      this.status.storedCheckpointBlock = toBlock;
      this.status.lastProcessedBlock = toBlock;
      this.status.nextSyncFromBlock = toBlock + 1;
    }

    log('INFO', 'Completed confirmed contract event sync', {
      fromBlock,
      toBlock,
      indexedEvents,
      confirmations: CONFIRMATIONS,
      indexedContracts: indexedContracts.length,
    });
  },

  async syncConfirmedBlocks(reason: string) {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = (async () => {
      this.status.lastSyncStartedAt = new Date().toISOString();
      this.status.lastSyncReason = reason;
      this.status.lastSyncError = null;

      try {
        const latestBlock = await celoService.getHttpProvider().getBlockNumber();
        const confirmedBlock = latestBlock - CONFIRMATIONS;

        this.status.currentBlock = latestBlock;
        this.status.confirmedBlock = confirmedBlock >= 0 ? confirmedBlock : null;
        await this.ensureCanonicalChain();

        const fromBlock = this.status.nextSyncFromBlock ?? Math.max(0, config.celo.eventIndexerStartBlock || 0);

        if (confirmedBlock < 0 || fromBlock > confirmedBlock) {
          await this.refreshLag();
          this.status.consecutiveSyncFailures = 0;
          if (this.status.lagBlocks === null || this.status.lagBlocks <= SAFETY_MARGIN) {
            this.setRecoveryMode('normal');
          }
          this.status.lastSyncCompletedAt = new Date().toISOString();
          return;
        }

        await this.processConfirmedRange(fromBlock, confirmedBlock);
        await this.refreshLag();
        this.status.consecutiveSyncFailures = 0;
        if (this.status.lagBlocks !== null && this.status.lagBlocks > ALERT_LAG_BLOCKS) {
          this.setRecoveryMode('backfill');
          emitIndexerAlert('warn', 'LAG_HIGH', 'Indexer lag threshold breached', {
            lagBlocks: this.status.lagBlocks,
            threshold: ALERT_LAG_BLOCKS,
          });
        } else {
          this.setRecoveryMode('normal');
        }
        this.status.lastSyncCompletedAt = new Date().toISOString();
      } catch (error) {
        this.status.lastSyncError = {
          message: normalizeError(error).message,
          at: new Date().toISOString(),
        };
        this.status.consecutiveSyncFailures += 1;
        if (this.status.consecutiveSyncFailures >= FAILURE_THRESHOLD) {
          this.setRecoveryMode('backfill');
        }

        log('ERROR', 'Confirmed contract event sync failed', {
          ...normalizeError(error),
          reason,
          nextSyncFromBlock: this.status.nextSyncFromBlock,
          confirmations: CONFIRMATIONS,
          consecutiveSyncFailures: this.status.consecutiveSyncFailures,
        });
        emitIndexerAlert('error', 'SYNC_FAILURE', 'Confirmed contract event sync failed', {
          reason,
          nextSyncFromBlock: this.status.nextSyncFromBlock,
          consecutiveSyncFailures: this.status.consecutiveSyncFailures,
          error: normalizeError(error),
        });

        // Do not re-throw: the error is already recorded in status and logged above.
        // Re-throwing would cause callers to double-log and would break the startup
        // flow, surfacing a misleading "DB connection failed" message in app.ts.
      } finally {
        this.syncInFlight = null;
      }
    })();

    return this.syncInFlight;
  },

  async reconcilePendingTransactions() {
    await transactionService.reconcileTrackedTransactions();
  },

  startPollingPendingTransactions() {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = setInterval(() => {
      void this.reconcilePendingTransactions().catch((error) => {
        log('ERROR', 'Pending transaction reconciliation failed', normalizeError(error));
      });
    }, PENDING_TX_POLL_INTERVAL_MS);
  },

  startSyncPolling() {
    if (this.syncTimer) {
      return;
    }

    const scheduleNext = () => {
      this.syncTimer = setTimeout(() => {
        this.syncTimer = null;

        void this.syncConfirmedBlocks('poll')
          .catch((error) => {
            log('ERROR', 'HTTP polling sync failed', normalizeError(error));
          })
          .finally(() => {
            if (this.isStarted) {
              scheduleNext();
            }
          });
      }, this.getCurrentSyncIntervalMs());
    };

    scheduleNext();
  },

  startIntegrityChecks() {
    if (this.integrityTimer) {
      return;
    }

    const scheduleNext = () => {
      this.integrityTimer = setTimeout(() => {
        this.integrityTimer = null;

        void this.verifyIntegrity().finally(() => {
          if (this.isStarted) {
            scheduleNext();
          }
        });
      }, INTEGRITY_INTERVAL_MS);
    };

    scheduleNext();
  },

  clearWsReconnectTimer() {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
  },

  disposeWsProvider() {
    if (!this.wsProvider) {
      return;
    }

    this.wsProvider.removeAllListeners();

    const transport = getWsTransport(this.wsProvider);
    transport?.removeAllListeners?.();
    transport?.terminate?.();
    transport?.close?.();

    this.wsProvider.destroy();
    this.wsProvider = null;
  },

  scheduleWsReconnect(reason: string, error?: unknown) {
    this.status.wsConnected = false;
    this.setMode('http-polling');
    this.disposeWsProvider();

    if (error) {
      this.status.lastWsError = {
        message: normalizeError(error).message,
        at: new Date().toISOString(),
      };
    }

    if (this.wsReconnectTimer || !this.isStarted || !this.status.wsConfigured) {
      return;
    }

    this.status.wsReconnectAttempts += 1;

    log('WARN', 'Indexer websocket disconnected; scheduling reconnect', {
      reason,
      reconnectInMs: WS_RECONNECT_DELAY_MS,
      reconnectAttempts: this.status.wsReconnectAttempts,
      error: error ? normalizeError(error) : undefined,
    });

    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      void this.connectWebSocketProvider();
    }, WS_RECONNECT_DELAY_MS);
  },

  async connectWebSocketProvider() {
    if (!this.status.wsConfigured) {
      this.setMode('http-polling');
      log('WARN', 'Indexer websocket URL is not configured; using HTTP polling only');
      return;
    }

    this.disposeWsProvider();

    const provider = celoService.createWebSocketProvider();
    if (!provider) {
      this.setMode('http-polling');
      return;
    }

    this.wsProvider = provider;

    provider.on('block', (blockNumber) => {
      this.status.wsConnected = true;
      this.status.lastWsConnectedAt = this.status.lastWsConnectedAt ?? new Date().toISOString();
      this.setMode('websocket');
      this.status.currentBlock = blockNumber;
      this.status.confirmedBlock = blockNumber - CONFIRMATIONS >= 0 ? blockNumber - CONFIRMATIONS : null;

      void this.syncConfirmedBlocks('websocket:block').catch((error) => {
        log('ERROR', 'Websocket-triggered sync failed', normalizeError(error));
      });
    });

    const transport = getWsTransport(provider);

    transport?.on?.('open', () => {
      this.status.wsConnected = true;
      this.status.lastWsConnectedAt = new Date().toISOString();
      this.status.wsReconnectAttempts = 0;
      this.setMode('websocket');

      log('INFO', 'Indexer websocket connected', {
        reconnectDelayMs: WS_RECONNECT_DELAY_MS,
      });
    });

    transport?.on?.('close', () => {
      this.scheduleWsReconnect('close');
    });

    transport?.on?.('error', (error: unknown) => {
      this.scheduleWsReconnect('error', error);
    });

    void this.syncConfirmedBlocks('websocket:connect').catch((error) => {
      log('ERROR', 'Initial websocket sync failed', normalizeError(error));
    });
  },

  async getStatus() {
    try {
      const latestBlock = await celoService.getHttpProvider().getBlockNumber();
      this.status.currentBlock = latestBlock;
      this.status.confirmedBlock = latestBlock - CONFIRMATIONS >= 0 ? latestBlock - CONFIRMATIONS : null;
      await this.refreshLag();
    } catch (error) {
      this.status.lastSyncError = {
        message: `Status refresh failed: ${normalizeError(error).message}`,
        at: new Date().toISOString(),
      };
    }

    const alerts: IndexerAlert[] = [];
    const now = Date.now();

    if (this.status.lagBlocks !== null && this.status.lagBlocks > ALERT_LAG_BLOCKS) {
      alerts.push({
        level: 'warn',
        code: 'LAG_HIGH',
        message: `Indexer lag is ${this.status.lagBlocks} blocks, above alert threshold ${ALERT_LAG_BLOCKS}.`,
      });
    }

    if (this.status.recoveryMode === 'backfill') {
      alerts.push({
        level: 'warn',
        code: 'BACKFILL_MODE',
        message: 'Indexer is in accelerated backfill recovery mode.',
      });
    }

    if (this.status.lastSyncCompletedAt) {
      const lastSyncAgeMs = now - new Date(this.status.lastSyncCompletedAt).getTime();
      if (lastSyncAgeMs > ALERT_SYNC_STALE_MS) {
        alerts.push({
          level: 'warn',
          code: 'SYNC_STALE',
          message: `Last successful sync is stale by ${lastSyncAgeMs}ms.`,
        });
      }
    } else if (this.status.started) {
      alerts.push({
        level: 'warn',
        code: 'SYNC_NOT_COMPLETED',
        message: 'Indexer has not completed a successful sync yet.',
      });
    }

    if (this.status.lastSyncError) {
      alerts.push({
        level: 'error',
        code: 'SYNC_ERROR',
        message: this.status.lastSyncError.message,
      });
    }

    if (this.status.consecutiveSyncFailures >= FAILURE_THRESHOLD) {
      alerts.push({
        level: 'error',
        code: 'REPEATED_FAILURES',
        message: `Indexer has ${this.status.consecutiveSyncFailures} consecutive sync failures.`,
      });
    }

    if (this.status.wsConfigured && !this.status.wsConnected) {
      alerts.push({
        level: 'warn',
        code: 'WS_FALLBACK_ACTIVE',
        message: 'WebSocket feed is disconnected; HTTP polling fallback is active.',
      });
    }

    if (this.status.integrityLastError) {
      alerts.push({
        level: 'error',
        code: 'INTEGRITY_ERROR',
        message: this.status.integrityLastError.message,
      });
    }

    const overallStatus = alerts.some((alert) => alert.level === 'error')
      ? 'error'
      : alerts.length > 0
        ? 'degraded'
        : 'ok';

    return {
      status: overallStatus,
      started: this.status.started,
      mode: this.status.mode,
      recoveryMode: this.status.recoveryMode,
      confirmations: CONFIRMATIONS,
      safetyMargin: SAFETY_MARGIN,
      alerts,
      ws: {
        configured: this.status.wsConfigured,
        connected: this.status.wsConnected,
        reconnectAttempts: this.status.wsReconnectAttempts,
        lastConnectedAt: this.status.lastWsConnectedAt,
        lastError: this.status.lastWsError,
      },
      sync: {
        currentBlock: this.status.currentBlock,
        confirmedBlock: this.status.confirmedBlock,
        storedCheckpointBlock: this.status.storedCheckpointBlock,
        lastProcessedBlock: this.status.lastProcessedBlock,
        nextSyncFromBlock: this.status.nextSyncFromBlock,
        lagBlocks: this.status.lagBlocks,
        lastReorgAt: this.status.lastReorgAt,
        lastReorgRollbackBlock: this.status.lastReorgRollbackBlock,
        reorgRollbackCount: this.status.reorgRollbackCount,
        consecutiveFailures: this.status.consecutiveSyncFailures,
        lastStartedAt: this.status.lastSyncStartedAt,
        lastCompletedAt: this.status.lastSyncCompletedAt,
        lastReason: this.status.lastSyncReason,
        lastError: this.status.lastSyncError,
      },
      polling: {
        syncIntervalMs: this.status.effectiveSyncIntervalMs,
        normalSyncIntervalMs: SYNC_POLL_INTERVAL_MS,
        recoverySyncIntervalMs: RECOVERY_POLLING_INTERVAL_MS,
        pendingTransactionIntervalMs: PENDING_TX_POLL_INTERVAL_MS,
        maxBlocksPerQuery: MAX_BLOCKS_PER_QUERY,
        reorgCheckWindow: REORG_CHECK_WINDOW,
        integrityIntervalMs: INTEGRITY_INTERVAL_MS,
      },
      integrity: {
        lastCheckedAt: this.status.integrityLastCheckedAt,
        lastError: this.status.integrityLastError,
        lastSuccess: this.status.integrityLastSuccess,
      },
      timestamp: new Date().toISOString(),
    };
  },

  async waitForDatabase(maxWaitMs = 30_000, pollIntervalMs = 1_000): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const db = getDatabaseStatus();
      if (db.isReady) {
        return true;
      }

      log('INFO', 'Contract indexer waiting for database to become ready', {
        phase: db.phase,
        attempts: db.attempts,
        remainingMs: deadline - Date.now(),
      });

      await sleep(pollIntervalMs);
    }

    return getDatabaseStatus().isReady;
  },

  async start() {
    if (this.isStarted) {
      return;
    }

    this.isStarted = true;
    this.status.started = true;

    // Validate Celo RPC configuration before attempting any chain calls.
    const rpcUrl = config.celo.rpcUrl;
    if (!rpcUrl || rpcUrl === 'https://forno.celo.org') {
      log('WARN', 'CELO_RPC_URL is not explicitly set; using public fallback endpoint (forno.celo.org). Set CELO_RPC_URL for a dedicated RPC node.', {
        rpcUrl,
      });
    }

    if (!config.celo.withdrawPrivateKey) {
      log('WARN', 'CELO_WITHDRAW_PRIVATE_KEY is not set; withdrawal functionality will be unavailable.');
    }

    // Ensure the database is ready before touching any DB models.
    const dbReady = await this.waitForDatabase(30_000);
    if (!dbReady) {
      log('ERROR', 'Contract indexer could not start: database is not ready after 30s. Polling will retry.', {
        dbPhase: getDatabaseStatus().phase,
      });
      // Still start polling so the indexer recovers once the DB comes up.
      this.startPollingPendingTransactions();
      this.startSyncPolling();
      this.startIntegrityChecks();
      return;
    }

    // Load the last-processed-block checkpoint from the DB.
    try {
      await this.initializeCheckpointWindow();
    } catch (error) {
      log('ERROR', 'Contract indexer failed to load checkpoint from DB; will start from configured start block', {
        ...normalizeError(error),
        configuredStartBlock: config.celo.eventIndexerStartBlock,
      });
      // Leave nextSyncFromBlock as null — syncConfirmedBlocks will fall back to eventIndexerStartBlock.
    }

    // Run an initial sync. Errors are caught and recorded inside syncConfirmedBlocks.
    await this.syncConfirmedBlocks('startup');

    await this.connectWebSocketProvider();

    this.startPollingPendingTransactions();
    this.startSyncPolling();
    this.startIntegrityChecks();

    log('INFO', 'Contract indexer started', {
      contractAddresses: indexedContracts.map((contract) => contract.address),
      confirmations: CONFIRMATIONS,
      safetyMargin: SAFETY_MARGIN,
      syncPollIntervalMs: SYNC_POLL_INTERVAL_MS,
      websocketConfigured: this.status.wsConfigured,
      resumeFromBlock: this.status.nextSyncFromBlock,
    });
  },

  async stop() {
    this.clearWsReconnectTimer();
    this.disposeWsProvider();

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.integrityTimer) {
      clearTimeout(this.integrityTimer);
      this.integrityTimer = null;
    }

    this.status.started = false;
    this.status.wsConnected = false;
    this.setMode('http-polling');
    this.setRecoveryMode('normal');
    this.isStarted = false;
  },
};

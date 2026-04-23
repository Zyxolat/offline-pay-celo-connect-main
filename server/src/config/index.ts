import dotenv from 'dotenv';
import path from 'path';
import { log } from '../utils/logger.js';

const serverRoot = path.join(__dirname, '../..');

dotenv.config({ path: path.join(serverRoot, '.env') });

type DatabaseConfig = {
  url?: string;
  ssl: boolean;
  source: 'database_url' | 'local';
  local?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };
};

type IndexedContractConfig = {
  address: string;
  abiVersion: string;
};

const configWarnings: string[] = [];
const configErrors: string[] = [];

function warnConfig(message: string, meta?: Record<string, unknown>) {
  configWarnings.push(message);
  log('WARN', message, meta);
}

function failConfig(message: string, meta?: Record<string, unknown>): never {
  configErrors.push(message);
  log('ERROR', message, meta);
  throw new Error(message);
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function deriveWebSocketUrl(value: string): string | undefined {
  if (value.startsWith('https://')) {
    return `wss://${value.slice('https://'.length)}`;
  }

  if (value.startsWith('http://')) {
    return `ws://${value.slice('http://'.length)}`;
  }

  return undefined;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function requireEnv(name: string, options: { allowInDevFallback?: string } = {}): string {
  const value = process.env[name]?.trim();

  if (value) {
    return value;
  }

  if (!isProduction() && options.allowInDevFallback !== undefined) {
    return options.allowInDevFallback;
  }

  return failConfig(`Missing required environment variable ${name}`, {
    environment: process.env.NODE_ENV || 'development',
  });
}

function getOptionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function parseIndexedContracts(fallbackAddress: string): IndexedContractConfig[] {
  const rawContracts = getOptionalEnv('CELO_TIMELOCK_CONTRACTS');

  if (!rawContracts) {
    return [{ address: fallbackAddress, abiVersion: 'v1' }];
  }

  const contracts = rawContracts
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [address, abiVersion = 'v1'] = entry.split('@').map((part) => part.trim());
      return {
        address,
        abiVersion: abiVersion || 'v1',
      };
    });

  return contracts.length > 0 ? contracts : [{ address: fallbackAddress, abiVersion: 'v1' }];
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function tryParseOrigin(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function parseOrigin(name: string, value: string, options: { requireHttpsInProduction?: boolean } = {}) {
  const normalized = normalizeOrigin(value);
  const parsed = tryParseOrigin(normalized);

  if (!parsed) {
    return failConfig(`${name} must be a valid absolute URL`, {
      value,
    });
  }

  if (options.requireHttpsInProduction && isProduction() && parsed.protocol !== 'https:') {
    return failConfig(`${name} must use https:// in production`, {
      value: normalized,
    });
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return failConfig(`${name} must not include a path, query string, or hash`, {
      value: normalized,
    });
  }

  return parsed;
}

function getFrontendOrigins() {
  const frontendUrl = requireEnv('FRONTEND_URL', {
    allowInDevFallback: 'http://localhost:5173',
  });
  const parsedOrigins = frontendUrl
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => parseOrigin('FRONTEND_URL', origin, { requireHttpsInProduction: true }));

  const uniqueOrigins = [...new Set(parsedOrigins.map((origin) => origin.origin))];

  if (isProduction() && uniqueOrigins.length !== 1) {
    failConfig('FRONTEND_URL must contain exactly one production frontend origin', {
      configuredOrigins: uniqueOrigins,
    });
  }

  return uniqueOrigins;
}

function getJwtSecret() {
  return requireEnv('JWT_SECRET');
}

function getAdminEmail() {
  const email = requireEnv('ADMIN_EMAIL', {
    allowInDevFallback: 'admin@offlinepay.local',
  });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    failConfig('ADMIN_EMAIL must be a valid email address', {
      value: email,
    });
  }

  return email;
}

function getAdminPassword() {
  const passwordHash = requireEnv('ADMIN_PASSWORD_HASH', {
    allowInDevFallback: '$2b$10$W9B3Jx7g5Q7eY8J9W6s4rOzO5A1mV6M0M6GgY8tXxYJ4YgA1rD2hK',
  });

  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
    failConfig('ADMIN_PASSWORD_HASH must be a valid bcrypt hash');
  }

  return passwordHash;
}

function getAllowedAdminIps() {
  const rawValue = getOptionalEnv('ADMIN_ALLOWED_IPS');
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
}

function parseDatabaseUrl(value: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return failConfig('DATABASE_URL must be a valid Postgres connection string', {
      valuePreview: value.slice(0, 30),
    });
  }

  if (!/^postgres(ql)?:$/i.test(parsed.protocol)) {
    return failConfig('DATABASE_URL must use the postgres:// or postgresql:// protocol', {
      protocol: parsed.protocol,
    });
  }

  return parsed;
}

function getDatabaseConfig(): DatabaseConfig {
  const databaseUrl = getOptionalEnv('DATABASE_URL');

  if (isProduction()) {
    const requiredUrl = requireEnv('DATABASE_URL');
    const parsed = parseDatabaseUrl(requiredUrl);

    if (/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) {
      failConfig('DATABASE_URL cannot point to localhost in production', {
        hostname: parsed.hostname,
      });
    }

    return {
      url: requiredUrl,
      ssl: true,
      source: 'database_url',
    };
  }

  if (databaseUrl) {
    parseDatabaseUrl(databaseUrl);
    return {
      url: databaseUrl,
      ssl: false,
      source: 'database_url',
    };
  }

  return {
    ssl: false,
    source: 'local',
    local: {
      host: process.env.PGHOST?.trim() || process.env.DB_HOST?.trim(),
      port: process.env.PGPORT || process.env.DB_PORT
        ? parsePort(process.env.PGPORT || process.env.DB_PORT, 5432)
        : undefined,
      user: process.env.PGUSER?.trim() || process.env.DB_USER?.trim(),
      password: process.env.PGPASSWORD ?? process.env.DB_PASSWORD,
      database: process.env.PGDATABASE?.trim() || process.env.DB_NAME?.trim(),
    },
  };
}

const frontendOrigins = getFrontendOrigins();
const primaryFrontendOrigin = frontendOrigins[0];
const frontendOriginUrl = parseOrigin('FRONTEND_URL', primaryFrontendOrigin, {
  requireHttpsInProduction: true,
});
const webauthnOriginValue = requireEnv('WEBAUTHN_ORIGIN', {
  allowInDevFallback: primaryFrontendOrigin,
});
const webauthnOriginUrl = parseOrigin('WEBAUTHN_ORIGIN', webauthnOriginValue, {
  requireHttpsInProduction: true,
});
const webauthnRpId = requireEnv('WEBAUTHN_RP_ID', {
  allowInDevFallback: frontendOriginUrl.hostname,
});

if (webauthnOriginUrl.origin !== frontendOriginUrl.origin) {
  failConfig('WEBAUTHN_ORIGIN must exactly match FRONTEND_URL origin', {
    frontendOrigin: frontendOriginUrl.origin,
    webauthnOrigin: webauthnOriginUrl.origin,
  });
}

if (webauthnRpId !== frontendOriginUrl.hostname) {
  failConfig('WEBAUTHN_RP_ID must exactly match the frontend hostname', {
    expectedRpId: frontendOriginUrl.hostname,
    configuredRpId: webauthnRpId,
  });
}

const port = isProduction()
  ? parsePort(requireEnv('PORT'), 0)
  : parsePort(process.env.PORT, 3001);
const databaseConfig = getDatabaseConfig();

export const config = {
  port,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: databaseConfig,

  jwt: {
    secret: getJwtSecret(),
    expiry: process.env.JWT_EXPIRY || '1h',
  },

  admin: {
    email: getAdminEmail(),
    passwordHash: getAdminPassword(),
    allowedIps: getAllowedAdminIps(),
  },
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME || 'OfflinePay',
    rpID: webauthnRpId,
    origin: webauthnOriginUrl.origin,
  },

  celo: {
    network: process.env.CELO_NETWORK || 'mainnet',
    rpcUrl: process.env.CELO_RPC_URL || 'https://forno.celo.org',
    wsRpcUrl:
      getOptionalEnv('CELO_WS_RPC_URL') ||
      deriveWebSocketUrl(process.env.CELO_RPC_URL || 'https://forno.celo.org'),
    chainId: parseInt(process.env.CELO_CHAIN_ID || '42220', 10),
    cUSDAddress: process.env.CELO_CUSD_ADDRESS || '0x765DE816845861e75A25fCA122bb6bAA3c1E852a',
    withdrawPrivateKey: process.env.CELO_WITHDRAW_PRIVATE_KEY || '',
    timeLockContractAddress:
      process.env.CELO_TIMELOCK_CONTRACT_ADDRESS ||
      process.env.VITE_TIMELOCK_CONTRACT_ADDRESS ||
      '0x72D90d16A798095b6fC29eCf71867A87729acC31',
    timeLockContracts: parseIndexedContracts(
      process.env.CELO_TIMELOCK_CONTRACT_ADDRESS ||
      process.env.VITE_TIMELOCK_CONTRACT_ADDRESS ||
      '0x72D90d16A798095b6fC29eCf71867A87729acC31'
    ),
    eventIndexerStartBlock: parsePositiveInt(process.env.CELO_EVENT_INDEXER_START_BLOCK, 0),
    eventIndexerConfirmations: parsePositiveInt(process.env.CELO_EVENT_INDEXER_CONFIRMATIONS, 3),
    eventIndexerSafetyMargin: parsePositiveInt(process.env.CELO_EVENT_INDEXER_SAFETY_MARGIN, 10),
    eventIndexerPollingIntervalMs: parsePositiveInt(process.env.CELO_EVENT_INDEXER_POLLING_INTERVAL_MS, 15_000),
    eventIndexerWsReconnectDelayMs: parsePositiveInt(process.env.CELO_EVENT_INDEXER_WS_RECONNECT_DELAY_MS, 5_000),
    eventIndexerMaxBlocksPerQuery: parsePositiveInt(process.env.CELO_EVENT_INDEXER_MAX_BLOCKS_PER_QUERY, 500),
    eventIndexerReorgCheckWindow: parsePositiveInt(process.env.CELO_EVENT_INDEXER_REORG_CHECK_WINDOW, 25),
    eventIndexerAlertLagBlocks: parsePositiveInt(process.env.CELO_EVENT_INDEXER_ALERT_LAG_BLOCKS, 20),
    eventIndexerAlertSyncStaleMs: parsePositiveInt(process.env.CELO_EVENT_INDEXER_ALERT_SYNC_STALE_MS, 120_000),
    eventIndexerRecoveryPollingIntervalMs: parsePositiveInt(process.env.CELO_EVENT_INDEXER_RECOVERY_POLLING_INTERVAL_MS, 5_000),
    eventIndexerFailureThreshold: parsePositiveInt(process.env.CELO_EVENT_INDEXER_FAILURE_THRESHOLD, 3),
    eventIndexerIntegrityIntervalMs: parsePositiveInt(process.env.CELO_EVENT_INDEXER_INTEGRITY_INTERVAL_MS, 300_000),
    eventIndexerIntegritySampleSize: parsePositiveInt(process.env.CELO_EVENT_INDEXER_INTEGRITY_SAMPLE_SIZE, 5),
    eventIndexerIntegrityLookbackBlocks: parsePositiveInt(process.env.CELO_EVENT_INDEXER_INTEGRITY_LOOKBACK_BLOCKS, 250),
  },

  frontend: {
    url: frontendOriginUrl.origin,
    allowedOrigins: frontendOrigins,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  validation: {
    criticalEnvLoaded: configErrors.length === 0,
    warnings: [...configWarnings],
  },
};

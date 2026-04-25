import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/index';
import { closeDatabasePool, connectDatabaseWithRetry, getDatabaseStatus } from './config/database';
import { limiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { log, normalizeError } from './utils/logger';

import authRoutes from './routes/auth';
import walletRoutes from './routes/wallet';
import paymentRoutes from './routes/payments';
import queueRoutes from './routes/queue';
import transactionRoutes from './routes/transactions';
import adminRoutes from './routes/admin';
import { contractIndexerService } from './services/contractIndexerService';
import { getCurrentRpc, getRpcHealth } from './lib/provider';

const app = express();
const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const HOST = '0.0.0.0';
const FALLBACK_PORT = 3001;

const allowedOrigins = new Set(config.frontend.allowedOrigins);
let isShuttingDown = false;
let server: Server | null = null;
let hasRegisteredGlobalErrorHandlers = false;
let hasStartedServer = false;

app.set('trust proxy', 1);

app.get('/ping', (_req: Request, res: Response) => {
  res.status(200).send('pong');
});

app.get('/health', async (_req: Request, res: Response) => {
  const database = getDatabaseStatus();
  let rpc: Awaited<ReturnType<typeof getRpcHealth>> | { rpcUrl: string | null; latestBlock: null; chainId: null; error: string };

  try {
    rpc = await getRpcHealth();
  } catch (error) {
    rpc = {
      rpcUrl: getCurrentRpc(),
      latestBlock: null,
      chainId: null,
      error: normalizeError(error).message,
    };
  }

  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    db: database.phase,
    rpc,
    timestamp: new Date().toISOString(),
  });
});

app.get('/status', async (_req: Request, res: Response) => {
  const database = getDatabaseStatus();
  let rpc: Awaited<ReturnType<typeof getRpcHealth>> | { rpcUrl: string | null; latestBlock: null; chainId: null; error: string };

  try {
    rpc = await getRpcHealth();
  } catch (error) {
    rpc = {
      rpcUrl: getCurrentRpc(),
      latestBlock: null,
      chainId: null,
      error: normalizeError(error).message,
    };
  }

  res.status(200).json({
    app: {
      status: 'ok',
      environment: config.nodeEnv,
      uptime: process.uptime(),
      shuttingDown: isShuttingDown,
    },
    db: {
      phase: database.phase,
      isReady: database.isReady,
      isConnecting: database.isConnecting,
      attempts: database.attempts,
      circuitState: database.circuitState,
      lastConnectedAt: database.lastConnectedAt,
      cooldownUntil: database.cooldownUntil,
      lastError: database.lastError,
    },
    rpc,
    timestamp: new Date().toISOString(),
  });
});

app.get('/rpc/health', async (_req: Request, res: Response) => {
  try {
    const rpc = await getRpcHealth();
    res.status(200).json({
      status: 'ok',
      rpc,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      rpc: {
        rpcUrl: getCurrentRpc(),
        latestBlock: null,
        chainId: null,
        error: normalizeError(error).message,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/indexer/status', async (_req: Request, res: Response) => {
  const database = getDatabaseStatus();
  const indexer = await contractIndexerService.getStatus();

  res.status(indexer.status === 'ok' ? 200 : 503).json({
    indexer,
    db: {
      phase: database.phase,
      isReady: database.isReady,
      lastConnectedAt: database.lastConnectedAt,
      lastError: database.lastError,
    },
  });
});

app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'offlinepay-backend',
    environment: config.nodeEnv,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use(helmet());

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const isConfiguredOrigin = allowedOrigins.has(origin.replace(/\/+$/, ''));
    const isLocalDevOrigin =
      config.nodeEnv !== 'production' && localhostOriginPattern.test(origin);

    if (isConfiguredOrigin || isLocalDevOrigin) {
      return callback(null, true);
    }

    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
  optionsSuccessStatus: 200,
}));

// Handle OPTIONS preflight for all routes
app.options('*', cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const isConfiguredOrigin = allowedOrigins.has(origin.replace(/\/+$/, ''));
    const isLocalDevOrigin =
      config.nodeEnv !== 'production' && localhostOriginPattern.test(origin);
    if (isConfiguredOrigin || isLocalDevOrigin) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
  optionsSuccessStatus: 200,
}));

// Request logger middleware
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id']?.toString() || crypto.randomUUID();
  const start = Date.now();
  let responseStarted = false;
  const logResponseStart = () => {
    if (responseStarted) {
      return;
    }

    responseStarted = true;
    log('INFO', 'HTTP response started', {
      requestId,
      method: req.method,
      route: req.originalUrl,
      statusCode: res.statusCode,
      latencyMs: Date.now() - start,
    });
  };
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = ((...args: Parameters<Response['writeHead']>) => {
    logResponseStart();
    return originalWriteHead(...args);
  }) as Response['writeHead'];

  res.setHeader('x-request-id', requestId);
  res.locals.requestId = requestId;

  log('INFO', 'HTTP request received', {
    requestId,
    method: req.method,
    route: req.originalUrl,
    timestamp: new Date(start).toISOString(),
  });

  res.on('finish', () => {
    const database = getDatabaseStatus();
    log('INFO', 'HTTP request completed', {
      requestId,
      method: req.method,
      route: req.originalUrl,
      statusCode: res.statusCode,
      latencyMs: Date.now() - start,
      dbStatus: database.phase,
    });
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      log('WARN', 'HTTP request closed before response finished', {
        requestId,
        method: req.method,
        route: req.originalUrl,
        latencyMs: Date.now() - start,
      });
    }
  });

  next();
});

// Logging
app.use(morgan('combined'));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/ready', (req: Request, res: Response) => {
  const database = getDatabaseStatus();
  const ready = config.validation.criticalEnvLoaded && database.isReady;

  res.status(ready ? 200 : 503).json({
    db: ready ? 'connected' : database.isConnecting ? 'connecting' : 'failed',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Rate limiting
app.use('/api', limiter);

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const database = getDatabaseStatus();

  if (!database.isReady) {
    res.setHeader('x-service-state', 'warming-up');
    return res.status(503).json({
      success: false,
      error: 'Database is warming up. Try again shortly.',
      db: {
        phase: database.phase,
        isConnecting: database.isConnecting,
        attempts: database.attempts,
      },
    });
  }

  next();
});

// Routes
// Auth routes are mounted at both /auth and /api/auth.
// Google OAuth callback URL (GOOGLE_CALLBACK_URL env var) must point to
// <backend-url>/auth/google/callback or <backend-url>/api/auth/google/callback.
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/admin', adminRoutes);

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
  });
});

// Error handler
app.use(errorHandler);

const PORT = Number(process.env.PORT || config.port || FALLBACK_PORT || 3000);
const serverBootstrapState = globalThis as typeof globalThis & {
  __server_started__?: boolean;
};

function isMissingRelationError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '42P01';
}

function registerGlobalErrorHandlers() {
  if (hasRegisteredGlobalErrorHandlers) {
    return;
  }

  hasRegisteredGlobalErrorHandlers = true;
  process.on('uncaughtException', (error) => {
    log('ERROR', 'Uncaught exception', normalizeError(error));
  });
  process.on('unhandledRejection', (reason) => {
    log('ERROR', 'Unhandled promise rejection', normalizeError(reason));
  });
}

export function startServer() {
  if (hasStartedServer) {
    return server;
  }

  hasStartedServer = true;

  log('INFO', 'Starting API server', {
    host: HOST,
    port: PORT,
    environment: config.nodeEnv,
    frontendOrigin: config.frontend.url,
    webauthnOrigin: config.webauthn.origin,
    webauthnRpId: config.webauthn.rpID,
  });

  server = app.listen(PORT, '0.0.0.0', () => {
    log('INFO', 'API server is listening', {
      host: HOST,
      port: PORT,
      environment: config.nodeEnv,
      celoNetwork: config.celo.network,
    });

    void (async () => {
      try {
        await connectDatabaseWithRetry();
      } catch (error) {
        if (isMissingRelationError(error)) {
          log('ERROR', 'Database not initialized. Run npm run migrate', {
            ...normalizeError(error),
            action: 'npm run migrate',
          });
          return;
        }

        log('ERROR', 'DB connection failed', normalizeError(error));
        return;
      }

      try {
        await contractIndexerService.start();
      } catch (error) {
        // contractIndexerService.start() is designed to be non-throwing — sync
        // errors are caught internally and recorded in indexer status. This
        // catch is a last-resort safety net so an unexpected error here does
        // not surface as a misleading "DB connection failed" message.
        log('ERROR', 'Contract indexer failed to start', normalizeError(error));
      }
    })();
  });

  server.keepAliveTimeout = 60_000;
  server.headersTimeout = 65_000;
  server.requestTimeout = 60_000;
  server.timeout = 60_000;

  server.on('timeout', () => {
    log('WARN', 'HTTP server timed out a request');
  });

  server.on('error', (error) => {
    log('ERROR', 'HTTP server failed to start', normalizeError(error));

    process.exit(1);
  });

  return server;
}

// Graceful shutdown
async function shutdown(signal: 'SIGTERM' | 'SIGINT') {
  if (isShuttingDown) return;

  isShuttingDown = true;

  log('INFO', 'Shutdown initiated', {
    signal,
    uptimeSeconds: process.uptime(),
  });

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) return reject(error);
          resolve();
        });
      });

      log('INFO', 'HTTP server closed');
    }

    await closeDatabasePool();
    await contractIndexerService.stop();
    log('INFO', 'Shutdown completed successfully');
    process.exit(0);
  } catch (error) {
    log('ERROR', 'Shutdown failed', normalizeError(error));

    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

function shouldAutoStart() {
  return require.main === module;
}

export function bootServer() {
  registerGlobalErrorHandlers();

  if (serverBootstrapState.__server_started__) {
    log('WARN', 'Server already started; skipping duplicate init');
    return server;
  }

  serverBootstrapState.__server_started__ = true;
  return startServer();
}

if (shouldAutoStart()) {
  bootServer();
}

export default app;

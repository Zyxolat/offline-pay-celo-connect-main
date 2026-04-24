import { JsonRpcProvider } from 'ethers';

const CELO_MAINNET_CHAIN_ID = 42220n;
const RPC_TIMEOUT_MS = 6_000;
const ALCHEMY_MAINNET_RPC_PATTERN = /^https:\/\/celo-mainnet\.g\.alchemy\.com\/v2\/[^/]+$/i;

if (!process.env.CELO_RPC_URL) throw new Error('Missing CELO_RPC_URL');

const RPC_URLS = [
  process.env.CELO_RPC_URL.trim(),
  'https://forno.celo.org',
  'https://rpc.ankr.com/celo',
].filter((url, index, values): url is string => Boolean(url) && values.indexOf(url) === index);

if (!ALCHEMY_MAINNET_RPC_PATTERN.test(RPC_URLS[0] ?? '')) {
  throw new Error('CELO_RPC_URL must point to https://celo-mainnet.g.alchemy.com/v2/<key>');
}

type ProviderState = {
  url: string;
  provider: JsonRpcProvider;
  chainId: bigint;
  blockNumber: number;
  initializedAt: string;
};

let cachedProviderState: ProviderState | null = null;
let providerInitializationPromise: Promise<ProviderState> | null = null;
let currentRpcIndex = 0;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`RPC timeout after ${timeoutMs}ms during ${label}`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function isRateLimitError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? String((error as { status?: unknown }).status ?? '')
    : '';

  return (
    code === '429' ||
    status === '429' ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  );
}

function isTimeoutError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';

  return (
    code === 'TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    message.includes('timeout') ||
    message.includes('timed out')
  );
}

function isConnectionError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';

  return (
    code === 'SERVER_ERROR' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    message.includes('network error') ||
    message.includes('failed to fetch') ||
    message.includes('socket hang up') ||
    message.includes('connection refused') ||
    message.includes('connect timeout')
  );
}

function shouldFailover(error: unknown) {
  return isRateLimitError(error) || isTimeoutError(error) || isConnectionError(error);
}

function destroyProvider(state: ProviderState | null) {
  if (!state) {
    return;
  }

  try {
    state.provider.destroy();
  } catch {
    // ignore provider teardown errors
  }
}

function invalidateProvider(url?: string) {
  if (!cachedProviderState) {
    return;
  }

  if (url && cachedProviderState.url !== url) {
    return;
  }

  destroyProvider(cachedProviderState);
  cachedProviderState = null;
}

async function validateProvider(url: string): Promise<ProviderState> {
  const provider = new JsonRpcProvider(url);
  const network = await withTimeout(provider.getNetwork(), `getNetwork(${url})`);

  if (network.chainId !== CELO_MAINNET_CHAIN_ID) {
    destroyProvider({
      url,
      provider,
      chainId: network.chainId,
      blockNumber: -1,
      initializedAt: new Date().toISOString(),
    });
    throw new Error(`Rejected RPC ${url}: expected chainId 42220, received ${network.chainId.toString()}`);
  }

  const blockNumber = await withTimeout(provider.getBlockNumber(), `getBlockNumber(${url})`);
  const state: ProviderState = {
    url,
    provider,
    chainId: network.chainId,
    blockNumber,
    initializedAt: new Date().toISOString(),
  };

  console.log('[CELO RPC] Initialized provider', {
    rpcUrl: state.url,
    chainId: state.chainId.toString(),
    blockNumber: state.blockNumber,
  });

  return state;
}

async function initializeProvider(startIndex = currentRpcIndex): Promise<ProviderState> {
  let lastError: unknown = null;

  for (let offset = 0; offset < RPC_URLS.length; offset += 1) {
    const index = (startIndex + offset) % RPC_URLS.length;
    const url = RPC_URLS[index];

    try {
      const state = await validateProvider(url);
      invalidateProvider();
      cachedProviderState = state;
      currentRpcIndex = index;
      return state;
    } catch (error) {
      lastError = error;
      console.warn('[CELO RPC] Provider validation failed', {
        rpcUrl: url,
        reason: getErrorMessage(error),
      });
    }
  }

  throw new Error(`All CELO mainnet RPC endpoints failed: ${getErrorMessage(lastError)}`);
}

async function ensureProvider(startIndex = currentRpcIndex) {
  if (cachedProviderState) {
    return cachedProviderState;
  }

  if (!providerInitializationPromise) {
    providerInitializationPromise = initializeProvider(startIndex).finally(() => {
      providerInitializationPromise = null;
    });
  }

  return providerInitializationPromise;
}

async function failoverFrom(url: string, error: unknown) {
  const failedIndex = Math.max(0, RPC_URLS.indexOf(url));
  const nextIndex = (failedIndex + 1) % RPC_URLS.length;

  console.warn('[CELO RPC] Switching provider', {
    from: url,
    to: RPC_URLS[nextIndex],
    reason: getErrorMessage(error),
  });

  invalidateProvider(url);
  currentRpcIndex = nextIndex;
}

export async function getProvider() {
  const state = await ensureProvider();
  return state.provider;
}

export function getCurrentRpc() {
  return cachedProviderState?.url ?? null;
}

export async function getRpcHealth() {
  const state = await ensureProvider();
  const latestBlock = await safeRpc((provider) => provider.getBlockNumber());
  const activeState = cachedProviderState ?? state;

  return {
    rpcUrl: activeState.url,
    chainId: Number(activeState.chainId),
    latestBlock,
    initializedAt: activeState.initializedAt,
  };
}

export async function safeRpc<T>(fn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < RPC_URLS.length; attempt += 1) {
    const state = await ensureProvider();

    try {
      return await withTimeout(fn(state.provider), `rpc:${state.url}`);
    } catch (error) {
      lastError = error;

      if (!shouldFailover(error)) {
        throw error;
      }

      if (isRateLimitError(error)) {
        invalidateProvider(state.url);
      }

      await failoverFrom(state.url, error);
    }
  }

  throw new Error(`All CELO mainnet RPC endpoints failed: ${getErrorMessage(lastError)}`);
}

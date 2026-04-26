function getViteEnv(name: keyof ImportMetaEnv) {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isRootRelativeUrl(value: string) {
  return value.startsWith('/');
}

function isPlaceholderValue(value: string) {
  return /^(your_|replace_|example|changeme)/i.test(value);
}

function normalizeApiBaseUrl(value: string) {
  const normalized = value.replace(/\/+$/, '');
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}

function normalizeApiRootUrl(value: string) {
  return value.replace(/\/api$/, '');
}

function normalizeAbsoluteUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function ensureLeadingSlash(value: string) {
  return value.startsWith('/') ? value : `/${value}`;
}

export function getAppBaseUrl() {
  const configured = getViteEnv('VITE_APP_URL');

  if (configured) {
    if (!isAbsoluteHttpUrl(configured)) {
      throw new Error('VITE_APP_URL must be an absolute http(s) URL.');
    }

    return normalizeAbsoluteUrl(configured);
  }

  if (typeof window !== 'undefined' && window.location.origin) {
    return normalizeAbsoluteUrl(window.location.origin);
  }

  if (import.meta.env.PROD) {
    throw new Error('VITE_APP_URL is required in production.');
  }

  return 'http://localhost:5173';
}

export function getRequiredChainId() {
  const configured = getViteEnv('VITE_CHAIN_ID');

  if (configured && configured !== '42220') {
    throw new Error('VITE_CHAIN_ID must be 42220 for Celo Mainnet.');
  }

  return 42220;
}

export function getApiBaseUrl() {
  const configured = getViteEnv('VITE_API_URL');

  if (configured) {
    if (!isAbsoluteHttpUrl(configured) && !isRootRelativeUrl(configured)) {
      throw new Error('VITE_API_URL must be an absolute http(s) URL or a root-relative path such as /api.');
    }

    return normalizeApiBaseUrl(configured);
  }

  if (import.meta.env.PROD) {
    throw new Error('VITE_API_URL is required in production.');
  }

  return 'http://localhost:3001/api';
}

export function getApiRootUrl() {
  return normalizeApiRootUrl(getApiBaseUrl());
}

export function buildApiUrl(pathname: string) {
  const normalizedPath = ensureLeadingSlash(pathname);
  const apiBaseUrl = getApiBaseUrl();

  if (isAbsoluteHttpUrl(apiBaseUrl)) {
    return new URL(normalizedPath.replace(/^\/+/, ''), `${normalizeApiBaseUrl(apiBaseUrl)}/`).toString();
  }

  return `${normalizeApiBaseUrl(apiBaseUrl)}${normalizedPath}`;
}

export function getGoogleAuthStartUrl(redirectTo = '/dashboard') {
  const url = new URL(
    buildApiUrl('/auth/google'),
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
  );

  url.searchParams.set('redirectTo', redirectTo.startsWith('/') ? redirectTo : '/dashboard');
  return isAbsoluteHttpUrl(getApiBaseUrl()) ? url.toString() : `${url.pathname}${url.search}`;
}

export function getWalletConnectProjectId() {
  const projectId = getViteEnv('VITE_WALLETCONNECT_PROJECT_ID');

  if (projectId && !isPlaceholderValue(projectId)) {
    return projectId;
  }

  throw new Error('VITE_WALLETCONNECT_PROJECT_ID is required and must contain a real Reown project id.');
}

export function getCeloMainnetRpcUrl() {
  const configured = getViteEnv('VITE_CELO_RPC_URL');

  if (configured) {
    if (
      !/^https:\/\/celo-mainnet\.g\.alchemy\.com\/v2\/[^/]+$/i.test(configured) &&
      configured !== 'https://forno.celo.org' &&
      configured !== 'https://rpc.ankr.com/celo'
    ) {
      throw new Error('VITE_CELO_RPC_URL must be a supported Celo Mainnet RPC URL.');
    }

    return configured;
  }

  return 'https://forno.celo.org';
}

export function getTimeLockContractAddress() {
  const configured = getViteEnv('VITE_TIMELOCK_CONTRACT_ADDRESS');

  if (!configured) {
    return null;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(configured)) {
    throw new Error('VITE_TIMELOCK_CONTRACT_ADDRESS must be a valid 0x-prefixed address.');
  }

  return configured;
}

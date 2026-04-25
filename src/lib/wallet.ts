import { ethers } from 'ethers';

export const SUPPORTED_TOKENS = ['CELO', 'cUSD'] as const;
export type SupportedToken = (typeof SUPPORTED_TOKENS)[number];
export const WALLET_TYPE_STORAGE_KEY = 'wallet_type';

export const MINIMUM_TRANSFER_AMOUNTS: Record<SupportedToken, string> = {
  CELO: '0.001',
  cUSD: '0.01',
};

type InjectedEthereumProvider = {
  isMiniPay?: boolean;
  providers?: InjectedEthereumProvider[];
};

export interface MobileWalletEnvironment {
  isMobile: boolean;
  isAndroid: boolean;
  isChromeAndroid: boolean;
  isOpera: boolean;
  isMiniPay: boolean;
  preferWalletConnectModalOnly: boolean;
}

const getInjectedProviders = (): InjectedEthereumProvider[] => {
  if (typeof window === 'undefined' || !window.ethereum) {
    return [];
  }

  const provider = window.ethereum as InjectedEthereumProvider;
  return Array.isArray(provider.providers) && provider.providers.length > 0
    ? provider.providers
    : [provider];
};

export const isInjectedAvailable = () => getInjectedProviders().length > 0;

export const isMiniPay = () => getInjectedProviders().some((provider) => provider.isMiniPay === true);

export const getMobileWalletEnvironment = (): MobileWalletEnvironment => {
  if (typeof navigator === 'undefined') {
    return {
      isMobile: false,
      isAndroid: false,
      isChromeAndroid: false,
      isOpera: false,
      isMiniPay: false,
      preferWalletConnectModalOnly: false,
    };
  }

  const userAgent = navigator.userAgent;
  const android = /Android/i.test(userAgent);
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const opera = /OPR\/|Opera/i.test(userAgent);
  const miniPay = isMiniPay() || /MiniPay/i.test(userAgent);
  const chromeAndroid = android && /Chrome\//i.test(userAgent) && !opera;

  return {
    isMobile: mobile,
    isAndroid: android,
    isChromeAndroid: chromeAndroid,
    isOpera: opera,
    isMiniPay: miniPay,
    preferWalletConnectModalOnly: miniPay,
  };
};

const withEncodedValue = (template: string, placeholder: 'url' | 'uri', value: string) =>
  template
    .replaceAll(`{{${placeholder}}}`, encodeURIComponent(value))
    .replaceAll(`{${placeholder}}`, encodeURIComponent(value))
    .replaceAll(`%7B%7B${placeholder}%7D%7D`, encodeURIComponent(value))
    .replaceAll(`%7B${placeholder}%7D`, encodeURIComponent(value));

export const resolveManualWalletOpenUrl = (
  deepLink: string | undefined,
  currentUrl: string,
  browser = getMobileWalletEnvironment(),
  walletConnectUri?: string | null,
  appBaseUrl?: string,
) => {
  if (!deepLink || browser.preferWalletConnectModalOnly) {
    return null;
  }

  let resolvedDeepLink = deepLink;
  const returnUrl = appBaseUrl || currentUrl;

  if (walletConnectUri && /(?:\{|%7B)(?:\{)?uri(?:\})?(?:\})?/i.test(resolvedDeepLink)) {
    resolvedDeepLink = withEncodedValue(resolvedDeepLink, 'uri', walletConnectUri);
  }

  if (/(?:\{|%7B)(?:\{)?url(?:\})?(?:\})?/i.test(resolvedDeepLink)) {
    resolvedDeepLink = withEncodedValue(resolvedDeepLink, 'url', returnUrl);
  }

  return resolvedDeepLink;
};

export const getLastWalletType = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(WALLET_TYPE_STORAGE_KEY);
};

export const setLastWalletType = (walletType: 'injected' | 'appkit') => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(WALLET_TYPE_STORAGE_KEY, walletType);
};

export const clearLastWalletType = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(WALLET_TYPE_STORAGE_KEY);
};

export function formatWalletAddress(address: string, head = 8, tail = 6) {
  if (!address) {
    return '';
  }

  if (address.length <= head + tail) {
    return address;
  }

  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

export function getMinimumAmount(token: SupportedToken) {
  return MINIMUM_TRANSFER_AMOUNTS[token];
}

export function isAmountBelowMinimum(amount: string, token: SupportedToken) {
  try {
    const parsedAmount = ethers.parseUnits(amount, 18);
    const minimumAmount = ethers.parseUnits(MINIMUM_TRANSFER_AMOUNTS[token], 18);
    return parsedAmount < minimumAmount;
  } catch {
    return true;
  }
}

export function getMinimumAmountError(amount: string, token: SupportedToken) {
  if (!amount) {
    return '';
  }

  return isAmountBelowMinimum(amount, token)
    ? `Minimum ${token} amount is ${MINIMUM_TRANSFER_AMOUNTS[token]} ${token}.`
    : '';
}

export async function copyTextToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard is not available in this environment.');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  const successful = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!successful) {
    throw new Error('Copy is not supported in this browser.');
  }
}

export function buildWalletShareText(address: string) {
  return `Send CELO to my OfflinePay wallet address on Celo Mainnet: ${address}`;
}

export function buildWalletShareLink(address: string) {
  return `celo:${address}`;
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  if (typeof document === 'undefined') {
    throw new Error('File download is not available in this environment.');
  }

  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

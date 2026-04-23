import { QueryClient } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { celo } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { ConnectionController } from "@reown/appkit-controllers";
import { getAddress } from "viem";
import { getAccount, watchAccount } from "wagmi/actions";

import { getWalletConnectProjectId } from "@/config/env";
import { getMobileWalletEnvironment, resolveManualWalletOpenUrl } from "@/lib/wallet";
import { logWalletConnection } from "@/lib/walletConnectionDebug";

const projectId = getWalletConnectProjectId();

const getWalletMetadata = () => {
  const origin =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "http://localhost:5173";

  return {
    name: "OfflinePay",
    description: "Offline crypto payments on Celo",
    url: origin,
    icons: [`${origin}/favicon.ico`],
  } as const;
};

export const supportedNetworks = [celo] as const;

type ReownSingleton = {
  appKit: ReturnType<typeof createAppKit>;
  queryClient: QueryClient;
  wagmiAdapter: WagmiAdapter;
  walletMetadata: ReturnType<typeof getWalletMetadata>;
};

const globalReown = globalThis as typeof globalThis & {
  __offlinePayReown?: ReownSingleton;
};

const reownSingleton =
  globalReown.__offlinePayReown ??
  (() => {
    const walletMetadata = getWalletMetadata();
    const queryClient = new QueryClient();
    const wagmiAdapter = new WagmiAdapter({
      projectId,
      networks: supportedNetworks,
      ssr: false,
    });
    const appKit = createAppKit({
      adapters: [wagmiAdapter],
      projectId,
      metadata: walletMetadata,
      networks: supportedNetworks,
      features: {
        analytics: true,
      },
    });

    logWalletConnection("appkit.initialized", {
      metadataUrl: walletMetadata.url,
      currentOrigin: typeof window !== "undefined" ? window.location.origin : "server",
    });

    ConnectionController.subscribeKey("wcUri", (wcUri) => {
      if (!wcUri) {
        return;
      }

      logWalletConnection("walletconnect.uri.generated", {
        wcUri,
      });
    });

    ConnectionController.subscribeKey("wcLinking", (wcLinking) => {
      if (!wcLinking) {
        return;
      }

      logWalletConnection("walletconnect.mobile-link.ready", {
        href: wcLinking.href,
        walletName: wcLinking.name,
      });
    });

    const singleton = {
      appKit,
      queryClient,
      wagmiAdapter,
      walletMetadata,
    };

    globalReown.__offlinePayReown = singleton;
    return singleton;
  })();

export const { appKit, queryClient, wagmiAdapter, walletMetadata } = reownSingleton;

export const getWalletConnectionErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message || "Wallet connection failed. Please try again.";
};

export const wagmiConfig = wagmiAdapter.wagmiConfig;

export const getLatestWalletConnectUri = () => ConnectionController.state.wcUri ?? null;

export const getLatestWalletConnectDeepLink = () => ConnectionController.state.wcLinking?.href ?? null;

export const getWalletManualOpenUrl = (walletDeepLink: string | undefined, currentUrl: string) => {
  const generatedDeepLink = getLatestWalletConnectDeepLink();
  if (generatedDeepLink) {
    return generatedDeepLink;
  }

  return resolveManualWalletOpenUrl(
    walletDeepLink,
    currentUrl,
    getMobileWalletEnvironment(),
    getLatestWalletConnectUri(),
  );
};

export const openWalletConnectionModal = (options?: { uri?: string }) =>
  appKit.open({
    view: "Connect",
    ...(options?.uri ? { uri: options.uri } : {}),
  });

export const resumeWalletConnectionFromUri = async (uri: string) => {
  logWalletConnection("walletconnect.uri.resume.requested", {
    wcUri: uri,
  });
  await openWalletConnectionModal({ uri });
};

export const waitForWalletConnection = (timeoutMs = 15000) =>
  new Promise<string>((resolve, reject) => {
    const currentAccount = getAccount(wagmiConfig);

    if (currentAccount.isConnected && currentAccount.address) {
      resolve(getAddress(currentAccount.address));
      return;
    }

    const unsubscribe = watchAccount(wagmiConfig, {
      onChange(account) {
        if (account.isConnected && account.address) {
          window.clearTimeout(timeout);
          unsubscribe();
          resolve(getAddress(account.address));
        }
      },
    });

    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("Wallet connection was not completed."));
    }, timeoutMs);
  });

export const requestWalletConnection = async (timeoutMs?: number) => {
  await openWalletConnectionModal();
  return waitForWalletConnection(timeoutMs);
};

import { useAppKit, useAppKitEvents, useAppKitState } from "@reown/appkit/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress } from "viem";
import { useAccount } from "wagmi";
import { getAccount, watchAccount } from "wagmi/actions";

import { getWalletManualOpenUrl, wagmiConfig } from "@/lib/reown";
import { getMobileWalletEnvironment } from "@/lib/wallet";
import { logWalletConnection } from "@/lib/walletConnectionDebug";

export type WalletConnectionStatus = "idle" | "connecting" | "connected" | "failed";

const DEFAULT_TIMEOUT_MS = 15_000;

const TIMEOUT_MESSAGES = {
  default:
    "Wallet connection timed out after 15 seconds. Retry the connection or open your wallet manually, then return to the app.",
  chrome:
    "Wallet connection timed out after 15 seconds. Chrome may not have returned from the wallet app. Retry the connection or open the wallet manually, approve the request, then switch back to Chrome.",
  miniPay:
    "Wallet connection timed out after 15 seconds. Re-open the wallet modal in MiniPay and approve the request there before returning to OfflinePay.",
} as const;

type PendingConnection = {
  reject: (error: Error) => void;
  resolve: (address: string) => void;
};

type ConnectionAttemptMeta = {
  startedAt: number;
  selectedWalletName: string | null;
  walletWasSelected: boolean;
};

export const useWalletConnection = (timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const { open } = useAppKit();
  const appKitEvent = useAppKitEvents();
  const appKitState = useAppKitState();
  const { address, isConnected } = useAccount();
  const browser = useMemo(() => getMobileWalletEnvironment(), []);
  const [status, setStatus] = useState<WalletConnectionStatus>(() =>
    isConnected && address ? "connected" : "idle",
  );
  const [error, setError] = useState("");
  const timeoutRef = useRef<number | null>(null);
  const statusRef = useRef<WalletConnectionStatus>(status);
  const pendingRef = useRef<PendingConnection | null>(null);
  const promiseRef = useRef<Promise<string> | null>(null);
  const appKitStateRef = useRef(appKitState);
  const attemptMetaRef = useRef<ConnectionAttemptMeta | null>(null);
  const syncIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    appKitStateRef.current = appKitState;
  }, [appKitState]);

  const getTimeoutMessage = useCallback(() => {
    if (browser.isMiniPay) {
      return TIMEOUT_MESSAGES.miniPay;
    }

    if (browser.isChromeAndroid) {
      return TIMEOUT_MESSAGES.chrome;
    }

    return TIMEOUT_MESSAGES.default;
  }, [browser.isChromeAndroid, browser.isMiniPay]);

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      logWalletConnection("timeout.cleared");
      timeoutRef.current = null;
    }
  }, []);

  const clearSyncIntervalRef = useCallback(() => {
    if (syncIntervalRef.current !== null) {
      window.clearInterval(syncIntervalRef.current);
      logWalletConnection("wagmi.sync.polling.cleared");
      syncIntervalRef.current = null;
    }
  }, []);

  const clearPending = useCallback(() => {
    logWalletConnection("connection.pending.cleared", {
      previousStatus: statusRef.current,
    });
    pendingRef.current = null;
    promiseRef.current = null;
    attemptMetaRef.current = null;
    clearTimeoutRef();
    clearSyncIntervalRef();
  }, [clearSyncIntervalRef, clearTimeoutRef]);

  const resetConnectionState = useCallback(
    (reason: string) => {
      const pending = pendingRef.current;

      logWalletConnection("connection.reset", {
        reason,
        status: statusRef.current,
        appKitOpen: appKitStateRef.current.open,
        connectingWallet: appKitStateRef.current.connectingWallet?.name ?? null,
      });

      if (pending) {
        pending.reject(new Error(`Wallet connection reset: ${reason}`));
      }

      clearPending();
      setError("");
      setStatus("idle");
    },
    [clearPending],
  );

  const resolveConnectedAddress = useCallback(
    (rawAddress: string) => {
      const normalizedAddress = getAddress(rawAddress);
      logWalletConnection("connection.resolved", {
        address: normalizedAddress,
      });
      clearPending();
      setError("");
      setStatus("connected");
      return normalizedAddress;
    },
    [clearPending],
  );

  const resolvePendingConnection = useCallback(
    (rawAddress: string) => {
      const pending = pendingRef.current;
      const normalizedAddress = resolveConnectedAddress(rawAddress);
      pending?.resolve(normalizedAddress);
      return normalizedAddress;
    },
    [resolveConnectedAddress],
  );

  const rejectPendingConnection = useCallback(
    (message: string) => {
      logWalletConnection("connection.rejected", {
        message,
      });
      const pending = pendingRef.current;
      clearPending();
      setError(message);
      setStatus("failed");
      pending?.reject(new Error(message));
    },
    [clearPending],
  );

  const syncFromWagmi = useCallback((source: string) => {
    const currentAccount = getAccount(wagmiConfig);
    logWalletConnection("wagmi.sync.check", {
      source,
      isConnected: currentAccount.isConnected,
      address: currentAccount.address ?? null,
      chainId: currentAccount.chainId ?? null,
      connector: currentAccount.connector?.name ?? null,
    });

    if (currentAccount.isConnected && currentAccount.address) {
      resolvePendingConnection(currentAccount.address);
      return;
    }

    if (!pendingRef.current && statusRef.current === "connected") {
      setStatus("idle");
    }
  }, [resolvePendingConnection]);

  const maybeTimeoutPendingConnection = useCallback((source: string) => {
    const attemptMeta = attemptMetaRef.current;

    if (!pendingRef.current || !attemptMeta) {
      return false;
    }

    const elapsedMs = Date.now() - attemptMeta.startedAt;

    if (elapsedMs < timeoutMs) {
      return false;
    }

    logWalletConnection("connection.timeout.detected", {
      source,
      elapsedMs,
      timeoutMs,
      selectedWallet: attemptMeta.selectedWalletName,
    });
    rejectPendingConnection(getTimeoutMessage());
    return true;
  }, [getTimeoutMessage, rejectPendingConnection, timeoutMs]);

  const startSyncPolling = useCallback((source: string) => {
    if (!pendingRef.current) {
      return;
    }

    clearSyncIntervalRef();
    logWalletConnection("wagmi.sync.polling.started", {
      source,
      timeoutMs,
    });

    syncIntervalRef.current = window.setInterval(() => {
      if (!pendingRef.current) {
        clearSyncIntervalRef();
        return;
      }

      if (maybeTimeoutPendingConnection(`${source}:poll`)) {
        clearSyncIntervalRef();
        return;
      }

      syncFromWagmi(`${source}:poll`);
    }, 1000);
  }, [clearSyncIntervalRef, maybeTimeoutPendingConnection, syncFromWagmi, timeoutMs]);

  useEffect(() => {
    logWalletConnection("wagmi.account.hook", {
      isConnected,
      address: address ?? null,
    });

    if (isConnected && address) {
      resolvePendingConnection(address);
      return;
    }

    if (!pendingRef.current && statusRef.current === "connected") {
      setStatus("idle");
    }
  }, [address, isConnected, resolvePendingConnection]);

  useEffect(() => {
    const unwatch = watchAccount(wagmiConfig, {
      onChange(account) {
        logWalletConnection("wagmi.watchAccount.onChange", {
          isConnected: account.isConnected,
          address: account.address ?? null,
          chainId: account.chainId ?? null,
          connector: account.connector?.name ?? null,
        });

        if (account.isConnected && account.address) {
          resolvePendingConnection(account.address);
          return;
        }

        if (!pendingRef.current && statusRef.current === "connected") {
          setStatus("idle");
        }
      },
    });

    return unwatch;
  }, [resolvePendingConnection]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        logWalletConnection("app.lifecycle.visible", {
          visibilityState: document.visibilityState,
        });
        if (!maybeTimeoutPendingConnection("visibilitychange")) {
          syncFromWagmi("visibilitychange");
          startSyncPolling("visibilitychange");
        }
      }
    };

    const handleFocus = () => {
      logWalletConnection("app.lifecycle.focus");
      if (!maybeTimeoutPendingConnection("focus")) {
        syncFromWagmi("focus");
        startSyncPolling("focus");
      }
    };

    const handlePageShow = () => {
      logWalletConnection("app.lifecycle.pageshow");
      if (!maybeTimeoutPendingConnection("pageshow")) {
        syncFromWagmi("pageshow");
        startSyncPolling("pageshow");
      }
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisible);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [maybeTimeoutPendingConnection, startSyncPolling, syncFromWagmi]);

  useEffect(() => () => {
    clearPending();
  }, [clearPending]);

  const manualWalletUrl = useMemo(() => {
    const wallet = appKitState.connectingWallet;
    if (typeof window === "undefined") {
      return null;
    }

    const resolvedUrl = getWalletManualOpenUrl(
      wallet?.walletInfo?.deepLink,
      window.location.href,
    );

    if (wallet) {
      logWalletConnection("wallet.selected", {
        walletName: wallet.name,
        walletId: wallet.id,
        deepLink: wallet.walletInfo?.deepLink ?? null,
        manualWalletUrl: resolvedUrl,
      });
    }

    return resolvedUrl;
  }, [appKitState.connectingWallet, browser]);

  const hint = useMemo(() => {
    if (browser.isMiniPay) {
      return "MiniPay works best through the wallet modal flow. Approve the session in MiniPay, then return to OfflinePay.";
    }

    if (browser.isChromeAndroid) {
      return "If Chrome does not return automatically, switch back after approving the request in your wallet app.";
    }

    return "Approve the request in your wallet, then come back to OfflinePay if the browser does not return automatically.";
  }, [browser]);

  useEffect(() => {
    logWalletConnection("appkit.state.changed", {
      modalOpen: appKitState.open,
      selectedWallet: appKitState.connectingWallet?.name ?? null,
      activeChain: appKitState.activeChain ?? null,
      loading: appKitState.loading,
      initialized: appKitState.initialized,
    });
  }, [
    appKitState.activeChain,
    appKitState.connectingWallet,
    appKitState.initialized,
    appKitState.loading,
    appKitState.open,
  ]);

  useEffect(() => {
    if (!appKitEvent?.data) {
      return;
    }

    const event = appKitEvent.data;
    logWalletConnection("appkit.event", {
      type: event.type,
      event: event.event,
      properties: "properties" in event ? event.properties : undefined,
      address: "address" in event ? event.address ?? null : null,
    });

    if (event.event === "SELECT_WALLET") {
      attemptMetaRef.current = {
        startedAt: attemptMetaRef.current?.startedAt ?? Date.now(),
        selectedWalletName: event.properties.name,
        walletWasSelected: true,
      };

      logWalletConnection("wallet.selection.confirmed", {
        walletName: event.properties.name,
        platform: event.properties.platform,
        view: event.properties.view,
      });
    }
  }, [appKitEvent]);

  useEffect(() => {
    if (!pendingRef.current) {
      return;
    }

    const attemptMeta = attemptMetaRef.current;
    if (!attemptMeta?.walletWasSelected) {
      return;
    }

    if (!appKitState.open) {
      logWalletConnection("wallet.deep-link.handoff", {
        selectedWallet: attemptMeta.selectedWalletName,
        currentHref: typeof window !== "undefined" ? window.location.href : null,
      });
      startSyncPolling("wallet-handoff");
    }
  }, [appKitState.open, startSyncPolling]);

  const connect = useCallback(async () => {
    const currentAccount = getAccount(wagmiConfig);
    logWalletConnection("connection.requested", {
      existingConnection: currentAccount.isConnected,
      address: currentAccount.address ?? null,
      chainId: currentAccount.chainId ?? null,
      connector: currentAccount.connector?.name ?? null,
      currentHref: typeof window !== "undefined" ? window.location.href : null,
    });

    if (currentAccount.isConnected && currentAccount.address) {
      return resolveConnectedAddress(currentAccount.address);
    }

    if (promiseRef.current) {
      logWalletConnection("connection.reused.pending-promise");
      return promiseRef.current;
    }

    setError("");
    setStatus("connecting");
    logWalletConnection("connection.state", {
      status: "connecting",
      timeoutMs,
    });

    const pendingPromise = new Promise<string>((resolve, reject) => {
      pendingRef.current = { resolve, reject };
    });
    promiseRef.current = pendingPromise;
    attemptMetaRef.current = {
      startedAt: Date.now(),
      selectedWalletName: null,
      walletWasSelected: false,
    };

    timeoutRef.current = window.setTimeout(() => {
      logWalletConnection("connection.timeout", {
        timeoutMs,
        currentHref: typeof window !== "undefined" ? window.location.href : null,
        appKitOpen: appKitStateRef.current.open,
        connectingWallet: appKitStateRef.current.connectingWallet?.name ?? null,
      });
      rejectPendingConnection(getTimeoutMessage());
    }, timeoutMs);

    try {
      logWalletConnection("appkit.modal.open.requested", {
        view: "Connect",
      });
      await open({ view: "Connect" });
      logWalletConnection("appkit.modal.open.resolved", {
        modalOpen: appKitStateRef.current.open,
        connectingWallet: appKitStateRef.current.connectingWallet?.name ?? null,
      });
      syncFromWagmi("modal-open-resolved");

      if (!pendingRef.current) {
        const latestAccount = getAccount(wagmiConfig);
        if (latestAccount.isConnected && latestAccount.address) {
          return resolveConnectedAddress(latestAccount.address);
        }

        throw new Error("Wallet connection was cancelled before it completed.");
      }

      const { connectingWallet, open: modalOpen } = appKitStateRef.current;
      const walletWasSelected =
        attemptMetaRef.current?.walletWasSelected || Boolean(connectingWallet);

      if (!modalOpen && !walletWasSelected) {
        rejectPendingConnection("Wallet connection was cancelled before it completed.");
      } else if (!modalOpen && walletWasSelected) {
        logWalletConnection("connection.waiting-for-wallet-return", {
          selectedWallet:
            attemptMetaRef.current?.selectedWalletName ?? connectingWallet?.name ?? null,
        });
        startSyncPolling("wallet-return");
      }
    } catch (openError) {
      logWalletConnection("appkit.modal.open.failed", {
        message: openError instanceof Error ? openError.message : String(openError),
      });
      rejectPendingConnection(
        openError instanceof Error ? openError.message : "Wallet connection failed. Please try again.",
      );
    }

    return pendingPromise;
  }, [getTimeoutMessage, open, rejectPendingConnection, resolveConnectedAddress, startSyncPolling, syncFromWagmi, timeoutMs]);

  const retryConnection = useCallback(async () => {
    resetConnectionState("retry-requested");
    return connect();
  }, [connect, resetConnectionState]);

  const openWalletManually = useCallback(async () => {
    if (manualWalletUrl && typeof window !== "undefined") {
      logWalletConnection("wallet.manual-open.triggered", {
        manualWalletUrl,
      });
      window.location.assign(manualWalletUrl);
      return;
    }

    logWalletConnection("wallet.manual-open.fallback-modal");
    await open({ view: "Connect" });
  }, [manualWalletUrl, open]);

  return {
    browser,
    canOpenWalletManually: true,
    connect,
    connectingWallet: appKitState.connectingWallet,
    error,
    hint,
    openWalletManually,
    retryConnection,
    status,
  };
};

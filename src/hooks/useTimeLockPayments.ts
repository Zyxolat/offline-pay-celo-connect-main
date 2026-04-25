import { useCallback, useEffect, useRef, useState } from "react";

import {
  acceptPayment,
  getConnectedWalletAddress,
  getPaymentsForAddress,
  getWalletBalance,
  subscribeToPaymentEvents,
  subscribeToWalletEvents,
  type TimeLockPaymentView,
} from "@/utils/contract";
import { useCelo } from "@/providers/CeloProvider";

export const useTimeLockPayments = () => {
  const {
    address,
    connectionError,
    connectionHint,
    connectionStatus,
    connect,
    connecting,
    isWrongNetwork,
    refreshWallet,
    retryConnection,
    openWalletManually,
    canOpenWalletManually,
    switchNetwork,
    switchingNetwork,
    walletAvailable,
  } = useCelo();
  const [payments, setPayments] = useState<TimeLockPaymentView[]>([]);
  const [walletBalance, setWalletBalance] = useState("0");
  const [loading, setLoading] = useState(true);
  const [actingOnPaymentId, setActingOnPaymentId] = useState<number | null>(null);
  const [lastTransactionHash, setLastTransactionHash] = useState("");
  const [error, setError] = useState("");
  const refreshInFlightRef = useRef(false);

  const refresh = useCallback(
    async (addressOverride?: string, options?: { silent?: boolean }) => {
      const targetAddress = addressOverride || address;
      const silent = options?.silent ?? false;

      if (!targetAddress || isWrongNetwork) {
        setPayments([]);
        setWalletBalance("0");
        setLoading(false);
        return;
      }

      if (refreshInFlightRef.current) {
        return;
      }

      refreshInFlightRef.current = true;
      if (!silent) {
        setLoading(true);
      }

      try {
        const [nextPayments, nextBalance] = await Promise.all([
          getPaymentsForAddress(targetAddress),
          getWalletBalance(targetAddress),
        ]);
        setPayments(nextPayments);
        setWalletBalance(nextBalance);
        setError("");
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : "Unable to load contract payments.");
      } finally {
        refreshInFlightRef.current = false;
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [address, isWrongNetwork],
  );

  const syncConnectedAccount = useCallback(async () => {
    try {
      const connectedAddress = await getConnectedWalletAddress();
      if (connectedAddress) {
        await refresh(connectedAddress);
      } else {
        setLoading(false);
      }
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Unable to detect a connected wallet.");
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    void refreshWallet();
    void syncConnectedAccount();
  }, [refreshWallet, syncConnectedAccount]);

  useEffect(() => {
    if (!address || isWrongNetwork) {
      setPayments([]);
      setWalletBalance("0");
      setLoading(false);
      return;
    }

    void refresh(address);
  }, [address, isWrongNetwork, refresh]);

  useEffect(() => {
    if (!address || isWrongNetwork) {
      return () => undefined;
    }

    const interval = window.setInterval(() => {
      void refresh(address, { silent: true });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [address, isWrongNetwork, refresh]);

  useEffect(() => {
    const unsubscribe = subscribeToWalletEvents(() => {
      void refresh(undefined, { silent: true });
    });

    return unsubscribe;
  }, [refresh]);

  useEffect(() => {
    if (!address || isWrongNetwork) {
      return () => undefined;
    }

    const unsubscribe = subscribeToPaymentEvents(address, () => {
      void refresh(address, { silent: true });
    });

    return unsubscribe;
  }, [address, isWrongNetwork, refresh]);

  const handleConnectWallet = useCallback(async () => {
    try {
      const nextAddress = await connect();
      setError("");
      await refresh(nextAddress);
      window.setTimeout(() => {
        void refresh(nextAddress, { silent: true });
      }, 2000);
      return nextAddress;
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : "Unable to connect your wallet.";
      setError(message);
      throw new Error(message);
    }
  }, [connect, refresh]);

  const handleAcceptPayment = useCallback(
    async (paymentId: number) => {
      setActingOnPaymentId(paymentId);

      try {
        const result = await acceptPayment(paymentId);
        setLastTransactionHash(result.hash);
        setError("");
        await refresh();
        window.setTimeout(() => {
          void refresh(undefined, { silent: true });
        }, 2000);
        return result;
      } catch (acceptError) {
        const message = acceptError instanceof Error ? acceptError.message : "Unable to claim this payment.";
        setError(message);
        await refresh();
        throw new Error(message);
      } finally {
        setActingOnPaymentId(null);
      }
    },
    [refresh],
  );

  return {
    account: address,
    payments,
    walletBalance,
    loading,
    connecting,
    connectionError,
    connectionHint,
    connectionStatus,
    retryConnection,
    openWalletManually,
    canOpenWalletManually,
    actingOnPaymentId,
    lastTransactionHash,
    error,
    walletAvailable,
    isWrongNetwork,
    switchNetwork,
    switchingNetwork,
    connectWallet: handleConnectWallet,
    refresh,
    acceptPayment: handleAcceptPayment,
  };
};

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Copy, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { useTimeLockPayments } from "@/hooks/useTimeLockPayments";
import { copyTextToClipboard, formatWalletAddress } from "@/lib/wallet";
import { getCurrentUnixTime, isPaymentClaimable } from "@/utils/contract";

export const ReceivePayment = () => {
  const {
    account,
    payments,
    loading,
    connecting,
    connectionError,
    connectionHint,
    connectionStatus,
    retryConnection,
    openWalletManually,
    canOpenWalletManually,
    actingOnPaymentId,
    error,
    connectWallet,
    refresh,
    acceptPayment,
  } = useTimeLockPayments();
  const [currentTime, setCurrentTime] = useState(() => getCurrentUnixTime());

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(getCurrentUnixTime()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const incomingPayments = useMemo(
    () => payments.filter((payment) => payment.isRecipient).sort((left, right) => right.id - left.id),
    [payments],
  );

  const formatCountdown = (deadline: number) => {
    const remainingSeconds = deadline - currentTime;
    if (remainingSeconds <= 0) {
      return "Ready to claim";
    }

    const totalSeconds = remainingSeconds;
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  const handleConnectWallet = async () => {
    try {
      await connectWallet();
      toast.success("Wallet connected to Celo Mainnet.");
    } catch (connectError) {
      toast.error(connectError instanceof Error ? connectError.message : "Unable to connect your wallet.");
    }
  };

  const handleCopyAddress = async () => {
    if (!account) {
      return;
    }

    try {
      await copyTextToClipboard(account);
      toast.success("Address copied!");
    } catch (copyError) {
      toast.error(copyError instanceof Error ? copyError.message : "Unable to copy address.");
    }
  };

  const handleRefresh = async () => {
    try {
      await refresh();
      toast.success("Payment list refreshed.");
    } catch (refreshError) {
      toast.error(refreshError instanceof Error ? refreshError.message : "Unable to refresh payment list.");
    }
  };

  const handleAccept = async (paymentId: number) => {
    const loadingToastId = toast.loading("Claim transaction pending...");
    try {
      await acceptPayment(paymentId);
      toast.success("Payment claimed.", { id: loadingToastId });
    } catch (acceptError) {
      toast.error(acceptError instanceof Error ? acceptError.message : "Unable to claim payment.", { id: loadingToastId });
    }
  };

  const connectLabel = connecting
    ? "Connecting..."
    : account
      ? formatWalletAddress(account, 10, 8)
      : connectionStatus === "failed"
        ? "Retry Connection"
        : "Connect";

  return (
    <Card className="space-y-4 border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/50">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Recipient wallet</p>
          <p className="mt-2 break-all rounded-2xl border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-900">
            {account || "Connect your wallet to load your recipient payments."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleConnectWallet} className="h-11 rounded-xl bg-slate-950 text-white hover:bg-slate-800">
            <ArrowRight size={16} />
            {connectLabel}
          </Button>
          <Button onClick={handleCopyAddress} variant="outline" className="h-11 rounded-xl border-slate-200" disabled={!account}>
            <Copy size={16} />
            Copy Address
          </Button>
          <Button onClick={handleRefresh} variant="outline" className="h-11 rounded-xl border-slate-200" disabled={!account}>
            <RefreshCcw size={16} />
            Refresh
          </Button>
        </div>
      </div>

      {connectionStatus === "connecting" ? <p className="text-sm text-slate-500">{connectionHint}</p> : null}

      {connectionStatus === "failed" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <span>{connectionError}</span>
          <Button type="button" size="sm" onClick={() => void retryConnection()}>
            Retry connection
          </Button>
          {canOpenWalletManually ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void openWalletManually()}>
              Open wallet manually
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-slate-500">Loading incoming contract payments...</p>
        ) : incomingPayments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            No pending contract payments for this wallet right now.
          </div>
        ) : (
          incomingPayments.map((payment) => {
            const claimableNow = isPaymentClaimable(currentTime, payment.unlockTime);
            const canShowClaim = payment.isRecipient && !payment.claimed && claimableNow;
            const statusLabel = payment.claimed
              ? "Claimed"
              : claimableNow
                ? "Ready to claim"
                : "Locked";

            return (
              <div key={payment.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Payment #{payment.id}</p>
                    <p className="text-xs text-slate-500">{payment.amount} CELO from {formatWalletAddress(payment.sender, 8, 6)}</p>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">{statusLabel}</span>
                </div>

                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  <p>Unlock time (UTC): {new Date(payment.unlockTime * 1000).toUTCString()}</p>
                  <p>Countdown: {claimableNow ? "Ready to claim" : formatCountdown(payment.unlockTime)}</p>
                  <p>Sender: {payment.sender}</p>
                  <p>Recipient: {payment.recipient}</p>
                </div>

                {canShowClaim ? (
                  <div className="mt-4">
                    <Button
                      onClick={() => handleAccept(payment.id)}
                      disabled={actingOnPaymentId === payment.id}
                      className="h-11 rounded-xl bg-emerald-500 text-white hover:bg-emerald-400"
                    >
                      <CheckCircle2 size={16} />
                      {actingOnPaymentId === payment.id ? "Claiming..." : "Claim"}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Recipients can claim funds only after the sender-set unlock time (UTC) has passed and the intended wallet is connected on Celo Mainnet.
      </div>
    </Card>
  );
};

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCcw, Wallet } from "lucide-react";

import ClaimSection from "@/components/ClaimSection";
import PaymentCard from "@/components/PaymentCard";
import PaymentForm from "@/components/payments/PaymentForm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { useTimeLockPayments } from "@/hooks/useTimeLockPayments";
import { formatWalletAddress } from "@/lib/wallet";
import { estimatePaymentActionGas, getCurrentUnixTime } from "@/utils/contract";

export const SendPayment = () => {
  const {
    account,
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
    connectWallet,
    refresh,
    acceptPayment,
    refundPayment,
    isWrongNetwork,
    switchNetwork,
    switchingNetwork,
  } = useTimeLockPayments();
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(() => getCurrentUnixTime());
  const [selectedActionGas, setSelectedActionGas] = useState("");
  const [estimatingActionGas, setEstimatingActionGas] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(getCurrentUnixTime()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedPaymentId && payments.length > 0) {
      setSelectedPaymentId(payments[0].id);
    }
  }, [payments, selectedPaymentId]);

  const selectedPayment = useMemo(
    () => payments.find((payment) => payment.id === selectedPaymentId) ?? payments[0] ?? null,
    [payments, selectedPaymentId],
  );

  useEffect(() => {
    const estimateActionGas = async () => {
      if (!selectedPayment || !account || (!selectedPayment.canAccept && !selectedPayment.canRefund)) {
        setSelectedActionGas("");
        return;
      }

      setEstimatingActionGas(true);

      try {
        const estimate = await estimatePaymentActionGas(
          selectedPayment.id,
          selectedPayment.canAccept ? "accept" : "refund",
        );
        setSelectedActionGas(estimate.feeCelo);
      } catch {
        setSelectedActionGas("");
      } finally {
        setEstimatingActionGas(false);
      }
    };

    void estimateActionGas();
  }, [account, selectedPayment]);

  const handleConnectWallet = async () => {
    try {
      await connectWallet();
      toast.success("Wallet connected to Celo Mainnet.");
    } catch (connectError) {
      toast.error(connectError instanceof Error ? connectError.message : "Unable to connect your wallet.");
    }
  };

  const connectLabel = connecting
    ? "Connecting..."
    : account
      ? formatWalletAddress(account, 10, 8)
      : connectionStatus === "failed"
        ? "Retry Connection"
        : "Connect Wallet";

  const handleRefresh = async () => {
    try {
      await refresh();
      toast.success("Contract payments refreshed.");
    } catch (refreshError) {
      toast.error(refreshError instanceof Error ? refreshError.message : "Unable to refresh payments.");
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

  const handleRefund = async (paymentId: number) => {
    const loadingToastId = toast.loading("Refund transaction pending...");
    try {
      await refundPayment(paymentId);
      toast.success("Refund completed.", { id: loadingToastId });
    } catch (refundError) {
      toast.error(refundError instanceof Error ? refundError.message : "Unable to refund payment.", { id: loadingToastId });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-slate-200 bg-white shadow-xl shadow-slate-200/60">
        <div className="space-y-5 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.14),_transparent_30%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(30,41,59,0.98))] p-6 text-white">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-emerald-200">Time-lock payments</p>
              <h1 className="mt-3 text-3xl font-semibold">Create a time-locked offline payment</h1>
              <p className="mt-3 max-w-2xl text-sm text-slate-200">
                Lock CELO in the contract, set the release timer, and let the recipient withdraw only after the countdown expires.
              </p>
            </div>
            <div className="hidden rounded-3xl bg-white/10 p-3 text-emerald-200 sm:block">
              <Wallet size={24} />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleConnectWallet} className="rounded-xl bg-white text-slate-950 hover:bg-slate-100">
              <Wallet size={16} />
              {connectLabel}
            </Button>
            {isWrongNetwork ? (
              <Button
                onClick={() => void switchNetwork()}
                className="rounded-xl bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                disabled={switchingNetwork}
              >
                {switchingNetwork ? <Loader2 size={16} className="animate-spin" /> : null}
                Switch to Celo Mainnet
              </Button>
            ) : null}
            <Button onClick={handleRefresh} variant="outline" className="rounded-xl border-white/20 bg-white/5 text-white hover:bg-white/10">
              <RefreshCcw size={16} />
              Refresh
            </Button>
          </div>

          {connectionStatus === "connecting" ? <p className="text-sm text-slate-200">{connectionHint}</p> : null}

          {connectionStatus === "failed" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              <span>{connectionError}</span>
              <Button type="button" size="sm" onClick={() => void retryConnection()} className="bg-white text-slate-950 hover:bg-slate-100">
                Retry connection
              </Button>
              {canOpenWalletManually ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void openWalletManually()}
                  className="border-white/20 bg-white/5 text-white hover:bg-white/10"
                >
                  Open wallet manually
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-300">Connected wallet</p>
              <p className="mt-2 text-sm text-white">{account ? formatWalletAddress(account, 10, 8) : "Not connected"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-300">Available CELO</p>
              <p className="mt-2 text-sm text-white">{walletBalance} CELO</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-300">Settlement model</p>
              <p className="mt-2 text-sm text-white">Delayed escrow on Celo Mainnet</p>
            </div>
          </div>

          {lastTransactionHash ? (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">
              <CheckCircle2 size={18} />
              <span>Latest transaction: {lastTransactionHash}</span>
            </div>
          ) : null}

          {error ? <p className="text-sm text-amber-100">{error}</p> : null}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <PaymentForm disabled={!account || isWrongNetwork} onSubmit={handleRefresh} />

        <div className="space-y-6">
          <Card className="border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/50">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Wallet payment queue</h2>
                <p className="text-sm text-slate-500">Incoming and outgoing contract payments for the connected account.</p>
              </div>
              {loading ? <span className="text-sm text-slate-500">Loading...</span> : null}
            </div>

            <div className="space-y-3">
              {payments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                  No contract payments found for this wallet yet.
                </div>
              ) : (
                payments.map((payment) => (
                  <PaymentCard
                    key={payment.id}
                    transaction={payment}
                    currentTime={currentTime}
                    isSelected={payment.id === selectedPayment?.id}
                    onSelect={setSelectedPaymentId}
                  />
                ))
              )}
            </div>
          </Card>

          <ClaimSection
            currentTime={currentTime}
            transaction={selectedPayment}
            onAccept={handleAccept}
            onRefund={handleRefund}
            actionLoadingId={actingOnPaymentId}
            lastTransactionHash={lastTransactionHash}
            gasEstimate={selectedActionGas}
          />
          {estimatingActionGas ? <p className="text-sm text-slate-500">Estimating network fee for the selected action...</p> : null}
        </div>
      </div>
    </div>
  );
};

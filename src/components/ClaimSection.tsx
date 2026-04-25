import type { TimeLockPaymentView } from "@/utils/contract";
import { Button } from "@/components/ui/button";
import { isPaymentClaimable } from "@/utils/contract";

interface ClaimSectionProps {
  currentTime: number;
  transaction: TimeLockPaymentView | null;
  onAccept: (id: number) => void | Promise<void>;
  actionLoadingId?: number | null;
  lastTransactionHash?: string;
  gasEstimate?: string;
}

export const ClaimSection = ({
  currentTime,
  onAccept,
  transaction,
  actionLoadingId,
  lastTransactionHash,
  gasEstimate,
}: ClaimSectionProps) => {
  if (!transaction) {
    return (
      <section className="offlinepay-claim-card offlinepay-empty-state">
        <p className="offlinepay-eyebrow">Payment actions</p>
        <h3>Select a payment</h3>
        <p>Connect your wallet, create a payment, then claim incoming payments here once the unlock time passes.</p>
      </section>
    );
  }

  const unlockTimeMs = transaction.unlockTime * 1000;
  const isClaimable = isPaymentClaimable(currentTime, transaction.unlockTime);
  const isWorking = actionLoadingId === transaction.id;
  const remainingSeconds = Math.max(0, transaction.unlockTime - currentTime);
  const statusLabel =
    transaction.status === "accepted"
      ? "claimed"
      : isClaimable
        ? "ready to claim"
        : "locked";

  return (
    <section className="offlinepay-claim-card">
      <div className="offlinepay-section-heading offlinepay-section-heading--compact">
        <p className="offlinepay-eyebrow">Payment actions</p>
        <h3>Selected payment</h3>
        <p>Recipients can claim funds only after the sender-set unlock time has passed (UTC).</p>
      </div>

      <dl className="offlinepay-claim-details">
        <div>
          <dt>Amount</dt>
          <dd>{transaction.amount} CELO</dd>
        </div>
        <div>
          <dt>Recipient</dt>
          <dd>{transaction.recipient}</dd>
        </div>
        <div>
          <dt>Sender</dt>
          <dd>{transaction.sender}</dd>
        </div>
        <div>
          <dt>Unlock time (UTC)</dt>
          <dd>{new Date(unlockTimeMs).toUTCString()}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{statusLabel}</dd>
        </div>
        <div>
          <dt>Countdown</dt>
          <dd>{isClaimable ? "Unlocked" : `${remainingSeconds}s remaining`}</dd>
        </div>
      </dl>

      <p className="text-sm text-slate-600">
        Estimated gas fee: {gasEstimate ? `${gasEstimate} CELO` : "Available when an action can be estimated"}
      </p>

      {transaction.canAccept ? (
        <Button onClick={() => onAccept(transaction.id)} disabled={isWorking} className="w-full">
          {isWorking ? "Claiming..." : "Claim"}
        </Button>
      ) : null}

      {!transaction.canAccept ? (
        <Button disabled className="w-full">
          {transaction.status === "accepted"
            ? "Payment Claimed"
            : isClaimable
              ? "Recipient Wallet Required"
              : "Locked — waiting for unlock time"}
        </Button>
      ) : null}

      {lastTransactionHash ? <p style={{ marginTop: "0.75rem" }}>Latest transaction: {lastTransactionHash}</p> : null}
    </section>
  );
};

export default ClaimSection;

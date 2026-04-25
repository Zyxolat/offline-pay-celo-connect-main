import type { TimeLockPaymentView } from "@/utils/contract";

interface PaymentCardProps {
  transaction: TimeLockPaymentView;
  currentTime: number;
  isSelected?: boolean;
  onSelect?: (id: number) => void;
}

const formatCountdown = (remainingMs: number) => {
  if (remainingMs <= 0) {
    return "00:00:00";
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  if (days > 0) {
    return `${days}d ${String(Math.floor((totalSeconds % 86400) / 3600)).padStart(2, "0")}h ${minutes}m`;
  }

  return `${hours}:${minutes}:${seconds}`;
};

export const PaymentCard = ({ transaction, currentTime, isSelected = false, onSelect }: PaymentCardProps) => {
  const unlockTimeMs = transaction.unlockTime * 1000;
  const countdown = formatCountdown(Math.max(0, transaction.unlockTime - currentTime) * 1000);
  const statusLabel =
    transaction.status === "accepted"
      ? "Claimed"
      : transaction.status === "ready"
        ? "Ready to claim"
        : "Locked";

  return (
    <button
      type="button"
      className={["offlinepay-transaction-card", isSelected ? "offlinepay-transaction-card--selected" : ""].filter(Boolean).join(" ")}
      onClick={() => onSelect?.(transaction.id)}
    >
      <div className="offlinepay-transaction-card__row">
        <div>
          <p className="offlinepay-transaction-card__label">{transaction.isSender ? "Sent payment" : "Incoming payment"}</p>
          <h3 className="offlinepay-transaction-card__amount">{transaction.amount} CELO</h3>
        </div>
        <span
          className={[
            "offlinepay-status-pill",
            transaction.status === "accepted"
              ? "offlinepay-status-pill--claimed"
              : transaction.status === "locked"
                ? "offlinepay-status-pill--locked"
                : "offlinepay-status-pill--ready",
          ].join(" ")}
        >
          {statusLabel}
        </span>
      </div>

      <dl className="offlinepay-transaction-card__details">
        <div>
          <dt>{transaction.isSender ? "Recipient" : "Sender"}</dt>
          <dd>{transaction.isSender ? transaction.recipient : transaction.sender}</dd>
        </div>
        <div>
          <dt>Unlock time (UTC)</dt>
          <dd>{new Date(unlockTimeMs).toUTCString()}</dd>
        </div>
        <div>
          <dt>Countdown</dt>
          <dd>{transaction.status === "locked" ? countdown : statusLabel}</dd>
        </div>
      </dl>
    </button>
  );
};

export default PaymentCard;

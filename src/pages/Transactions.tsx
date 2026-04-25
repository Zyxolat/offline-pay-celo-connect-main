import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Copy, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import TransactionListItem from "@/components/payments/TransactionListItem";
import TransactionStatus from "@/components/payments/TransactionStatus";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { copyTextToClipboard, formatWalletAddress } from "@/lib/wallet";
import { walletAPI } from "@/services/apiClient";

export const TransactionsPage = () => {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "confirmed" | "pending" | "failed">("all");

  useEffect(() => {
    void loadTransactions();
    const intervalId = window.setInterval(() => {
      void loadTransactions(true);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, []);

  const loadTransactions = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      const response = await walletAPI.getTransactions(100, 0);
      const nextTransactions = Array.isArray(response.data?.data?.transactions) ? response.data.data.transactions : [];
      console.log("FETCHED TX:", nextTransactions);
      setTransactions(nextTransactions);
    } catch (error) {
      console.error("Error loading transactions:", error);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const filteredTransactions = transactions.filter((transaction) => {
    if (filter === "all") {
      return true;
    }

    if (filter === "pending") {
      return transaction?.status === "pending" || transaction?.status === "pending_sync" || transaction?.status === "submitted";
    }

    return transaction?.status === filter;
  });

  return (
    <div className="fintech-page">
      <header className="fintech-header">
        <div className="fintech-header__inner">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} />
          </Button>
          <div className="fintech-header__title">Transactions</div>
          <div className="fintech-header__spacer" />
        </div>
      </header>

      <main className="fintech-main">
        <section className="fintech-card">
          <div className="fintech-card__content">
            <div className="fintech-card__eyebrow">Activity ledger</div>
            <h1 className="fintech-card__title">Track every queued and settled transfer</h1>
            <p className="fintech-card__copy">
              Review the status, amount, and recipient for every transaction captured in the wallet.
            </p>
          </div>
        </section>

        <div className="fintech-actions transaction-filter-bar">
          {(["all", "confirmed", "pending", "failed"] as const).map((status) => (
            <Button key={status} variant={filter === status ? "default" : "outline"} size="sm" onClick={() => setFilter(status)}>
              {status === "pending" ? "Pending" : status}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="loading-state">
            <Loader2 size={34} className="loading-state__icon" />
          </div>
        ) : filteredTransactions.length > 0 ? (
          <div className="transaction-list">
            {filteredTransactions.map((transaction) => (
              <TransactionListItem
                key={transaction.id}
                amount={transaction?.amount || "0"}
                currency={transaction?.currency || "CELO"}
                recipient={transaction?.recipient}
                status={transaction?.status}
                timestamp={transaction?.timestamp}
                onClick={() => navigate(`/transactions/${transaction.id}`)}
              />
            ))}
          </div>
        ) : (
          <div className="transaction-empty-state">No transactions found for this filter yet.</div>
        )}
      </main>
    </div>
  );
};

const formatDateTime = (value?: string) => {
  if (!value) {
    return "Unknown date";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unknown date" : parsed.toLocaleString();
};

export const TransactionDetailPage = () => {
  const navigate = useNavigate();
  const { txId } = useParams<{ txId: string }>();
  const [transaction, setTransaction] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadDetail = useCallback(async () => {
    if (!txId) {
      setLoading(false);
      return;
    }

    try {
      const response = await walletAPI.getTransactions(1000, 0);
      const allTransactions = Array.isArray(response.data?.data?.transactions) ? response.data.data.transactions : [];
      setTransaction(allTransactions.find((item: any) => item?.id === txId));
    } catch (error) {
      console.error("Error loading detail:", error);
    } finally {
      setLoading(false);
    }
  }, [txId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleCopy = async (text?: string) => {
    if (!text) {
      return;
    }

    try {
      await copyTextToClipboard(text);
      toast.success("Copied to clipboard.");
    } catch (error: any) {
      toast.error(error?.message || "Unable to copy value.");
    }
  };

  return (
    <div className="fintech-page">
      <header className="fintech-header">
        <div className="fintech-header__inner">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} />
          </Button>
          <div className="fintech-header__title">Transaction Details</div>
          <div className="fintech-header__spacer" />
        </div>
      </header>

      <main className="fintech-main">
        {loading ? (
          <div className="loading-state">
            <Loader2 size={34} className="loading-state__icon" />
          </div>
        ) : transaction ? (
          <div className="fintech-grid transaction-detail-layout">
            <section className="fintech-card flow-card">
              <div className="fintech-card__eyebrow">Settlement detail</div>
              <h1 className="fintech-card__title">
                {transaction.amount || "0"} {transaction.currency || "CELO"}
              </h1>
              <div className="flow-card__body">
                <TransactionStatus status={transaction.status} timestamp={transaction.timestamp} hash={transaction.txHash} />
              </div>
            </section>

            <section className="fintech-card flow-card">
              <h2 className="flow-card__title">Transaction summary</h2>
              <div className="flow-card__body">
                <div className="flow-summary">
                  <div className="flow-summary__row">
                    <span className="flow-summary__label">Recipient</span>
                    <span className="flow-summary__value">{transaction.recipient || "Recipient unavailable"}</span>
                  </div>
                  <div className="flow-summary__row">
                    <span className="flow-summary__label">Short address</span>
                    <span className="flow-summary__value">
                      {transaction.recipient ? formatWalletAddress(transaction.recipient, 10, 8) : "Unavailable"}
                    </span>
                  </div>
                  <div className="flow-summary__row">
                    <span className="flow-summary__label">Recorded</span>
                    <span className="flow-summary__value">{formatDateTime(transaction.timestamp)}</span>
                  </div>
                  <div className="flow-summary__row">
                    <span className="flow-summary__label">Confirmations</span>
                    <span className="flow-summary__value">{transaction.confirmations ?? 0}</span>
                  </div>
                </div>

                <div className="fintech-actions">
                  <Button variant="outline" onClick={() => void handleCopy(transaction.recipient)}>
                    <Copy size={16} />
                    Copy Recipient
                  </Button>
                  {transaction.txHash ? (
                    <Button variant="secondary" onClick={() => void handleCopy(transaction.txHash)}>
                      <Copy size={16} />
                      Copy Hash
                    </Button>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="transaction-empty-state">Transaction not found.</div>
        )}
      </main>
    </div>
  );
};

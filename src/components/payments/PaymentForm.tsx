import { useEffect, useMemo, useState, type FormEvent } from "react";
import { isAddress } from "ethers";
import { Loader2, TimerReset } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { createPayment, estimateCreatePaymentGas } from "@/utils/contract";

interface PaymentFormProps {
  disabled?: boolean;
  onSubmit?: () => Promise<void> | void;
}

type FeedbackState =
  | {
      type: "success" | "error";
      text: string;
    }
  | null;

export const PaymentForm = ({ disabled = false, onSubmit }: PaymentFormProps) => {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [durationValue, setDurationValue] = useState("24");
  const [durationUnit, setDurationUnit] = useState<"minutes" | "hours">("hours");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [gasEstimate, setGasEstimate] = useState("");
  const [estimatingGas, setEstimatingGas] = useState(false);

  const parsedDurationValue = Number(durationValue.trim());
  const durationInSeconds = useMemo(() => {
    if (Number.isNaN(parsedDurationValue) || parsedDurationValue <= 0) {
      return null;
    }

    return durationUnit === "minutes"
      ? Math.floor(parsedDurationValue * 60)
      : Math.floor(parsedDurationValue * 3600);
  }, [durationUnit, parsedDurationValue]);
  const unlockAt = useMemo(() => {
    if (durationInSeconds === null || durationInSeconds <= 0) {
      return null;
    }

    return new Date(Date.now() + durationInSeconds * 1000);
  }, [durationInSeconds]);

  useEffect(() => {
    const trimmedRecipient = recipient.trim();
    const trimmedAmount = amount.trim();

    if (
      disabled ||
      !trimmedRecipient ||
      !trimmedAmount ||
      !isAddress(trimmedRecipient) ||
      Number.isNaN(Number(trimmedAmount)) ||
      Number(trimmedAmount) <= 0 ||
      durationInSeconds === null ||
      durationInSeconds <= 0
    ) {
      setGasEstimate("");
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setEstimatingGas(true);

      try {
        const estimate = await estimateCreatePaymentGas(
          trimmedRecipient,
          durationInSeconds,
          trimmedAmount,
        );
        setGasEstimate(estimate.feeCelo);
      } catch {
        setGasEstimate("");
      } finally {
        setEstimatingGas(false);
      }
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [amount, disabled, durationInSeconds, recipient]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (disabled || loading) {
      return;
    }

    const trimmedRecipient = recipient.trim();
    const trimmedAmount = amount.trim();
    const parsedAmount = Number(trimmedAmount);

    if (!trimmedRecipient) {
      const message = "Recipient address is required.";
      setFeedback({ type: "error", text: message });
      toast.error("Payment failed", { description: message });
      return;
    }

    if (!isAddress(trimmedRecipient)) {
      const message = "Enter a valid Celo wallet address.";
      setFeedback({ type: "error", text: message });
      toast.error("Payment failed", { description: message });
      return;
    }

    if (!trimmedAmount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      const message = "Enter an amount greater than 0.";
      setFeedback({ type: "error", text: message });
      toast.error("Payment failed", { description: message });
      return;
    }

    if (!durationValue.trim() || durationInSeconds === null || durationInSeconds <= 0) {
      const message = `Enter a lock duration greater than 0 ${durationUnit}.`;
      setFeedback({ type: "error", text: message });
      toast.error("Payment failed", { description: message });
      return;
    }

    setLoading(true);
    setFeedback(null);

    try {
      const { hash, paymentId } = await createPayment(trimmedRecipient, durationInSeconds, trimmedAmount);
      const successMessage = paymentId === null
        ? `Payment created. Transaction hash: ${hash}`
        : `Payment #${paymentId} created successfully. Transaction hash: ${hash}`;

      setFeedback({ type: "success", text: successMessage });
      toast.success("Payment locked successfully", {
        description: `Transaction confirmed: ${hash.slice(0, 10)}...${hash.slice(-8)}`,
      });

      await onSubmit?.();

      setRecipient("");
      setAmount("");
      setDurationValue("24");
      setDurationUnit("hours");
      setGasEstimate("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create the payment right now. Please try again.";
      setFeedback({ type: "error", text: message });
      toast.error("Payment failed", { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="offlinepay-form-card" onSubmit={handleSubmit}>
      <div className="offlinepay-section-heading">
        <p className="offlinepay-eyebrow">Lock payment</p>
        <h2>Create a time-locked payment</h2>
        <p>Lock real CELO in the contract, set the unlock window, and settle later on Celo Mainnet.</p>
      </div>

      <div className="offlinepay-form-grid">
        <label className="offlinepay-input-group" htmlFor="celo-recipient">
          <span className="offlinepay-input-group__label">Recipient wallet address</span>
          <Input
            id="celo-recipient"
            type="text"
            placeholder="0x71C7656EC7ab88b098defB751B7401B5f6d8976F"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="offlinepay-input"
          />
          <span className="offlinepay-input-group__hint">Use a valid destination address on Celo Mainnet.</span>
        </label>
        <label className="offlinepay-input-group" htmlFor="celo-amount">
          <span className="offlinepay-input-group__label">Locked amount (CELO)</span>
          <Input
            id="celo-amount"
            type="number"
            min="0"
            step="0.0001"
            placeholder="0.1"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="offlinepay-input"
          />
          <span className="offlinepay-input-group__hint">
            This CELO amount stays locked until the countdown finishes and the recipient claims it.
          </span>
        </label>
        <label className="offlinepay-input-group" htmlFor="celo-duration">
          <span className="offlinepay-input-group__label">Lock duration</span>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
            <Input
              id="celo-duration"
              type="number"
              min="1"
              step="1"
              placeholder={durationUnit === "minutes" ? "30" : "24"}
              value={durationValue}
              onChange={(event) => setDurationValue(event.target.value)}
              className="offlinepay-input"
            />
            <Select value={durationUnit} onValueChange={(value: "minutes" | "hours") => setDurationUnit(value)}>
              <SelectTrigger className="offlinepay-input">
                <SelectValue placeholder="Select unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="offlinepay-input-group__hint">
            Choose an exact delay like 5 minutes, 30 minutes, 1 hour, or 2 hours.
          </span>
        </label>
      </div>

      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <div className="flex items-center gap-2 font-medium text-slate-900">
          <TimerReset size={16} className="text-emerald-600" />
          Settlement preview
        </div>
        <p className="mt-2">Locked amount: {amount || "0"} CELO</p>
        <p className="mt-1">Recipient: {recipient || "Waiting for recipient address"}</p>
        <p className="mt-1">Unlock time (UTC): {unlockAt ? unlockAt.toUTCString() : "Set a valid lock duration"}</p>
        <p className="mt-3 flex items-center gap-2 text-slate-600">
          {estimatingGas ? <Loader2 size={14} className="animate-spin" /> : null}
          Estimated gas fee: {gasEstimate ? `${gasEstimate} CELO` : "Connect wallet and complete the form to estimate"}
        </p>
      </div>

      {feedback ? (
        <div aria-live="polite" role={feedback.type === "error" ? "alert" : "status"}>
          <span className={`offlinepay-status-pill ${feedback.type === "success" ? "offlinepay-status-pill--claimed" : "offlinepay-status-pill--locked"}`}>
            {feedback.type === "success" ? "Success" : "Error"}
          </span>
          <p style={{ marginTop: "0.75rem" }}>{feedback.text}</p>
        </div>
      ) : null}

      <Button type="submit" disabled={disabled || loading} className="w-full">
        {loading ? "Locking..." : "Create Time-Locked Payment"}
      </Button>
    </form>
  );
};

export default PaymentForm;

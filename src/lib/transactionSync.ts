import { getStoredToken } from "@/lib/auth";
import { walletAPI } from "@/services/apiClient";

export const syncTrackedTransaction = async (payload: {
  txHash: string;
  recipient?: string;
  amount?: string;
  currency?: string;
  status?: "submitted" | "pending" | "confirmed" | "failed";
  confirmations?: number;
  note?: string;
}) => {
  if (!getStoredToken("user")) {
    return null;
  }

  try {
    return await walletAPI.syncTransaction({
      txHash: payload.txHash,
    });
  } catch (error) {
    console.error("[transaction-sync] Failed to sync transaction", {
      payload,
      error,
    });
    return null;
  }
};

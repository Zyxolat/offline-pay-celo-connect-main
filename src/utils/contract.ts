import {
  BrowserProvider,
  Contract,
  Interface,
  JsonRpcProvider,
  formatEther,
  getAddress,
  isAddress,
  parseEther,
} from "ethers";
import { getAccount, switchChain, watchChainId, watchConnections } from "wagmi/actions";
import type { EIP1193Provider } from "viem";

import {
  CELO_MAINNET_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID_BIGINT,
  CELO_MAINNET_RPC_URL,
  OFFLINEPAY_WALLET_CACHE_KEY,
  type OfflinePayWalletState,
} from "@/config/celo";
import { TIMELOCK_ABI, TIMELOCK_CONTRACT_ADDRESS } from "@/contracts/TimeLock";
import { syncTrackedTransaction } from "@/lib/transactionSync";
import { requestWalletConnection, wagmiConfig } from "@/lib/reown";

const contractInterface = new Interface(TIMELOCK_ABI);
const readProvider = new JsonRpcProvider(CELO_MAINNET_RPC_URL);

interface ProviderError {
  code?: number | string;
  message?: string;
  shortMessage?: string;
  reason?: string;
  info?: {
    error?: {
      message?: string;
    };
  };
}

export type TimeLockPaymentStatus = "locked" | "ready" | "accepted";

export interface TimeLockPaymentView {
  id: number;
  sender: string;
  recipient: string;
  amount: string;
  amountWei: bigint;
  unlockTime: number;
  /** @deprecated use unlockTime */
  deadline: number;
  /** @deprecated use unlockTime */
  releaseTime: number;
  claimed: boolean;
  status: TimeLockPaymentStatus;
  isSender: boolean;
  isRecipient: boolean;
  isClaimable: boolean;
  canAccept: boolean;
}

export const getCurrentUnixTime = () => Math.floor(Date.now() / 1000);

/**
 * A payment is claimable only when the current UTC time (in seconds) is at or
 * past the contract-stored unlockTime. No early-claim buffer is applied — the
 * contract itself enforces the same check via block.timestamp.
 */
export const isPaymentClaimable = (
  currentTime: number,
  unlockTime: number,
) => currentTime >= unlockTime;

export const getPaymentStatus = (
  payment: Pick<TimeLockPaymentView, "claimed">,
  currentTime: number,
  unlockTime: number,
): TimeLockPaymentStatus => {
  if (payment.claimed) {
    return "accepted";
  }

  return isPaymentClaimable(currentTime, unlockTime) ? "ready" : "locked";
};

export interface CreatePaymentResult {
  hash: string;
  paymentId: number | null;
}

export interface ContractActionResult {
  hash: string;
}

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  feeWei: bigint;
  feeCelo: string;
}

const assertContractConfigured = () => {
  if (!TIMELOCK_CONTRACT_ADDRESS || !isAddress(TIMELOCK_CONTRACT_ADDRESS)) {
    throw new Error("OfflinePay contract configuration is invalid.");
  }
};

const getRawErrorMessage = (error: unknown): string => {
  const providerError = error as ProviderError | undefined;
  if (!providerError) {
    return "";
  }

  return (
    providerError.reason ||
    providerError.shortMessage ||
    providerError.info?.error?.message ||
    providerError.message ||
    ""
  );
};

const getFriendlyErrorMessage = (error: unknown) => {
  const providerError = error as ProviderError | undefined;
  const message = getRawErrorMessage(error).toLowerCase();

  if (providerError?.code === 4001 || message.includes("user rejected")) {
    return "Transaction was cancelled in your wallet.";
  }

  if (message.includes("insufficient funds")) {
    return "Insufficient funds to cover the locked CELO amount and gas fees.";
  }

  if (message.includes("wrong network") || message.includes("chain") || message.includes("switch")) {
    return "Switch your wallet to Celo Mainnet to continue.";
  }

  if (message.includes("invalid address") || message.includes("ens")) {
    return "Enter a valid Celo wallet address.";
  }

  if (message.includes("payment is still locked")) {
    return "This payment is still locked. Wait for the timer to reach zero.";
  }

  if (message.includes("payment already unlocked")) {
    return "This payment is already unlocked, so the sender can no longer cancel it.";
  }

  if (message.includes("only recipient can accept") || message.includes("only recipient can claim")) {
    return "Only the intended recipient can accept this payment.";
  }

  if (message.includes("only sender can refund")) {
    return "Only the original sender can cancel this payment while it is still locked.";
  }

  if (message.includes("call exception")) {
    return "The contract rejected this request. Double-check the recipient, amount, and unlock time.";
  }

  if (providerError?.message || providerError?.shortMessage || providerError?.reason) {
    return getRawErrorMessage(error);
  }

  return "Something went wrong while talking to the OfflinePay contract.";
};

const getEthereumProvider = async (): Promise<EIP1193Provider> => {
  const { connector } = getAccount(wagmiConfig);
  if (!connector) {
    throw new Error("Connect a compatible wallet like MiniPay or MetaMask to continue.");
  }

  return await connector.getProvider({ chainId: CELO_MAINNET_CHAIN_ID }) as EIP1193Provider;
};

const buildWalletState = (): OfflinePayWalletState => {
  const account = getAccount(wagmiConfig);

  return {
    address: account.address ? getAddress(account.address) : "",
    chainId: account.chainId ?? null,
    isConnected: account.isConnected,
    isWrongNetwork: account.chainId !== undefined && account.chainId !== CELO_MAINNET_CHAIN_ID,
    walletAvailable: typeof window !== "undefined",
  };
};

const saveWalletState = (state: OfflinePayWalletState) => {
  if (typeof window === "undefined") {
    return;
  }

  sessionStorage.setItem(OFFLINEPAY_WALLET_CACHE_KEY, JSON.stringify(state));
};

const getCachedWalletState = (): OfflinePayWalletState | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = sessionStorage.getItem(OFFLINEPAY_WALLET_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as OfflinePayWalletState;
  } catch {
    return null;
  }
};

export const readWalletState = async (force = false): Promise<OfflinePayWalletState> => {
  if (typeof window === "undefined") {
    const emptyState = {
      address: "",
      chainId: null,
      isConnected: false,
      isWrongNetwork: false,
      walletAvailable: false,
    };

    saveWalletState(emptyState);
    return emptyState;
  }

  const cached = getCachedWalletState();
  const state = buildWalletState();

  if (!force && cached) {
    const cacheMatchesLiveAccount =
      cached.address === state.address &&
      cached.chainId === state.chainId &&
      cached.isConnected === state.isConnected &&
      cached.isWrongNetwork === state.isWrongNetwork;

    if (cacheMatchesLiveAccount) {
      return cached;
    }
  }

  saveWalletState(state);
  return state;
};

export const switchToCeloMainnet = async () => {
  try {
    await switchChain(wagmiConfig, {
      chainId: CELO_MAINNET_CHAIN_ID,
    });
  } catch (error) {
    const providerError = error as ProviderError;

    throw new Error(
      providerError.message || "Automatic switching failed. Please switch your wallet to Celo Mainnet manually.",
    );
  }
};

export const ensureCeloMainnet = async () => {
  const ethereum = await getEthereumProvider();
  const provider = new BrowserProvider(ethereum as any);
  const network = await provider.getNetwork();

  if (network.chainId !== CELO_MAINNET_CHAIN_ID_BIGINT) {
    await switchToCeloMainnet();
  }

  return new BrowserProvider((await getEthereumProvider()) as any);
};

export const connectWallet = async () => {
  const account = getAccount(wagmiConfig);

  if (!account.isConnected) {
    await requestWalletConnection();
  }

  const provider = await ensureCeloMainnet();
  await provider.send("eth_requestAccounts", []);

  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const network = await provider.getNetwork();

  const result = {
    provider,
    signer,
    address: getAddress(address),
    chainId: Number(network.chainId),
  };

  console.log("Chain ID:", result.chainId);

  saveWalletState({
    ...buildWalletState(),
    address: result.address,
    chainId: result.chainId,
    isConnected: true,
    isWrongNetwork: result.chainId !== CELO_MAINNET_CHAIN_ID,
  });

  return result;
};

export const getConnectedWalletAddress = async () => {
  const state = await readWalletState();
  return state.address;
};

const getReadProvider = () => readProvider;

const getContract = (runner: BrowserProvider | JsonRpcProvider | Awaited<ReturnType<typeof connectWallet>>["signer"]) => {
  assertContractConfigured();
  return new Contract(TIMELOCK_CONTRACT_ADDRESS, TIMELOCK_ABI, runner);
};

const syncTransactionRecord = async (payload: {
  txHash: string;
  recipient: string;
  amount: string;
  currency: string;
  status: "submitted" | "confirmed" | "failed";
  confirmations?: number;
  note?: string;
}) => {
  await syncTrackedTransaction(payload);
};

const getClaimMethod = (contract: Contract) =>
  typeof contract.claimPayment === "function" ? contract.claimPayment.bind(contract) : contract.acceptPayment.bind(contract);

const getClaimGasEstimator = (contract: Contract) =>
  typeof contract.claimPayment?.estimateGas === "function"
    ? contract.claimPayment.estimateGas.bind(contract.claimPayment)
    : contract.acceptPayment.estimateGas.bind(contract.acceptPayment);

const buildGasEstimate = async (gasLimit: bigint, provider: BrowserProvider | JsonRpcProvider): Promise<GasEstimate> => {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
  const feeWei = gasLimit * gasPrice;

  return {
    gasLimit,
    gasPrice,
    feeWei,
    feeCelo: formatEther(feeWei),
  };
};

const mapPayment = (
  paymentId: number,
  payment: {
    sender: string;
    recipient: string;
    amount: bigint;
    unlockTime: bigint;
    claimed: boolean;
  },
  viewer: string,
): TimeLockPaymentView => {
  const now = getCurrentUnixTime();
  // unlockTime is stored as a UTC Unix timestamp by the contract (block.timestamp + duration)
  const unlockTime = Number(payment.unlockTime);
  const normalizedViewer = viewer ? getAddress(viewer) : "";
  const sender = getAddress(payment.sender);
  const recipient = getAddress(payment.recipient);
  const isSender = normalizedViewer === sender;
  const isRecipient = normalizedViewer === recipient;
  const isClaimable = isPaymentClaimable(now, unlockTime);
  const status = getPaymentStatus(payment, now, unlockTime);

  return {
    id: paymentId,
    sender,
    recipient,
    amount: formatEther(payment.amount),
    amountWei: payment.amount,
    unlockTime,
    // Keep deprecated aliases for backward compatibility with existing UI components
    deadline: unlockTime,
    releaseTime: unlockTime,
    claimed: payment.claimed,
    status,
    isSender,
    isRecipient,
    isClaimable,
    canAccept: isRecipient && !payment.claimed && isClaimable,
  };
};

export const getWalletBalance = async (address: string) => {
  if (!address || !isAddress(address)) {
    return "0";
  }

  const balance = await getReadProvider().getBalance(getAddress(address));
  return formatEther(balance);
};

export const getPayment = async (paymentId: number, viewerAddress = ""): Promise<TimeLockPaymentView> => {
  try {
    const provider = getReadProvider();
    const contract = getContract(provider);
    const payment = await contract.getPayment(paymentId);
    return mapPayment(paymentId, payment, viewerAddress);
  } catch (error) {
    throw new Error(getFriendlyErrorMessage(error));
  }
};

export const getLatestPaymentForViewer = async (paymentId: number, viewerAddress = "") => getPayment(paymentId, viewerAddress);

export const getPaymentsForAddress = async (address: string): Promise<TimeLockPaymentView[]> => {
  if (!address || !isAddress(address)) {
    return [];
  }

  try {
    const normalizedAddress = getAddress(address);
    const provider = getReadProvider();
    const contract = getContract(provider);
    const paymentCount = Number(await contract.paymentCount());
    const incomingIds = ((await contract.getUserPayments(normalizedAddress)) as bigint[]).map((value) => Number(value));
    const paymentIds = new Set<number>(incomingIds);

    const allPayments = await Promise.all(
      Array.from({ length: paymentCount }, (_, index) => contract.getPayment(index).then((payment) => ({ index, payment }))),
    );

    allPayments.forEach(({ index, payment }) => {
      if (getAddress(payment.sender) === normalizedAddress) {
        paymentIds.add(index);
      }
    });

    const payments = await Promise.all(Array.from(paymentIds).map((paymentId) => getPayment(paymentId, normalizedAddress)));
    return payments.sort((left, right) => right.id - left.id);
  } catch (error) {
    throw new Error(getFriendlyErrorMessage(error));
  }
};

const parsePaymentCreatedEvent = (logs: readonly { topics: readonly string[]; data: string }[]) => {
  for (const log of logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed?.name === "PaymentCreated") {
        return Number(parsed.args.paymentId);
      }
    } catch {
      continue;
    }
  }

  return null;
};

const validateCreatePaymentInput = (recipient: string, duration: number, amount: string) => {
  const normalizedRecipient = recipient.trim();
  const normalizedAmount = amount.trim();
  const parsedAmount = Number(normalizedAmount);

  if (!normalizedRecipient || !isAddress(normalizedRecipient)) {
    throw new Error("Enter a valid Celo wallet address.");
  }

  if (!normalizedAmount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error("Enter an amount greater than 0 CELO.");
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Enter a valid lock duration greater than zero.");
  }
};

export const estimateCreatePaymentGas = async (recipient: string, duration: number, amount: string) => {
  validateCreatePaymentInput(recipient, duration, amount);

  const { signer, provider } = await connectWallet();
  const contract = getContract(signer);
  const gasLimit = await contract.createPayment.estimateGas(getAddress(recipient.trim()), BigInt(Math.floor(duration)), {
    value: parseEther(amount.trim()),
  });

  return buildGasEstimate(gasLimit, provider);
};

export const createPayment = async (recipient: string, duration: number, amount: string): Promise<CreatePaymentResult> => {
  validateCreatePaymentInput(recipient, duration, amount);

  try {
    const { signer } = await connectWallet();
    const contract = getContract(signer);
    const normalizedRecipient = getAddress(recipient.trim());
    const normalizedAmount = amount.trim();
    const tx = await contract.createPayment(normalizedRecipient, BigInt(Math.floor(duration)), {
      value: parseEther(normalizedAmount),
    });
    console.log("TX SENT:", tx.hash);
    await syncTransactionRecord({
      txHash: tx.hash,
      recipient: normalizedRecipient,
      amount: normalizedAmount,
      currency: "CELO",
      status: "submitted",
      note: "Contract payment created",
    });
    const receipt = await tx.wait();
    console.log("TX CONFIRMED");
    console.log("FETCHED TX:", receipt);
    const paymentId = receipt ? parsePaymentCreatedEvent(receipt.logs) : null;
    await syncTransactionRecord({
      txHash: receipt?.hash || tx.hash,
      recipient: normalizedRecipient,
      amount: normalizedAmount,
      currency: "CELO",
      status: "confirmed",
      confirmations: receipt?.confirmations ?? 1,
      note: paymentId === null ? "Contract payment created" : `Contract payment #${paymentId} created`,
    });

    return {
      hash: receipt?.hash || tx.hash,
      paymentId,
    };
  } catch (error) {
    throw new Error(getFriendlyErrorMessage(error));
  }
};

export const estimatePaymentActionGas = async (paymentId: number) => {
  const { signer, provider } = await connectWallet();
  const contract = getContract(signer);
  const gasLimit = await getClaimGasEstimator(contract)(paymentId);
  return buildGasEstimate(gasLimit, provider);
};

export const acceptPayment = async (paymentId: number): Promise<ContractActionResult> => {
  try {
    const { signer, address } = await connectWallet();
    const latestPayment = await getLatestPaymentForViewer(paymentId, address);

    if (latestPayment.claimed) {
      throw new Error("This payment has already been claimed.");
    }

    if (!latestPayment.isRecipient) {
      throw new Error("Only the intended recipient can claim this payment.");
    }

    if (!latestPayment.isClaimable) {
      const now = getCurrentUnixTime();
      const remaining = Math.max(0, latestPayment.unlockTime - now);
      throw new Error(`This payment is still locked. It unlocks in ${remaining} second${remaining === 1 ? "" : "s"}.`);
    }

    const contract = getContract(signer);
    const claimPayment = getClaimMethod(contract);
    const tx = await claimPayment(paymentId);
    console.log("TX SENT:", tx.hash);
    await syncTransactionRecord({
      txHash: tx.hash,
      recipient: latestPayment.recipient,
      amount: latestPayment.amount,
      currency: "CELO",
      status: "submitted",
      note: `Contract payment #${paymentId} claim submitted`,
    });
    const receipt = await tx.wait();
    console.log("TX CONFIRMED");
    console.log("FETCHED TX:", receipt);
    await syncTransactionRecord({
      txHash: receipt?.hash || tx.hash,
      recipient: latestPayment.recipient,
      amount: latestPayment.amount,
      currency: "CELO",
      status: "confirmed",
      confirmations: receipt?.confirmations ?? 1,
      note: `Contract payment #${paymentId} claimed`,
    });

    return {
      hash: receipt?.hash || tx.hash,
    };
  } catch (error) {
    throw new Error(getFriendlyErrorMessage(error));
  }
};

export const subscribeToWalletEvents = (listener: () => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const unwatchConnection = watchConnections(wagmiConfig, {
    onChange: () => listener(),
  });
  const unwatchChain = watchChainId(wagmiConfig, {
    onChange: () => listener(),
  });

  return () => {
    unwatchConnection();
    unwatchChain();
  };
};

export const subscribeToPaymentEvents = (address: string, listener: () => void) => {
  if (!address || !isAddress(address)) {
    return () => undefined;
  }

  const normalizedAddress = getAddress(address);
  const contract = getContract(getReadProvider());
  const refreshFromEvent = () => {
    console.log("FETCHED TX:", { address: normalizedAddress, source: "contract-event" });
    listener();
  };

  const handleCreated = (_paymentId: bigint, sender: string, recipient: string) => {
    if (getAddress(sender) === normalizedAddress || getAddress(recipient) === normalizedAddress) {
      refreshFromEvent();
    }
  };

  const handleClaimed = (_paymentId: bigint, recipient: string) => {
    if (getAddress(recipient) === normalizedAddress) {
      refreshFromEvent();
    }
  };

  contract.on("PaymentCreated", handleCreated);
  contract.on("PaymentClaimed", handleClaimed);

  return () => {
    contract.off("PaymentCreated", handleCreated);
    contract.off("PaymentClaimed", handleClaimed);
  };
};

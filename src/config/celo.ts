import { getCeloMainnetRpcUrl, getRequiredChainId, getTimeLockContractAddress } from "@/config/env";

export const CELO_MAINNET_CHAIN_ID = getRequiredChainId();
export const CELO_MAINNET_CHAIN_ID_HEX = "0xa4ec";
export const CELO_MAINNET_CHAIN_ID_BIGINT = 42220n;
export const CELO_MAINNET_RPC_URL = getCeloMainnetRpcUrl();
export const CELO_MAINNET_EXPLORER_URL = "https://celoscan.io";
export const OFFLINEPAY_CONTRACT_ADDRESS =
  getTimeLockContractAddress() ?? "0x72D90d16A798095b6fC29eCf71867A87729acC31";

export const CELO_MAINNET_CHAIN_PARAMS = {
  chainId: CELO_MAINNET_CHAIN_ID_HEX,
  chainName: "Celo Mainnet",
  nativeCurrency: {
    name: "CELO",
    symbol: "CELO",
    decimals: 18,
  },
  rpcUrls: [CELO_MAINNET_RPC_URL],
  blockExplorerUrls: [CELO_MAINNET_EXPLORER_URL],
} as const;

export const OFFLINEPAY_WALLET_CACHE_KEY = "offlinepay_wallet_state";

export interface OfflinePayWalletState {
  address: string;
  chainId: number | null;
  isConnected: boolean;
  isWrongNetwork: boolean;
  walletAvailable: boolean;
}

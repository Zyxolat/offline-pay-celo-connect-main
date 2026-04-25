import { ethers, type Log, type TransactionReceipt, type TransactionResponse } from 'ethers';
import { config } from '../config/index';
import { TIMELOCK_ABI_REGISTRY, TIMELOCK_CONTRACT_ABI, type TimeLockAbiVersion } from '../contracts/timeLock';
import { getCurrentRpc, getProvider, safeRpc } from '../lib/provider';
import { normalizeError } from '../utils/logger';

const timeLockInterface = new ethers.Interface(TIMELOCK_CONTRACT_ABI);
const timeLockContracts = config.celo.timeLockContracts.map((contractConfig) => ({
  address: contractConfig.address,
  abiVersion: contractConfig.abiVersion as TimeLockAbiVersion,
  abi: TIMELOCK_ABI_REGISTRY[(contractConfig.abiVersion as TimeLockAbiVersion)] ?? TIMELOCK_CONTRACT_ABI,
}));

const ERC20_ABI = [
  'function balanceOf(address account) public view returns (uint256)',
  'function decimals() public view returns (uint8)',
  'function transfer(address to, uint256 amount) public returns (bool)',
  'function approve(address spender, uint256 amount) public returns (bool)',
];

function getCUSDContractAddress() {
  return config.celo.cUSDAddress;
}

function logContractTarget(address: string) {
  console.log('RPC:', getCurrentRpc() ?? process.env.CELO_RPC_URL ?? 'uninitialized');
  console.log('Contract:', address);
}

async function getWithdrawSigner(provider?: ethers.Provider) {
  if (!config.celo.withdrawPrivateKey) {
    return null;
  }

  const signerProvider = provider ?? await getProvider();
  return new ethers.Wallet(config.celo.withdrawPrivateKey, signerProvider);
}

export const celoService = {
  async getProvider() {
    return getProvider();
  },

  async getHttpProvider() {
    return getProvider();
  },

  createWebSocketProvider() {
    if (!config.celo.wsRpcUrl) {
      return null;
    }

    return new ethers.WebSocketProvider(config.celo.wsRpcUrl);
  },

  async getBalance(address: string): Promise<{ cUSD: string; CELO: string }> {
    try {
      const { CELO, cUSD } = await safeRpc(async (provider) => {
        const cUSDAddress = getCUSDContractAddress();
        const cUSDContract = new ethers.Contract(cUSDAddress, ERC20_ABI, provider);
        const [celoBalance, cUSDBalance] = await Promise.all([
          provider.getBalance(address),
          cUSDContract.balanceOf(address),
        ]);

        return {
          CELO: ethers.formatEther(celoBalance),
          cUSD: ethers.formatUnits(cUSDBalance, 18),
        };
      });

      return {
        CELO,
        cUSD,
      };
    } catch (error) {
      console.error('Error fetching balance:', normalizeError(error));
      return { CELO: '0', cUSD: '0' };
    }
  },

  async validateAddress(address: string): Promise<boolean> {
    try {
      return ethers.isAddress(address);
    } catch {
      return false;
    }
  },

  async normalizeAddress(address: string): Promise<string> {
    return ethers.getAddress(address);
  },

  async estimateGasFee(): Promise<string> {
    try {
      const feeData = await safeRpc((provider) => provider.getFeeData());
      if (feeData.gasPrice) {
        const gasEstimate = BigInt(21000); // Standard transfer cost
        const totalFee = gasEstimate * feeData.gasPrice;
        return ethers.formatEther(totalFee);
      }
      return '0.001'; // Default estimate
    } catch (error) {
      console.error('Error estimating gas:', normalizeError(error));
      return '0.001';
    }
  },

  async getTransactionStatus(txHash: string): Promise<{ status: string; confirmations: number } | null> {
    try {
      const receipt = await safeRpc((provider) => provider.getTransactionReceipt(txHash));
      if (!receipt) return null;

      const currentBlock = await safeRpc((provider) => provider.getBlockNumber());
      const confirmations = currentBlock - receipt.blockNumber;

      return {
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        confirmations,
      };
    } catch (error) {
      console.error('Error getting transaction status:', normalizeError(error));
      return null;
    }
  },

  async getTransaction(txHash: string): Promise<TransactionResponse | null> {
    try {
      return await safeRpc((provider) => provider.getTransaction(txHash));
    } catch (error) {
      console.error('Error getting transaction:', normalizeError(error));
      return null;
    }
  },

  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    try {
      return await safeRpc((provider) => provider.getTransactionReceipt(txHash));
    } catch (error) {
      console.error('Error getting transaction receipt:', normalizeError(error));
      return null;
    }
  },

  async getBlock(blockNumber: number) {
    try {
      return await safeRpc((provider) => provider.getBlock(blockNumber));
    } catch (error) {
      console.error('Error getting block:', normalizeError(error));
      return null;
    }
  },

  getIndexedContracts() {
    return timeLockContracts;
  },

  async getTimeLockContract(address?: string, abiVersion?: TimeLockAbiVersion, provider?: ethers.Provider) {
    const resolvedAbi =
      (abiVersion ? TIMELOCK_ABI_REGISTRY[abiVersion] : undefined) ||
      timeLockContracts.find((contract) => !address || contract.address === address)?.abi ||
      TIMELOCK_CONTRACT_ABI;
    const resolvedAddress = address || config.celo.timeLockContractAddress;
    const sharedProvider = provider ?? await getProvider();

    logContractTarget(resolvedAddress);

    return new ethers.Contract(resolvedAddress, resolvedAbi, sharedProvider);
  },

  async getTimeLockContracts(provider?: ethers.Provider) {
    const sharedProvider = provider ?? await getProvider();

    return timeLockContracts.map((contract) => ({
      ...contract,
      contract: new ethers.Contract(contract.address, contract.abi, sharedProvider),
      interface: new ethers.Interface(contract.abi),
    }));
  },

  getTimeLockInterface() {
    return timeLockInterface;
  },

  normalizeLogAddress(log: Log) {
    return ethers.getAddress(log.address);
  },

  async submitTransaction(signedTx: string): Promise<string> {
    try {
      const response = await safeRpc((provider) => provider.broadcastTransaction(signedTx));
      return response.hash;
    } catch (error) {
      const normalizedError = normalizeError(error);
      console.error('Error submitting transaction:', normalizedError);
      throw new Error(`Failed to submit transaction: ${normalizedError.message}`);
    }
  },

  async verifyTransaction(signedTx: string): Promise<boolean> {
    try {
      const tx = ethers.Transaction.from(signedTx);
      return tx !== null;
    } catch {
      return false;
    }
  },

  async getConfiguredSignerAddress(): Promise<string | null> {
    return (await getWithdrawSigner())?.address ?? null;
  },

  async withdraw(params: { token: 'CELO' | 'cUSD'; destinationAddress: string; amount: string }): Promise<string> {
    if (!config.celo.withdrawPrivateKey) {
      throw new Error('Withdraw signer is not configured. Set CELO_WITHDRAW_PRIVATE_KEY on the backend.');
    }

    const parsedAmount = ethers.parseUnits(params.amount, 18);

    if (params.token === 'CELO') {
      const tx = await safeRpc(async (provider) => {
        const signer = await getWithdrawSigner(provider);
        if (!signer) {
          throw new Error('Withdraw signer is not configured. Set CELO_WITHDRAW_PRIVATE_KEY on the backend.');
        }

        return signer.sendTransaction({
          to: params.destinationAddress,
          value: parsedAmount,
        });
      });
      return tx.hash;
    }

    const tx = await safeRpc(async (provider) => {
      const signer = await getWithdrawSigner(provider);
      if (!signer) {
        throw new Error('Withdraw signer is not configured. Set CELO_WITHDRAW_PRIVATE_KEY on the backend.');
      }

      const contract = new ethers.Contract(getCUSDContractAddress(), ERC20_ABI, signer);
      return contract.transfer(params.destinationAddress, parsedAmount);
    });
    return tx.hash;
  },

  // Derive wallet from credential (simplified - in real scenario use more secure methods)
  generateWalletAddress(): string {
    const wallet = ethers.Wallet.createRandom();
    return wallet.address;
  },
};

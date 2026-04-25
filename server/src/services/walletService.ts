import { Decimal } from 'decimal.js';
import qrcode from 'qrcode';
import { UserModel } from '../models/User';
import { TransactionModel } from '../models/Transaction';
import { normalizeError } from '../utils/logger';
import { celoService } from './celoService';
import { contractIndexerService } from './contractIndexerService';
import { transactionService } from './transactionService';

const WITHDRAW_MINIMUMS = {
  CELO: new Decimal('0.001'),
  cUSD: new Decimal('0.01'),
} as const;

export const walletService = {
  async getBalance(userId: string): Promise<{ cUSD: string; CELO: string; address: string; lastSync: string }> {
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('User not found');

    const balance = await celoService.getBalance(user.wallet_address);

    return {
      ...balance,
      address: user.wallet_address,
      lastSync: new Date().toISOString(),
    };
  },

  async getWalletAddress(userId: string): Promise<{ address: string; qrCode: string }> {
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('User not found');

    const qrCode = await qrcode.toDataURL(user.wallet_address);

    return {
      address: user.wallet_address,
      qrCode,
    };
  },

  async getTransactionHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ transactions: any[]; total: number }> {
    await transactionService.reconcileTrackedTransactions();

    const transactions = await TransactionModel.findByUser(userId, limit, offset);
    const total = await TransactionModel.countByUser(userId);

    return {
      transactions: transactions.map(tx => ({
        id: tx.id,
        type: 'send',
        recipient: tx.recipient,
        amount: tx.amount,
        currency: tx.currency,
        status: tx.status,
        timestamp: tx.created_at,
        txHash: tx.tx_hash,
        note: tx.note,
        confirmations: tx.confirmations,
      })),
      total,
    };
  },

  async syncTransaction(
    userId: string,
    payload: {
      txHash: string;
      recipient?: string;
      amount?: string;
      currency?: string;
      status?: 'submitted' | 'pending' | 'confirmed' | 'failed';
      confirmations?: number;
      note?: string;
    }
  ) {
    const result = await contractIndexerService.verifyAndRecordTransaction(payload.txHash, userId);

    return {
      txHash: result.verified.txHash,
      status: result.verified.status,
      recipient: result.verified.recipient,
      amount: result.verified.amount,
      currency: 'CELO',
      confirmations: result.verified.confirmations,
      note: result.verified.note,
    };
  },

  async withdraw(
    userId: string,
    destinationAddress: string,
    token: 'CELO' | 'cUSD',
    amount: string,
  ): Promise<{
    transactionId: string;
    txHash: string;
    sourceAddress: string;
    destinationAddress: string;
    token: 'CELO' | 'cUSD';
    amount: string;
    status: string;
  }> {
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('User not found');

    if (!['CELO', 'cUSD'].includes(token)) {
      throw new Error('Unsupported token selected');
    }

    const isValidDestination = await celoService.validateAddress(destinationAddress);
    if (!isValidDestination) {
      throw new Error('Invalid destination address');
    }

    const normalizedSourceAddress = await celoService.normalizeAddress(user.wallet_address);
    const normalizedDestination = await celoService.normalizeAddress(destinationAddress);

    if (normalizedSourceAddress === normalizedDestination) {
      throw new Error('Destination address must be different from your wallet address');
    }

    let normalizedAmount: Decimal;
    try {
      normalizedAmount = new Decimal(amount);
    } catch {
      throw new Error('Invalid withdrawal amount');
    }

    if (!normalizedAmount.isPositive()) {
      throw new Error('Withdrawal amount must be greater than zero');
    }

    if (normalizedAmount.lessThan(WITHDRAW_MINIMUMS[token])) {
      throw new Error(`Minimum ${token} withdrawal is ${WITHDRAW_MINIMUMS[token].toString()} ${token}`);
    }

    const signerAddress = await celoService.getConfiguredSignerAddress();
    if (!signerAddress) {
      throw new Error('Withdraw signer is not configured. Set CELO_WITHDRAW_PRIVATE_KEY on the backend.');
    }

    const normalizedSignerAddress = await celoService.normalizeAddress(signerAddress);
    if (normalizedSignerAddress !== normalizedSourceAddress) {
      throw new Error('Withdraw signer does not match this wallet address. The backend cannot sign withdrawals for this user yet.');
    }

    const balances = await celoService.getBalance(normalizedSourceAddress);
    const celoBalance = new Decimal(balances.CELO);
    const tokenBalance = new Decimal(token === 'CELO' ? balances.CELO : balances.cUSD);
    const estimatedFee = new Decimal(await celoService.estimateGasFee());

    if (tokenBalance.lessThan(normalizedAmount)) {
      throw new Error(`Insufficient ${token} balance`);
    }

    if (token === 'CELO' && tokenBalance.lessThan(normalizedAmount.plus(estimatedFee))) {
      throw new Error(`Insufficient CELO balance to cover amount plus network fee (~${estimatedFee.toFixed()} CELO).`);
    }

    if (token === 'cUSD' && celoBalance.lessThan(estimatedFee)) {
      throw new Error(`Insufficient CELO balance to cover network fee (~${estimatedFee.toFixed()} CELO).`);
    }

    const transaction = await TransactionModel.create(
      userId,
      normalizedDestination,
      normalizedAmount.toFixed(),
      token,
      'External wallet withdrawal',
    );

    try {
      const txHash = await celoService.withdraw({
        token,
        destinationAddress: normalizedDestination,
        amount: normalizedAmount.toFixed(),
      });

      await TransactionModel.updateStatus(transaction.id, 'submitted', txHash);

      return {
        transactionId: transaction.id,
        txHash,
        sourceAddress: normalizedSourceAddress,
        destinationAddress: normalizedDestination,
        token,
        amount: normalizedAmount.toFixed(),
        status: 'submitted',
      };
    } catch (error) {
      const normalizedError = normalizeError(error);
      await TransactionModel.updateStatus(transaction.id, 'failed');
      throw new Error(normalizedError.message || 'Failed to broadcast withdrawal');
    }
  },
};

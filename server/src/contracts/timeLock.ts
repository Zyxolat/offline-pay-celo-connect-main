export const TIMELOCK_CONTRACT_ABI = [
  'event PaymentCreated(uint256 indexed paymentId, address indexed sender, address indexed recipient, uint256 amount, uint256 unlockTime)',
  'event PaymentClaimed(uint256 indexed paymentId, address indexed recipient, uint256 amount)',
  'function getPayment(uint256 paymentId) view returns ((address sender, address recipient, uint256 amount, uint256 unlockTime, bool claimed))',
  'function paymentCount() view returns (uint256)',
  'function createPayment(address recipient, uint256 duration) payable returns (uint256)',
  'function claimPayment(uint256 paymentId)',
  'function acceptPayment(uint256 paymentId)',
  'function getUserPayments(address user) view returns (uint256[])',
] as const;

export type IndexedPaymentEventName = 'PaymentCreated' | 'PaymentClaimed';
export type TimeLockAbiVersion = 'v1';

export const TIMELOCK_ABI_REGISTRY: Record<TimeLockAbiVersion, readonly string[]> = {
  v1: TIMELOCK_CONTRACT_ABI,
};

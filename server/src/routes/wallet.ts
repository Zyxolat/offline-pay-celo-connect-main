import { Router } from 'express';
import { walletController } from '../controllers/walletController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/balance', walletController.getBalance);
router.get('/address', walletController.getAddress);
router.get('/transactions', walletController.getTransactions);
router.post('/transactions/sync', walletController.syncTransaction);
router.post('/withdraw', walletController.withdraw);

export default router;

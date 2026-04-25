import { Router } from 'express';
import { transactionController } from '../controllers/transactionController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/status/batch', transactionController.getStatusBatch);
router.get('/:txId', transactionController.getDetail);

export default router;

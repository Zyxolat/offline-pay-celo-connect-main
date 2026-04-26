import { Router } from 'express';
import { transactionController } from '../controllers/transactionController';
import { requireUserAuth } from '../middleware/auth';

const router = Router();

router.use(requireUserAuth);

router.get('/status/batch', transactionController.getStatusBatch);
router.get('/:txId', transactionController.getDetail);

export default router;

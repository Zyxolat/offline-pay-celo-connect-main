import { Router } from 'express';
import { queueController } from '../controllers/queueController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.post('/add', queueController.addToQueue);
router.get('/pending', queueController.getPending);
router.post('/sync', queueController.sync);

export default router;

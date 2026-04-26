import { Router } from 'express';
import { queueController } from '../controllers/queueController';
import { requireUserAuth } from '../middleware/auth';

const router = Router();

router.use(requireUserAuth);

router.post('/add', queueController.addToQueue);
router.get('/pending', queueController.getPending);
router.post('/sync', queueController.sync);

export default router;

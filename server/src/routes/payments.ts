import { Router } from 'express';
import { paymentController } from '../controllers/paymentController';
import { authMiddleware } from '../middleware/auth';
import { paymentLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/authorize/challenge', authMiddleware, paymentController.authorizeChallenge);
router.post('/authorize/verify', paymentController.authorizeVerify);
router.post('/submit', paymentLimiter, authMiddleware, paymentController.submitPayment);

export default router;

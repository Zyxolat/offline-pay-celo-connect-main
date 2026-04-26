import { Router } from 'express';
import { paymentController } from '../controllers/paymentController';
import { requireUserAuth } from '../middleware/auth';
import { paymentLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/authorize/challenge', requireUserAuth, paymentController.authorizeChallenge);
router.post('/authorize/verify', paymentController.authorizeVerify);
router.post('/submit', paymentLimiter, requireUserAuth, paymentController.submitPayment);

export default router;

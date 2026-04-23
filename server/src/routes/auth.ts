import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/login', authLimiter, authController.adminLogin);
router.post('/google', authLimiter, authController.authDisabled);
router.post('/webauthn/register/options', authLimiter, authController.authDisabled);
router.post('/webauthn/register/verify', authLimiter, authController.authDisabled);
router.post('/webauthn/login/options', authLimiter, authController.authDisabled);
router.post('/webauthn/login/verify', authLimiter, authController.authDisabled);
router.post('/logout', authController.logout);

export default router;

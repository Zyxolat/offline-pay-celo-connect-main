import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/login', authLimiter, authController.adminLogin);
router.post('/admin/login', authLimiter, authController.adminLogin);
router.post('/google', authLimiter, authController.googleAuth);
router.post('/webauthn/register/options', authLimiter, authController.registerOptions);
router.post('/webauthn/register/verify', authLimiter, authController.registerVerify);
router.post('/webauthn/login/options', authLimiter, authController.loginOptions);
router.post('/webauthn/login/verify', authLimiter, authController.loginVerify);
router.post('/logout', authController.logout);

export default router;

import { Router } from 'express';
import { authController } from '../controllers/authController';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/google', authLimiter, authController.googleStart);
router.get('/google/callback', authLimiter, authController.googleCallback);
router.post('/register', authLimiter, authController.userRegister);
router.post('/login', authLimiter, authController.userLogin);
router.post('/admin/login', authLimiter, authController.adminLogin);
router.post('/webauthn/register/options', authLimiter, authController.registerOptions);
router.post('/webauthn/register/verify', authLimiter, authController.registerVerify);
router.post('/webauthn/login/options', authLimiter, authController.loginOptions);
router.post('/webauthn/login/verify', authLimiter, authController.loginVerify);
router.post('/logout', authController.logout);

export default router;

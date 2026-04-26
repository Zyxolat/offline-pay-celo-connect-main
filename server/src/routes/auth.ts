import { Router, type Request, type Response } from 'express';
import { authController } from '../controllers/authController';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

// Google OAuth — GET initiates the redirect flow; POST is not a valid entry
// point but some clients may call it. Redirect POST to the GET handler so
// the browser follows the OAuth flow instead of receiving a 404.
router.get('/google', authLimiter, authController.googleStart);
router.post('/google', authLimiter, (req: Request, res: Response) => {
  const redirectTo = typeof req.body?.redirectTo === 'string' ? req.body.redirectTo : req.query.redirectTo;
  const qs = redirectTo ? `?redirectTo=${encodeURIComponent(String(redirectTo))}` : '';
  res.redirect(302, `/api/auth/google${qs}`);
});
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

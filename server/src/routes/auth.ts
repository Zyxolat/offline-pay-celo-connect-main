import { Router, type Request, type Response } from 'express';
import { authController } from '../controllers/authController';
import { passkeyLimiter, authLimiter } from '../middleware/rateLimiter';

const router = Router();

// Google OAuth — GET initiates the redirect flow; POST is not a valid entry
// point but some clients may call it. Redirect POST to the GET handler so
// the browser follows the OAuth flow instead of receiving a 404.
router.get('/google', authLimiter, authController.googleStart);
<<<<<<< HEAD
router.post('/google', authLimiter, (req: Request, res: Response) => {
  const redirectTo = typeof req.body?.redirectTo === 'string' ? req.body.redirectTo : req.query.redirectTo;
  const qs = redirectTo ? `?redirectTo=${encodeURIComponent(String(redirectTo))}` : '';
  res.redirect(302, `/api/auth/google${qs}`);
});
=======
router.post('/google', authLimiter, authController.googleStart);
>>>>>>> fb7ffea (fix auth passkey limiter challenge and signup flow)
router.get('/google/callback', authLimiter, authController.googleCallback);
router.post('/register', authLimiter, authController.userRegister);
router.post('/login', authLimiter, authController.userLogin);
router.post('/admin/login', authLimiter, authController.adminLogin);
router.post('/webauthn/register/options', passkeyLimiter, authController.registerOptions);
router.post('/webauthn/register/verify', passkeyLimiter, authController.registerVerify);
router.post('/webauthn/login/options', passkeyLimiter, authController.loginOptions);
router.post('/webauthn/login/verify', passkeyLimiter, authController.loginVerify);
router.post('/logout', authController.logout);

export default router;

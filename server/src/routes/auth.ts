import { Router, type Request, type Response } from 'express';
import { authController } from '../controllers/authController';
import { passkeyLimiter, authLimiter } from '../middleware/rateLimiter';

const router = Router();

// Google OAuth
router.get('/google', authLimiter, authController.googleStart);

// Redirect POST requests into the GET OAuth flow
router.post('/google', authLimiter, (req: Request, res: Response) => {
  const redirectTo =
    typeof req.body?.redirectTo === 'string'
      ? req.body.redirectTo
      : req.query.redirectTo;

  const qs = redirectTo
    ? `?redirectTo=${encodeURIComponent(String(redirectTo))}`
    : '';

  res.redirect(302, `/api/auth/google${qs}`);
});

router.get('/google/callback', authLimiter, authController.googleCallback);

// Standard auth
router.post('/register', authLimiter, authController.userRegister);
router.post('/login', authLimiter, authController.userLogin);
router.post('/admin/login', authLimiter, authController.adminLogin);

// Passkey / WebAuthn
router.post(
  '/webauthn/register/options',
  passkeyLimiter,
  authController.registerOptions
);

router.post(
  '/webauthn/register/verify',
  passkeyLimiter,
  authController.registerVerify
);

router.post(
  '/webauthn/login/options',
  passkeyLimiter,
  authController.loginOptions
);

router.post(
  '/webauthn/login/verify',
  passkeyLimiter,
  authController.loginVerify
);

// Logout
router.post('/logout', authController.logout);

export default router;
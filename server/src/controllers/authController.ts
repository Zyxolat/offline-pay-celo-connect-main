import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';
import bcrypt from 'bcryptjs';
import { type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { webauthnConfig } from '../config/webauthn.js';
import { config } from '../config/index.js';
import { AuthSessionModel } from '../models/AuthSession.js';
import { OAuthProviderModel } from '../models/AuthModels.js';
import { ChallengeModel, type WebAuthnChallenge } from '../models/Challenge.js';
import { CredentialModel } from '../models/Credential.js';
import { UserModel, type User } from '../models/User.js';
import { tokenService } from '../services/tokenService.js';
import { celoService } from '../services/celoService.js';
import { log, normalizeError } from '../utils/logger.js';
import { errorResponse, successResponse, validateWithSchema } from '../utils/validators.js';

const adminLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const webauthnEmailSchema = z.object({
  email: z.string().trim().email(),
});

const googleStartQuerySchema = z.object({
  redirectTo: z.string().trim().optional(),
});

const googleCallbackQuerySchema = z.object({
  code: z.string().trim().optional(),
  state: z.string().trim().optional(),
  error: z.string().trim().optional(),
  error_description: z.string().trim().optional(),
});

const registrationVerifySchema = z.object({
  email: z.string().trim().email(),
  challengeId: z.string().trim().uuid(),
  credential: z.custom<RegistrationResponseJSON>(),
});

const authenticationVerifySchema = z.object({
  email: z.string().trim().email(),
  challengeId: z.string().trim().uuid(),
  credential: z.custom<AuthenticationResponseJSON>(),
});

const disabledAuthMessage = 'Unauthorized';
const GOOGLE_STATE_TTL = '10m';
const GOOGLE_CALLBACK_PATH = '/auth/google/callback';
const GOOGLE_FRONTEND_CALLBACK_PATH = '/auth/google/callback';

// Log Google OAuth configuration at startup for easier debugging
if (config.google.enabled) {
  log('INFO', 'Google OAuth configured', {
    callbackUrl: config.google.callbackUrl,
    clientIdConfigured: Boolean(config.google.clientId),
  });
} else {
  log('WARN', 'Google OAuth is disabled (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set)');
}

type SessionAuthMethod = 'admin' | 'passkey' | 'google';

type GoogleStatePayload = {
  purpose: 'google_oauth_state';
  redirectTo: string;
  iat?: number;
  exp?: number;
};

const googleOAuthClient = config.google.enabled
  ? new OAuth2Client(config.google.clientId, config.google.clientSecret, config.google.callbackUrl)
  : null;

const normalizeIp = (value?: string | null) => value?.replace(/^::ffff:/, '') ?? '';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const bufferToBase64Url = (value: Buffer | Uint8Array) => Buffer.from(value).toString('base64url');

const asAuthenticatorTransports = (transports?: string[] | null) =>
  (transports ?? []) as AuthenticatorTransport[];

const getRequestId = (res: Response) => String(res.locals.requestId || '');

const buildSessionUser = (user: User, authMethod: SessionAuthMethod) => ({
  id: user.id,
  email: user.email,
  role: user.is_admin ? ('admin' as const) : ('user' as const),
  isAdmin: Boolean(user.is_admin),
  authMethod,
  walletAddress: user.wallet_address,
});

const createSession = async (user: User, authMethod: SessionAuthMethod) => {
  const sessionToken = tokenService.generateToken({
    userId: user.id,
    email: user.email,
    role: user.is_admin ? 'admin' : 'user',
    authMethod,
  });

  await AuthSessionModel.create(sessionToken, {
    userId: user.id,
    isAdmin: Boolean(user.is_admin),
    sessionType: authMethod,
  });

  return {
    sessionToken,
    user: buildSessionUser(user, authMethod),
  };
};

const logAuthEvent = (
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  res: Response,
  meta?: Record<string, unknown>,
) => {
  log(level, message, {
    requestId: getRequestId(res),
    ...meta,
  });
};

const rejectAdminEmailFromUserFlow = (res: Response, email: string) => {
  if (normalizeEmail(email) === normalizeEmail(config.admin.email)) {
    errorResponse(res, 'Admin account must use the admin login form.', 403);
    return true;
  }

  return false;
};

const assertAdminIpAllowed = (req: Request) => {
  const allowedIps = config.admin.allowedIps.map((ip) => normalizeIp(ip));
  if (allowedIps.length === 0) {
    return true;
  }

  return allowedIps.includes(normalizeIp(req.ip));
};

const normalizeRedirectTo = (value?: string) => {
  if (!value) {
    return '/dashboard';
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/dashboard';
  }

  return trimmed;
};

const encodeFrontendResult = (payload: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');

const buildFrontendGoogleCallbackUrl = (params: Record<string, string>) => {
  const callbackUrl = new URL(GOOGLE_FRONTEND_CALLBACK_PATH, config.frontend.url);
  callbackUrl.hash = new URLSearchParams(params).toString();
  return callbackUrl.toString();
};

const redirectToFrontendGoogleCallback = (
  res: Response,
  payload:
    | { status: 'success'; sessionToken: string; user: ReturnType<typeof buildSessionUser>; redirectTo: string }
    | { status: 'error'; error: string; redirectTo?: string },
) => {
  const url =
    payload.status === 'success'
      ? buildFrontendGoogleCallbackUrl({
          result: encodeFrontendResult({
            sessionToken: payload.sessionToken,
            user: payload.user,
            redirectTo: payload.redirectTo,
          }),
        })
      : buildFrontendGoogleCallbackUrl({
          error: payload.error,
          ...(payload.redirectTo ? { redirectTo: payload.redirectTo } : {}),
        });

  res.redirect(302, url);
};

const issueGoogleStateToken = (redirectTo: string) =>
  jwt.sign(
    {
      purpose: 'google_oauth_state',
      redirectTo,
    } satisfies Omit<GoogleStatePayload, 'iat' | 'exp'>,
    config.jwt.secret,
    { expiresIn: GOOGLE_STATE_TTL },
  );

const verifyGoogleStateToken = (state: string): GoogleStatePayload => {
  const decoded = jwt.verify(state, config.jwt.secret);
  if (
    typeof decoded !== 'object' ||
    !decoded ||
    decoded.purpose !== 'google_oauth_state' ||
    typeof decoded.redirectTo !== 'string'
  ) {
    throw new Error('Invalid Google OAuth state token.');
  }

  return decoded as GoogleStatePayload;
};

const mapGoogleOAuthError = (error: unknown) => {
  const normalized = normalizeError(error);
  const lowerMessage = normalized.message.toLowerCase();

  if (lowerMessage.includes('invalid_grant')) {
    return 'Google sign-in expired or the callback URL did not match. Please try again.';
  }

  if (lowerMessage.includes('redirect_uri_mismatch')) {
    return 'Google sign-in is misconfigured. The registered callback URL does not match this app.';
  }

  if (lowerMessage.includes('state')) {
    return 'Google sign-in state was invalid or expired. Please try again.';
  }

  return 'Google sign-in could not be completed. Please try again.';
};

const getValidChallenge = async (
  challengeId: string,
  expectedPurpose: 'registration' | 'login',
  expectedUserId: string,
): Promise<WebAuthnChallenge | null> => {
  const challenge = await ChallengeModel.findById(challengeId);
  if (!challenge) {
    return null;
  }

  if (challenge.purpose !== expectedPurpose || challenge.user_id !== expectedUserId) {
    return null;
  }

  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return challenge;
};

const getGoogleCallbackRedirectTo = (req: Request) => {
  try {
    const validatedQuery = googleCallbackQuerySchema.parse(req.query);
    if (validatedQuery.state) {
      return verifyGoogleStateToken(validatedQuery.state).redirectTo;
    }
  } catch {
    return '/dashboard';
  }

  return '/dashboard';
};

export const authController = {
  async adminLogin(req: Request, res: Response) {
    try {
      const payload = validateWithSchema(res, adminLoginSchema, req.body);
      if (!payload) {
        return;
      }

      const email = normalizeEmail(payload.email);
      if (email !== normalizeEmail(config.admin.email)) {
        return errorResponse(res, disabledAuthMessage, 403);
      }

      if (!assertAdminIpAllowed(req)) {
        return errorResponse(res, disabledAuthMessage, 403);
      }

      const passwordMatches = await bcrypt.compare(payload.password, config.admin.passwordHash);
      if (!passwordMatches) {
        return errorResponse(res, disabledAuthMessage, 403);
      }

      const adminUser = await UserModel.ensureSingleAdminAccount(
        config.admin.email,
        celoService.generateWalletAddress(),
      );

      const session = await createSession(adminUser, 'admin');
      successResponse(res, session);
    } catch (error) {
      logAuthEvent('ERROR', 'Admin login failed', res, {
        error: normalizeError(error),
      });
      errorResponse(res, 'Failed to log in', 500);
    }
  },

  async googleStart(req: Request, res: Response) {
    try {
      if (!config.google.enabled || !googleOAuthClient) {
        logAuthEvent('WARN', 'Google sign-in attempted while disabled', res);
        return redirectToFrontendGoogleCallback(res, {
          status: 'error',
          error: 'Google sign-in is not configured on this server.',
        });
      }

      const parsedQuery = validateWithSchema(res, googleStartQuerySchema, req.query);
      if (!parsedQuery) {
        return;
      }

      const redirectTo = normalizeRedirectTo(parsedQuery.redirectTo);
      const state = issueGoogleStateToken(redirectTo);
      const authUrl = googleOAuthClient.generateAuthUrl({
        access_type: 'offline',
        prompt: 'select_account',
        scope: ['openid', 'email', 'profile'],
        redirect_uri: config.google.callbackUrl,
        state,
      });

      logAuthEvent('INFO', 'Redirecting to Google OAuth', res, {
        redirectTo,
        callbackUrl: config.google.callbackUrl,
      });

      res.redirect(302, authUrl);
    } catch (error) {
      logAuthEvent('ERROR', 'Failed to start Google OAuth', res, {
        error: normalizeError(error),
      });
      redirectToFrontendGoogleCallback(res, {
        status: 'error',
        error: mapGoogleOAuthError(error),
      });
    }
  },

  async googleCallback(req: Request, res: Response) {
    const redirectTo = getGoogleCallbackRedirectTo(req);

    try {
      if (!config.google.enabled || !googleOAuthClient) {
        logAuthEvent('WARN', 'Google callback received while disabled', res);
        return redirectToFrontendGoogleCallback(res, {
          status: 'error',
          error: 'Google sign-in is not configured on this server.',
          redirectTo,
        });
      }

      const payload = validateWithSchema(res, googleCallbackQuerySchema, req.query);
      if (!payload) {
        return;
      }

      if (payload.error) {
        logAuthEvent('WARN', 'Google OAuth callback returned an error', res, {
          error: payload.error,
          errorDescription: payload.error_description,
          redirectTo,
        });
        return redirectToFrontendGoogleCallback(res, {
          status: 'error',
          error: payload.error_description || 'Google sign-in was cancelled or denied.',
          redirectTo,
        });
      }

      if (!payload.code || !payload.state) {
        logAuthEvent('WARN', 'Google OAuth callback missing required query params', res, {
          hasCode: Boolean(payload.code),
          hasState: Boolean(payload.state),
          redirectTo,
        });
        return redirectToFrontendGoogleCallback(res, {
          status: 'error',
          error: 'Google sign-in callback was incomplete. Please try again.',
          redirectTo,
        });
      }

      const statePayload = verifyGoogleStateToken(payload.state);
      const tokenResponse = await googleOAuthClient.getToken({
        code: payload.code,
        redirect_uri: config.google.callbackUrl,
      });

      logAuthEvent('INFO', 'Google OAuth callback token response received', res, {
        redirectTo: statePayload.redirectTo,
        hasIdToken: Boolean(tokenResponse.tokens.id_token),
        hasAccessToken: Boolean(tokenResponse.tokens.access_token),
      });

      const idToken = tokenResponse.tokens.id_token;
      if (!idToken) {
        return redirectToFrontendGoogleCallback(res, {
          status: 'error',
          error: 'Google sign-in did not return a valid identity token.',
          redirectTo: statePayload.redirectTo,
        });
      }

      const ticket = await googleOAuthClient.verifyIdToken({
        idToken,
        audience: config.google.clientId,
      });
      const claims = ticket.getPayload();

      if (!claims?.sub || !claims.email || !claims.email_verified) {
        logAuthEvent('WARN', 'Google identity payload missing required claims', res, {
          hasSub: Boolean(claims?.sub),
          hasEmail: Boolean(claims?.email),
          emailVerified: Boolean(claims?.email_verified),
        });
        return redirectToFrontendGoogleCallback(res, {
          status: 'error',
          error: 'Google account email could not be verified.',
          redirectTo: statePayload.redirectTo,
        });
      }

      const email = normalizeEmail(claims.email);
      if (normalizeEmail(email) === normalizeEmail(config.admin.email)) {
        return redirectToFrontendGoogleCallback(res, {
          status: 'error',
          error: 'Admin account must use the admin login form.',
          redirectTo: statePayload.redirectTo,
        });
      }

      const existingLinkedUser = await OAuthProviderModel.findByProvider('google', claims.sub);
      const user =
        existingLinkedUser ??
        (await UserModel.upsertGoogleUser(email, claims.sub, celoService.generateWalletAddress()));

      await OAuthProviderModel.linkProvider(user.id, 'google', claims.sub, email);
      await AuthSessionModel.revokeUserSessions(user.id);

      const session = await createSession(user, 'google');

      logAuthEvent('INFO', 'Google sign-in verified', res, {
        userId: user.id,
        email,
        googleSubject: claims.sub,
        redirectTo: statePayload.redirectTo,
      });

      redirectToFrontendGoogleCallback(res, {
        status: 'success',
        sessionToken: session.sessionToken,
        user: session.user,
        redirectTo: statePayload.redirectTo,
      });
    } catch (error) {
      logAuthEvent('ERROR', 'Google sign-in failed', res, {
        error: normalizeError(error),
        callbackUrl: config.google.callbackUrl,
        redirectTo,
      });
      redirectToFrontendGoogleCallback(res, {
        status: 'error',
        error: mapGoogleOAuthError(error),
        redirectTo,
      });
    }
  },

  async registerOptions(req: Request, res: Response) {
    try {
      const payload = validateWithSchema(res, webauthnEmailSchema, req.body);
      if (!payload) {
        return;
      }

      const email = normalizeEmail(payload.email);
      if (rejectAdminEmailFromUserFlow(res, email)) {
        return;
      }

      let user = await UserModel.findByEmail(email);
      if (user?.is_admin) {
        return errorResponse(res, 'Admin account must use the admin login form.', 403);
      }

      if (!user) {
        user = await UserModel.create(email, celoService.generateWalletAddress());
      }

      const existingCredentials = await CredentialModel.findByUserId(user.id);
      if (existingCredentials.length > 0) {
        return errorResponse(res, 'An account already exists for this email. Sign in instead.', 409);
      }

      const options = await webauthnConfig.generateRegistrationOptions(user.id, email);
      await ChallengeModel.deleteActiveByUser(user.id, 'registration');
      const challenge = await ChallengeModel.create(Buffer.from(options.challenge, 'base64url'), 'registration', user.id);

      logAuthEvent('INFO', 'Passkey registration options generated', res, {
        userId: user.id,
        email,
        challengeId: challenge.id,
        rpId: config.webauthn.rpID,
        origin: config.webauthn.origin,
      });

      successResponse(res, {
        challengeId: challenge.id,
        options,
      });
    } catch (error) {
      logAuthEvent('ERROR', 'Passkey registration options failed', res, {
        error: normalizeError(error),
      });
      errorResponse(res, 'Failed to start passkey registration', 500);
    }
  },

  async registerVerify(req: Request, res: Response) {
    try {
      const payload = validateWithSchema(res, registrationVerifySchema, req.body);
      if (!payload) {
        return;
      }

      const email = normalizeEmail(payload.email);
      if (rejectAdminEmailFromUserFlow(res, email)) {
        return;
      }

      const user = await UserModel.findByEmail(email);
      if (!user || user.is_admin) {
        return errorResponse(res, 'User account not found for this registration attempt.', 404);
      }

      const challenge = await getValidChallenge(payload.challengeId, 'registration', user.id);
      if (!challenge) {
        return errorResponse(res, 'Registration challenge not found or expired.', 400);
      }

      const existingCredential = await CredentialModel.findByCredentialId(payload.credential.id);
      if (existingCredential && existingCredential.user_id !== user.id) {
        return errorResponse(res, 'This passkey is already linked to another account.', 409);
      }

      const verification = await webauthnConfig.verifyRegistrationResponse({
        response: payload.credential,
        expectedChallenge: bufferToBase64Url(challenge.challenge),
        expectedOrigin: config.webauthn.origin,
        expectedRPID: config.webauthn.rpID,
        requireUserVerification: true,
      });

      logAuthEvent('INFO', 'Passkey registration verification completed', res, {
        userId: user.id,
        email,
        challengeId: challenge.id,
        verified: verification.verified,
        hasRegistrationInfo: Boolean(verification.registrationInfo),
      });

      if (!verification.verified || !verification.registrationInfo) {
        return errorResponse(res, 'Passkey registration could not be verified.', 400);
      }

      if (!existingCredential) {
        await CredentialModel.create(
          user.id,
          payload.credential.id,
          Buffer.from(verification.registrationInfo.credentialPublicKey),
          {
            credentialPublicKey: Array.from(verification.registrationInfo.credentialPublicKey),
            credentialID: bufferToBase64Url(verification.registrationInfo.credentialID),
            credentialDeviceType: verification.registrationInfo.credentialDeviceType,
            credentialBackedUp: verification.registrationInfo.credentialBackedUp,
          },
          payload.credential.response.transports ?? [],
          verification.registrationInfo.counter,
        );
      }

      await UserModel.setPasskeyId(user.id, payload.credential.id);
      await ChallengeModel.delete(challenge.id);
      await AuthSessionModel.revokeUserSessions(user.id);

      const freshUser = (await UserModel.findById(user.id)) ?? user;
      const session = await createSession(freshUser, 'passkey');
      successResponse(res, session);
    } catch (error) {
      logAuthEvent('ERROR', 'Passkey registration verification failed', res, {
        error: normalizeError(error),
      });
      errorResponse(res, 'Failed to verify passkey registration', 400);
    }
  },

  async loginOptions(req: Request, res: Response) {
    try {
      const payload = validateWithSchema(res, webauthnEmailSchema, req.body);
      if (!payload) {
        return;
      }

      const email = normalizeEmail(payload.email);
      if (rejectAdminEmailFromUserFlow(res, email)) {
        return;
      }

      const user = await UserModel.findByEmail(email);
      if (!user || user.is_admin) {
        return errorResponse(res, 'No user account found for this email.', 404);
      }

      const credentials = await CredentialModel.findByUserId(user.id);
      if (credentials.length === 0) {
        return errorResponse(res, 'No passkey is registered for this account yet.', 404);
      }

      const options = await webauthnConfig.generateAuthenticationOptions(
        credentials.map((credential) => ({
          id: Buffer.from(credential.credential_id, 'base64url'),
          type: 'public-key' as const,
          transports: asAuthenticatorTransports(credential.transports),
        })),
      );

      await ChallengeModel.deleteActiveByUser(user.id, 'login');
      const challenge = await ChallengeModel.create(Buffer.from(options.challenge, 'base64url'), 'login', user.id);

      logAuthEvent('INFO', 'Passkey login options generated', res, {
        userId: user.id,
        email,
        challengeId: challenge.id,
        allowCredentials: options.allowCredentials?.length ?? 0,
      });

      successResponse(res, {
        challengeId: challenge.id,
        options,
      });
    } catch (error) {
      logAuthEvent('ERROR', 'Passkey login options failed', res, {
        error: normalizeError(error),
      });
      errorResponse(res, 'Failed to start passkey login', 500);
    }
  },

  async loginVerify(req: Request, res: Response) {
    try {
      const payload = validateWithSchema(res, authenticationVerifySchema, req.body);
      if (!payload) {
        return;
      }

      const email = normalizeEmail(payload.email);
      if (rejectAdminEmailFromUserFlow(res, email)) {
        return;
      }

      const user = await UserModel.findByEmail(email);
      if (!user || user.is_admin) {
        return errorResponse(res, 'No user account found for this email.', 404);
      }

      const challenge = await getValidChallenge(payload.challengeId, 'login', user.id);
      if (!challenge) {
        return errorResponse(res, 'Login challenge not found or expired.', 400);
      }

      const credential = await CredentialModel.findByCredentialId(payload.credential.id);
      if (!credential || credential.user_id !== user.id) {
        return errorResponse(res, 'This passkey is not registered for the supplied account.', 401);
      }

      const verification = await webauthnConfig.verifyAuthenticationResponse({
        response: payload.credential,
        expectedChallenge: bufferToBase64Url(challenge.challenge),
        expectedOrigin: config.webauthn.origin,
        expectedRPID: config.webauthn.rpID,
        authenticator: {
          credentialID: Buffer.from(credential.credential_id, 'base64url'),
          credentialPublicKey: new Uint8Array(credential.public_key),
          counter: credential.counter,
          transports: asAuthenticatorTransports(credential.transports),
        },
        requireUserVerification: true,
      });

      logAuthEvent('INFO', 'Passkey login verification completed', res, {
        userId: user.id,
        email,
        challengeId: challenge.id,
        credentialId: payload.credential.id,
        verified: verification.verified,
      });

      if (!verification.verified) {
        return errorResponse(res, 'Passkey login could not be verified.', 401);
      }

      await CredentialModel.updateCounter(payload.credential.id, verification.authenticationInfo.newCounter);
      await UserModel.setPasskeyId(user.id, payload.credential.id);
      await ChallengeModel.delete(challenge.id);
      await AuthSessionModel.revokeUserSessions(user.id);

      const freshUser = (await UserModel.findById(user.id)) ?? user;
      const session = await createSession(freshUser, 'passkey');
      successResponse(res, session);
    } catch (error) {
      logAuthEvent('ERROR', 'Passkey login verification failed', res, {
        error: normalizeError(error),
      });
      errorResponse(res, 'Failed to verify passkey login', 401);
    }
  },

  async logout(req: Request, res: Response) {
    try {
      const token = tokenService.parseAuthHeader(req.headers.authorization);
      if (token) {
        await AuthSessionModel.revoke(token);
      }

      successResponse(res, { message: 'Logged out successfully' });
    } catch (error) {
      logAuthEvent('ERROR', 'Logout failed', res, {
        error: normalizeError(error),
      });
      errorResponse(res, 'Logout failed', 500);
    }
  },
};

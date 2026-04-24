import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';
import bcrypt from 'bcryptjs';
import { type Request, type Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { webauthnConfig } from '../config/webauthn.js';
import { config } from '../config/index.js';
import { AuthSessionModel } from '../models/AuthSession.js';
import { OAuthProviderModel } from '../models/AuthModels.js';
import { ChallengeModel } from '../models/Challenge.js';
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

const registrationVerifySchema = z.object({
  email: z.string().trim().email(),
  credential: z.custom<RegistrationResponseJSON>(),
});

const authenticationVerifySchema = z.object({
  email: z.string().trim().email(),
  credential: z.custom<AuthenticationResponseJSON>(),
});

const googleExchangeSchema = z.object({
  code: z.string().trim().min(1),
  redirectUri: z.string().trim().url(),
});

const disabledAuthMessage = 'Unauthorized';

const googleOAuthClient = config.google.enabled
  ? new OAuth2Client(config.google.clientId, config.google.clientSecret, config.google.redirectUri)
  : null;

const normalizeIp = (value?: string | null) => value?.replace(/^::ffff:/, '') ?? '';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const buildSessionUser = (user: User, authMethod: 'admin' | 'passkey' | 'google') => ({
  id: user.id,
  email: user.email,
  role: user.is_admin ? ('admin' as const) : ('user' as const),
  isAdmin: Boolean(user.is_admin),
  authMethod,
  walletAddress: user.wallet_address,
});

const createSession = async (user: User, authMethod: 'admin' | 'passkey' | 'google') => {
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

const assertAdminIpAllowed = (req: Request) => {
  const allowedIps = config.admin.allowedIps.map((ip) => normalizeIp(ip));
  if (allowedIps.length === 0) {
    return true;
  }

  return allowedIps.includes(normalizeIp(req.ip));
};

const bufferToBase64Url = (value: Buffer | Uint8Array) => Buffer.from(value).toString('base64url');

const asAuthenticatorTransports = (transports?: string[] | null) =>
  (transports ?? []) as AuthenticatorTransport[];

const rejectAdminEmailFromUserFlow = (res: Response, email: string) => {
  if (normalizeEmail(email) === normalizeEmail(config.admin.email)) {
    errorResponse(res, 'Admin account must use the admin login form.', 403);
    return true;
  }

  return false;
};

const getRequestId = (res: Response) => String(res.locals.requestId || '');

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

const mapGoogleOAuthError = (error: unknown) => {
  const normalized = normalizeError(error);
  const lowerMessage = normalized.message.toLowerCase();

  if (lowerMessage.includes('invalid_grant')) {
    return 'Google sign-in expired or the callback URL did not match. Please try again.';
  }

  if (lowerMessage.includes('redirect_uri_mismatch')) {
    return 'Google sign-in is misconfigured. The registered callback URL does not match this app.';
  }

  return 'Google sign-in could not be completed. Please try again.';
};

const findActiveChallenge = async (
  userId: string,
  purpose: 'registration' | 'login',
) => ChallengeModel.findLatestActiveByUser(userId, purpose);

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
      console.error('Admin login error:', normalizeError(error));
      errorResponse(res, 'Failed to log in', 500);
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
      await ChallengeModel.create(Buffer.from(options.challenge, 'base64url'), 'registration', user.id);
      logAuthEvent('INFO', 'Passkey registration challenge created', res, {
        userId: user.id,
        email,
        challengeLength: options.challenge.length,
      });

      successResponse(res, {
        options,
      });
    } catch (error) {
      console.error('Registration options error:', normalizeError(error));
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

      const challenge = await findActiveChallenge(user.id, 'registration');
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
      logAuthEvent('INFO', 'Passkey registration verified', res, {
        userId: user.id,
        email,
        credentialId: payload.credential.id,
      });

      const freshUser = (await UserModel.findById(user.id)) ?? user;
      const session = await createSession(freshUser, 'passkey');

      successResponse(res, session);
    } catch (error) {
      console.error('Registration verify error:', normalizeError(error));
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
      await ChallengeModel.create(Buffer.from(options.challenge, 'base64url'), 'login', user.id);
      logAuthEvent('INFO', 'Passkey login challenge created', res, {
        userId: user.id,
        email,
        allowCredentials: options.allowCredentials?.length ?? 0,
      });

      successResponse(res, {
        options,
      });
    } catch (error) {
      console.error('Login options error:', normalizeError(error));
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

      const challenge = await findActiveChallenge(user.id, 'login');
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

      if (!verification.verified) {
        return errorResponse(res, 'Passkey login could not be verified.', 401);
      }

      await CredentialModel.updateCounter(payload.credential.id, verification.authenticationInfo.newCounter);
      await UserModel.setPasskeyId(user.id, payload.credential.id);
      await ChallengeModel.delete(challenge.id);
      await AuthSessionModel.revokeUserSessions(user.id);
      logAuthEvent('INFO', 'Passkey login verified', res, {
        userId: user.id,
        email,
        credentialId: payload.credential.id,
      });

      const freshUser = (await UserModel.findById(user.id)) ?? user;
      const session = await createSession(freshUser, 'passkey');

      successResponse(res, session);
    } catch (error) {
      console.error('Login verify error:', normalizeError(error));
      errorResponse(res, 'Failed to verify passkey login', 401);
    }
  },

  async googleAuth(req: Request, res: Response) {
    try {
      if (!config.google.enabled || !googleOAuthClient) {
        logAuthEvent('WARN', 'Google sign-in attempted while disabled', res);
        return errorResponse(res, 'Google sign-in is not configured on this server.', 503);
      }

      const payload = validateWithSchema(res, googleExchangeSchema, req.body);
      if (!payload) {
        return;
      }

      if (payload.redirectUri !== config.google.redirectUri) {
        logAuthEvent('WARN', 'Google redirect URI mismatch', res, {
          receivedRedirectUri: payload.redirectUri,
          expectedRedirectUri: config.google.redirectUri,
        });
        return errorResponse(
          res,
          'Google sign-in is misconfigured. The callback URL does not match the server configuration.',
          400,
        );
      }

      const tokenResponse = await googleOAuthClient.getToken({
        code: payload.code,
        redirect_uri: payload.redirectUri,
      });
      const idToken = tokenResponse.tokens.id_token;

      if (!idToken) {
        logAuthEvent('WARN', 'Google token exchange returned no id_token', res);
        return errorResponse(res, 'Google sign-in did not return a valid identity token.', 401);
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
        return errorResponse(res, 'Google account email could not be verified.', 401);
      }

      const email = normalizeEmail(claims.email);
      if (rejectAdminEmailFromUserFlow(res, email)) {
        return;
      }

      const user = await UserModel.upsertGoogleUser(
        email,
        claims.sub,
        celoService.generateWalletAddress(),
      );
      await OAuthProviderModel.linkProvider(user.id, 'google', claims.sub, email);
      await AuthSessionModel.revokeUserSessions(user.id);
      logAuthEvent('INFO', 'Google sign-in verified', res, {
        userId: user.id,
        email,
        googleSubject: claims.sub,
      });

      const session = await createSession(user, 'google');
      successResponse(res, session);
    } catch (error) {
      logAuthEvent('ERROR', 'Google sign-in failed', res, {
        error: normalizeError(error),
      });
      errorResponse(res, mapGoogleOAuthError(error), 401);
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
      console.error('Logout error:', normalizeError(error));
      errorResponse(res, 'Logout failed', 500);
    }
  },
};

import { FormEvent, useMemo, useState } from 'react';
import { Fingerprint, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { GoogleAuthButton } from '@/components/auth/GoogleAuthButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthLayout } from '@/components/auth/AuthLayout';
import {
  getStoredUser,
  hasStoredSession,
  isAdminUser,
  storeSession,
} from '@/lib/auth';
import { authAPI } from '@/services/apiClient';
import {
  processCredentialCreationOptions,
  processCredentialRequestOptions,
  serializePublicKeyCredential,
} from '@/utils/webauthn';

type AuthMode = 'user' | 'admin';
type PasskeyAction = 'login' | 'signup';
type PasswordAction = 'login' | 'signup';
type UserAuthMethod = 'passkey' | 'password';

const getErrorMessage = (error: unknown, fallback: string) => {
  const maybeAxiosError = error as {
    response?: {
      data?: {
        error?: string;
      };
    };
    message?: string;
  };

  return maybeAxiosError.response?.data?.error || maybeAxiosError.message || fallback;
};

const getPasskeyErrorMessage = (error: unknown, fallback: string) => {
  const maybeDomError = error as DOMException & { message?: string };

  if (maybeDomError?.name === 'NotAllowedError') {
    return 'Passkey request was cancelled or timed out. Please try again.';
  }

  if (maybeDomError?.message?.includes('challenge')) {
    return 'Passkey request expired or was malformed. Please try again.';
  }

  return getErrorMessage(error, fallback);
};

const canUsePasskeys = async () => {
  if (!window.isSecureContext) {
    return 'Passkeys require a secure context (HTTPS or localhost).';
  }

  if (!window.PublicKeyCredential || !navigator.credentials) {
    return 'This browser does not support passkeys.';
  }

  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      return 'No compatible platform authenticator is available on this device.';
    }
  }

  return null;
};

export const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const storedUser = getStoredUser();
  const isAdminEntry = Boolean(
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname?.startsWith('/admin'),
  );
  const isSignupEntry = location.pathname.endsWith('/signup');
  const [mode, setMode] = useState<AuthMode>(isAdminEntry ? 'admin' : 'user');
  const [userAuthMethod, setUserAuthMethod] = useState<UserAuthMethod>(isSignupEntry ? 'password' : 'passkey');
  const [passkeyAction, setPasskeyAction] = useState<PasskeyAction>(isSignupEntry ? 'signup' : 'login');
  const [passwordAction, setPasswordAction] = useState<PasswordAction>(isSignupEntry ? 'signup' : 'login');
  const [userEmail, setUserEmail] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const redirectTarget = useMemo(() => {
    const from = location.state as { from?: { pathname?: string } } | null;

    if (mode === 'admin') {
      return from?.from?.pathname?.startsWith('/admin') ? from.from.pathname : '/admin';
    }

    if (from?.from?.pathname && !from.from.pathname.startsWith('/admin')) {
      return from.from.pathname;
    }

    return '/dashboard';
  }, [location.state, mode]);

  const isCreatingAccount =
    mode === 'user' &&
    ((userAuthMethod === 'password' && passwordAction === 'signup') ||
      (userAuthMethod === 'passkey' && passkeyAction === 'signup'));

  const authTitle = mode === 'admin' ? 'Admin Login' : isCreatingAccount ? 'Create your account' : 'Welcome back';
  const authDescription =
    mode === 'admin'
      ? 'Use the configured administrator credentials to access the operations dashboard.'
      : isCreatingAccount
        ? 'Choose password, Google, or a passkey. Using the same email keeps every sign-in method attached to one account.'
        : 'Sign in with password, Google, or a passkey. All methods attach to the same user account when the email matches.';

  if (hasStoredSession() && storedUser) {
    return <Navigate to={isAdminUser(storedUser) ? '/admin' : '/dashboard'} replace />;
  }

  const handleAdminSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await authAPI.adminLogin(adminEmail.trim(), adminPassword);
      const result = response.data.data;
      storeSession(result.sessionToken, result.user);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, 'Admin login failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!userEmail.trim()) {
      setError('Enter your email to continue.');
      return;
    }

    if (!userPassword) {
      setError('Enter your password to continue.');
      return;
    }

    if (passwordAction === 'signup' && userPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const email = userEmail.trim().toLowerCase();
      const response =
        passwordAction === 'signup'
          ? await authAPI.register(email, userPassword)
          : await authAPI.login(email, userPassword);

      const result = response.data.data;
      storeSession(result.sessionToken, result.user);
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          passwordAction === 'signup' ? 'Account creation failed.' : 'Login failed.',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasskeyAuth = async () => {
    if (!userEmail.trim()) {
      setError('Enter your email to continue.');
      return;
    }

    const passkeyError = await canUsePasskeys();
    if (passkeyError) {
      setError(passkeyError);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const email = userEmail.trim().toLowerCase();

      if (passkeyAction === 'signup') {
        const optionsResponse = await authAPI.beginPasskeyRegistration(email);
        const { challengeId, options } = optionsResponse.data.data;
        const publicKey = processCredentialCreationOptions(options);
        const credential = await navigator.credentials.create({ publicKey });

        if (!(credential instanceof PublicKeyCredential)) {
          throw new Error('Passkey registration was cancelled before completion.');
        }

        const verifyResponse = await authAPI.completePasskeyRegistration(
          email,
          challengeId,
          serializePublicKeyCredential(credential),
        );
        const result = verifyResponse.data.data;
        storeSession(result.sessionToken, result.user);
        navigate(redirectTarget, { replace: true });
        return;
      }

      const optionsResponse = await authAPI.beginPasskeyLogin(email);
      const { challengeId, options } = optionsResponse.data.data;
      const publicKey = processCredentialRequestOptions(options);
      const credential = await navigator.credentials.get({ publicKey });

      if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('Passkey login was cancelled before completion.');
      }

      const verifyResponse = await authAPI.completePasskeyLogin(
        email,
        challengeId,
        serializePublicKeyCredential(credential),
      );
      const result = verifyResponse.data.data;
      storeSession(result.sessionToken, result.user);
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setError(getPasskeyErrorMessage(err, 'Passkey authentication failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title={authTitle}
      description={authDescription}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
          <Button
            type="button"
            variant={mode === 'user' ? 'default' : 'ghost'}
            onClick={() => {
              setMode('user');
              setError('');
            }}
          >
            User
          </Button>
          <Button
            type="button"
            variant={mode === 'admin' ? 'default' : 'ghost'}
            onClick={() => {
              setMode('admin');
              setError('');
            }}
          >
            Admin
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {mode === 'admin' ? (
          <form className="space-y-5" onSubmit={handleAdminSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Admin email</label>
              <Input
                type="email"
                autoComplete="username"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                onFocus={() => error && setError('')}
                placeholder="admin@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Password</label>
              <Input
                type="password"
                autoComplete="current-password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                onFocus={() => error && setError('')}
                placeholder="Enter your admin password"
                required
              />
            </div>

            <Button className="w-full" type="submit" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign in as admin'}
            </Button>
          </form>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
              <Button
                type="button"
                variant={userAuthMethod === 'passkey' ? 'default' : 'ghost'}
                onClick={() => {
                  setUserAuthMethod('passkey');
                  setError('');
                }}
              >
                Passkey
              </Button>
              <Button
                type="button"
                variant={userAuthMethod === 'password' ? 'default' : 'ghost'}
                onClick={() => {
                  setUserAuthMethod('password');
                  setError('');
                }}
              >
                Password
              </Button>
            </div>

            {userAuthMethod === 'password' ? (
              <form className="space-y-5" onSubmit={handlePasswordAuth}>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
                  <Button
                    type="button"
                    variant={passwordAction === 'login' ? 'default' : 'ghost'}
                    onClick={() => {
                      setPasswordAction('login');
                      setError('');
                    }}
                  >
                    Sign In
                  </Button>
                  <Button
                    type="button"
                    variant={passwordAction === 'signup' ? 'default' : 'ghost'}
                    onClick={() => {
                      setPasswordAction('signup');
                      setError('');
                    }}
                  >
                    Create Account
                  </Button>
                </div>

                <div className="rounded-2xl border border-border bg-muted/30 p-4">
                  <div className="mb-4 flex items-start gap-3">
                    <div className="rounded-xl bg-primary/10 p-2 text-primary">
                      <KeyRound size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {passwordAction === 'signup' ? 'Create a password-secured account' : 'Sign in with email and password'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Use the same email across password, Google, and passkey sign-in to keep one account.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Email</label>
                      <Input
                        type="email"
                        autoComplete="username"
                        value={userEmail}
                        onChange={(event) => setUserEmail(event.target.value)}
                        onFocus={() => error && setError('')}
                        placeholder="you@example.com"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Password</label>
                      <Input
                        type="password"
                        autoComplete={passwordAction === 'signup' ? 'new-password' : 'current-password'}
                        value={userPassword}
                        onChange={(event) => setUserPassword(event.target.value)}
                        onFocus={() => error && setError('')}
                        placeholder={passwordAction === 'signup' ? 'Create a password' : 'Enter your password'}
                        required
                      />
                    </div>

                    {passwordAction === 'signup' ? (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Confirm password</label>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          onFocus={() => error && setError('')}
                          placeholder="Repeat your password"
                          required
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <Button className="w-full" type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 animate-spin" size={16} />
                      Working...
                    </>
                  ) : passwordAction === 'signup' ? (
                    'Create account with password'
                  ) : (
                    'Continue with password'
                  )}
                </Button>
              </form>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
                  <Button
                    type="button"
                    variant={passkeyAction === 'login' ? 'default' : 'ghost'}
                    onClick={() => {
                      setPasskeyAction('login');
                      setError('');
                    }}
                  >
                    Sign In
                  </Button>
                  <Button
                    type="button"
                    variant={passkeyAction === 'signup' ? 'default' : 'ghost'}
                    onClick={() => {
                      setPasskeyAction('signup');
                      setError('');
                    }}
                  >
                    Create Account
                  </Button>
                </div>

                <div className="rounded-2xl border border-border bg-muted/30 p-4">
                  <div className="mb-4 flex items-start gap-3">
                    <div className="rounded-xl bg-primary/10 p-2 text-primary">
                      {passkeyAction === 'signup' ? <ShieldCheck size={18} /> : <Fingerprint size={18} />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {passkeyAction === 'signup' ? 'Create your passkey account' : 'Sign in with your passkey'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Your device will prompt for biometrics or screen lock verification.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Email</label>
                    <Input
                      type="email"
                      autoComplete="username webauthn"
                      value={userEmail}
                      onChange={(event) => setUserEmail(event.target.value)}
                      onFocus={() => error && setError('')}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </div>

                <Button className="w-full" type="button" disabled={submitting} onClick={() => void handlePasskeyAuth()}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 animate-spin" size={16} />
                      Working...
                    </>
                  ) : passkeyAction === 'signup' ? (
                    'Create account with passkey'
                  ) : (
                    'Continue with passkey'
                  )}
                </Button>
              </>
            )}

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <GoogleAuthButton
              disabled={submitting}
              redirectTo={redirectTarget}
              onError={(message) => setError(message)}
            />
          </div>
        )}
      </div>
    </AuthLayout>
  );
};

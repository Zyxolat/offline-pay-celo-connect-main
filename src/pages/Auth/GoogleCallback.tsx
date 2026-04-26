import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getStoredUser, hasStoredSession, storeSession, type SessionUser } from '@/lib/auth';

type GoogleCallbackResult = {
  sessionToken: string;
  user: SessionUser;
  redirectTo?: string;
};

const decodeBase64UrlJson = <T,>(value: string): T => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4 || 4)) % 4;
  const padded = normalized + '='.repeat(padding);
  return JSON.parse(atob(padded)) as T;
};

export const GoogleCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const storedUser = getStoredUser();

  useEffect(() => {
    if (hasStoredSession() && storedUser) {
      return;
    }

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const encodedResult = hashParams.get('result');
    const callbackError = hashParams.get('error');

    if (searchParams.get('code') || searchParams.get('state')) {
      setError(
        'Google is redirecting to the frontend instead of the backend callback. Set GOOGLE_CALLBACK_URL to your backend /auth/google/callback or /api/auth/google/callback URL.',
      );
      return;
    }

    if (callbackError) {
      setError(callbackError);
      return;
    }

    if (!encodedResult) {
      setError('Google sign-in did not return a session result. Please try again.');
      return;
    }

    try {
      const result = decodeBase64UrlJson<GoogleCallbackResult>(encodedResult);

      if (!result.sessionToken || !result.user) {
        throw new Error('Google sign-in result was incomplete.');
      }

      storeSession(result.sessionToken, result.user);
      window.history.replaceState({}, document.title, window.location.pathname);
      navigate(result.redirectTo?.startsWith('/') ? result.redirectTo : '/dashboard', { replace: true });
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Google sign-in could not be completed.');
    }
  }, [navigate, searchParams, storedUser]);

  if (hasStoredSession() && storedUser) {
    return <Navigate to={storedUser.isAdmin ? '/admin' : '/dashboard'} replace />;
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertDescription className="flex items-center gap-2">
            <Loader2 className="animate-spin" size={16} />
            Completing Google sign-in...
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

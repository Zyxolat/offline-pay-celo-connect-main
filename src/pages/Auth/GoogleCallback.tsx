import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getGoogleRedirectUri } from '@/config/env';
import { getStoredUser, hasStoredSession, storeSession } from '@/lib/auth';
import { authAPI } from '@/services/apiClient';

const GOOGLE_STATE_KEY = 'google_oauth_state';
const GOOGLE_REDIRECT_KEY = 'google_oauth_redirect';

const clearGoogleState = () => {
  sessionStorage.removeItem(GOOGLE_STATE_KEY);
  sessionStorage.removeItem(GOOGLE_REDIRECT_KEY);
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

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const oauthError = searchParams.get('error');
    const oauthErrorDescription = searchParams.get('error_description');
    const expectedState = sessionStorage.getItem(GOOGLE_STATE_KEY);
    const redirectTarget = sessionStorage.getItem(GOOGLE_REDIRECT_KEY) || '/dashboard';

    if (oauthError) {
      clearGoogleState();
      setError(oauthErrorDescription || 'Google sign-in was cancelled or denied.');
      return;
    }

    if (!code) {
      clearGoogleState();
      setError('Google sign-in did not return an authorization code. Please try again.');
      return;
    }

    if (!state || !expectedState || state !== expectedState) {
      clearGoogleState();
      setError('Google sign-in expired or could not be validated. Please try again.');
      return;
    }

    const exchangeCode = async () => {
      try {
        const response = await authAPI.googleLogin(code, getGoogleRedirectUri());
        const result = response.data.data;
        clearGoogleState();
        storeSession(result.sessionToken, result.user);
        navigate(redirectTarget.startsWith('/') ? redirectTarget : '/dashboard', { replace: true });
      } catch (exchangeError) {
        clearGoogleState();
        const maybeAxiosError = exchangeError as {
          response?: {
            data?: {
              error?: string;
            };
          };
          message?: string;
        };
        setError(
          maybeAxiosError.response?.data?.error ||
            maybeAxiosError.message ||
            'Google sign-in could not be completed. Please try again.',
        );
      }
    };

    void exchangeCode();
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
          <AlertDescription>Completing Google sign-in...</AlertDescription>
        </Alert>
      )}
    </div>
  );
};

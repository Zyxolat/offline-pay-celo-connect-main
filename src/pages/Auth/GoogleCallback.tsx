import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const decodeBase64UrlJson = <T,>(value: string): T => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4 || 4)) % 4;
  const padded = normalized + '='.repeat(padding);
  return JSON.parse(atob(padded)) as T;
};

export const GoogleCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const sessionToken = searchParams.get('sessionToken');
    const user = searchParams.get('user');
    const error = searchParams.get('error');
    const redirectTo = searchParams.get('redirectTo');

    if (error) {
      console.error('Google auth error:', error);
      navigate('/auth/signup?error=' + encodeURIComponent(error));
      return;
    }

    if (sessionToken) {
      localStorage.setItem('sessionToken', sessionToken);
      if (user) {
        localStorage.setItem('user', user);
      }
      navigate(redirectTo?.startsWith('/') ? redirectTo : '/dashboard');
      return;
    }

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const encodedResult = hashParams.get('result');
    const hashError = hashParams.get('error');

    if (hashError) {
      console.error('Google auth error:', hashError);
      navigate('/auth/signup?error=' + encodeURIComponent(hashError));
      return;
    }

    if (encodedResult) {
      try {
        const result = decodeBase64UrlJson<{ sessionToken: string; user: string; redirectTo?: string }>(encodedResult);

        if (!result.sessionToken || !result.user) {
          throw new Error('Google sign-in result was incomplete.');
        }

        localStorage.setItem('sessionToken', result.sessionToken);
        localStorage.setItem('user', JSON.stringify(result.user));
        window.history.replaceState({}, document.title, window.location.pathname);
        navigate(result.redirectTo?.startsWith('/') ? result.redirectTo : '/dashboard');
        return;
      } catch (parseError) {
        console.error('Google auth parse error:', parseError);
        navigate('/auth/signup?error=Google+sign-in+could+not+be+completed');
        return;
      }
    }

    navigate('/auth/signup?error=No+session+token');
  }, [navigate, searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h2>Completing login...</h2>
        <p>Please wait while we redirect you.</p>
      </div>
    </div>
  );
};

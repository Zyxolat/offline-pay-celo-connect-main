import { useEffect, useState } from 'react';
import { GOOGLE_CLIENT_ID, getGoogleRedirectUri } from '@/config/env';
import { Button } from '@/components/ui/button';

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initCodeClient: (config: {
            client_id: string;
            scope: string;
            ux_mode: 'redirect' | 'popup';
            redirect_uri?: string;
            state?: string;
            select_account?: boolean;
            error_callback?: (error: { type?: string }) => void;
          }) => {
            requestCode: () => void;
          };
        };
      };
    };
  }
}

interface GoogleAuthButtonProps {
  disabled?: boolean;
  getState: () => string;
  onError: (message: string) => void;
}

export const GoogleAuthButton = ({ disabled = false, getState, onError }: GoogleAuthButtonProps) => {
  const [scriptReady, setScriptReady] = useState(Boolean(window.google?.accounts?.oauth2));

  useEffect(() => {
    if (window.google?.accounts?.oauth2) {
      setScriptReady(true);
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-gsi="true"]');
    if (existingScript) {
      const handleLoad = () => setScriptReady(true);
      const handleError = () => setScriptReady(false);

      existingScript.addEventListener('load', handleLoad);
      existingScript.addEventListener('error', handleError);

      return () => {
        existingScript.removeEventListener('load', handleLoad);
        existingScript.removeEventListener('error', handleError);
      };
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleGsi = 'true';
    script.addEventListener('load', () => setScriptReady(true), { once: true });
    script.addEventListener('error', () => setScriptReady(false), { once: true });
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  const handleGoogleLogin = () => {
    const clientId = GOOGLE_CLIENT_ID;
    if (!clientId) {
      onError('Google sign-in is not configured for this environment.');
      return;
    }

    if (!scriptReady || !window.google?.accounts?.oauth2) {
      onError('Google sign-in is still loading. Please try again.');
      return;
    }

    const codeClient = window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: 'openid email profile',
      ux_mode: 'redirect',
      redirect_uri: getGoogleRedirectUri(),
      state: getState(),
      select_account: true,
      error_callback: (error) => {
        if (error.type === 'popup_closed') {
          onError('Google sign-in was cancelled before completion.');
          return;
        }

        onError('Google sign-in could not be started. Please try again.');
      },
    });

    codeClient.requestCode();
  };

  return (
    <Button
      className="w-full"
      type="button"
      variant="outline"
      disabled={disabled || !GOOGLE_CLIENT_ID}
      onClick={handleGoogleLogin}
    >
      Continue with Google
    </Button>
  );
};

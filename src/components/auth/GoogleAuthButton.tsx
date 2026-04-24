import { GOOGLE_CLIENT_ID, getGoogleAuthStartUrl } from '@/config/env';
import { Button } from '@/components/ui/button';

interface GoogleAuthButtonProps {
  disabled?: boolean;
  redirectTo: string;
  onError: (message: string) => void;
}

export const GoogleAuthButton = ({ disabled = false, redirectTo, onError }: GoogleAuthButtonProps) => {
  const handleGoogleLogin = () => {
    const clientId = GOOGLE_CLIENT_ID;
    if (!clientId) {
      onError('Google sign-in is not configured for this environment.');
      return;
    }

    try {
      const targetUrl = getGoogleAuthStartUrl(redirectTo);
      console.info('[auth] Starting Google OAuth redirect', {
        redirectTo,
        targetUrl,
        clientIdConfigured: Boolean(clientId),
      });
      window.location.assign(targetUrl);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Google sign-in could not be started. Please try again.');
    }
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

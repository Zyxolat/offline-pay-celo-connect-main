import { getGoogleAuthStartUrl } from '@/config/env';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface GoogleAuthButtonProps {
  disabled?: boolean;
  loading?: boolean;
  redirectTo: string;
  onStart?: () => void;
  onError: (message: string) => void;
}

export const GoogleAuthButton = ({
  disabled = false,
  loading = false,
  redirectTo,
  onStart,
  onError,
}: GoogleAuthButtonProps) => {
  const handleGoogleLogin = () => {
    try {
      onStart?.();
      const targetUrl = getGoogleAuthStartUrl(redirectTo);
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
      disabled={disabled}
      onClick={handleGoogleLogin}
    >
      {loading ? (
        <>
          <Loader2 className="mr-2 animate-spin" size={16} />
          Redirecting to Google...
        </>
      ) : (
        'Continue with Google'
      )}
    </Button>
  );
};

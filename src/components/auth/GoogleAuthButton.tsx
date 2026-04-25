import { getGoogleAuthStartUrl } from '@/config/env';
import { Button } from '@/components/ui/button';

interface GoogleAuthButtonProps {
  disabled?: boolean;
  redirectTo: string;
  onError: (message: string) => void;
}

export const GoogleAuthButton = ({ disabled = false, redirectTo, onError }: GoogleAuthButtonProps) => {
  const handleGoogleLogin = () => {
    try {
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
      Continue with Google
    </Button>
  );
};

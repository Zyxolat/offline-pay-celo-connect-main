import { FormEvent, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { hasValidStoredAdminSession, storeSession } from '@/lib/auth';
import { authAPI } from '@/services/apiClient';

export const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    console.log('[Login] mounted', { path: location.pathname });
  }, [location.pathname]);

  if (hasValidStoredAdminSession()) {
    return <Navigate to="/admin" replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await authAPI.login(email.trim(), password);
      const result = response.data.data;
      storeSession(result.sessionToken, result.user);
      navigate('/admin', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Admin Login"
      description="Only the configured administrator account can sign in."
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Admin email</label>
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onFocus={() => error && setError('')}
            placeholder="Enter your admin password"
            required
          />
        </div>

        <Button className="w-full" type="submit" disabled={submitting}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
};

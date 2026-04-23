import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getStoredToken, getStoredUser, hasValidStoredAdminSession, isAdminUser } from '@/lib/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    setIsAuthenticated(hasValidStoredAdminSession());
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin" size={40} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  const user = getStoredUser();
  if (!getStoredToken() || !isAdminUser(user)) {
    return <Navigate to="/auth/login" replace state={{ from: location }} />;
  }

  if (location.pathname !== '/admin') {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
};

import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { hasValidStoredAdminSession } from '@/lib/auth';

export const AdminRoute = ({ children }: { children: ReactNode }) => {
  const location = useLocation();

  if (!hasValidStoredAdminSession()) {
    return <Navigate to="/auth/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};

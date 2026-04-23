import { Navigate, Routes, Route } from 'react-router-dom';
import { Login } from './Login';

export const AuthPages = () => {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="signup" element={<Navigate to="/auth/login" replace />} />
      <Route path="*" element={<Login />} />
    </Routes>
  );
};

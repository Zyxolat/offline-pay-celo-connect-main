import { Navigate, Routes, Route } from 'react-router-dom';
import { GoogleCallback } from './GoogleCallback';
import { Login } from './Login';

export const AuthPages = () => {
  return (
    <Routes>
      <Route path="google/callback" element={<GoogleCallback />} />
      <Route path="google/result" element={<GoogleCallback />} />
      <Route path="login" element={<Login />} />
      <Route path="signup" element={<Login />} />
      <Route path="*" element={<Login />} />
    </Routes>
  );
};

import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://offline-pay-celo-production.up.railway.app/api';

const authAPI = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

// Google OAuth - Call backend instead of Google directly
export const googleLogin = async (redirectTo?: string) => {
  try {
    // Backend will redirect to Google OAuth
    const url = `${API_URL}/auth/google${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ''}`;
    window.location.href = url;
  } catch (error) {
    console.error('[auth] Google login error:', error);
    throw error;
  }
};

export const googleSignup = async (redirectTo?: string) => {
  // Same as login
  return googleLogin(redirectTo);
};

// Passkey Signup
export const passkeySignup = async (email: string) => {
  try {
    // Step 1: Get registration options
    const optionsResponse = await authAPI.post('/auth/webauthn/register/options', { email });
    const options = optionsResponse.data;

    // Step 2: Create credential
    const credential = await navigator.credentials.create({
      publicKey: options,
    });

    if (!credential) throw new Error('Failed to create credential');

    // Step 3: Verify with backend
    const verifyResponse = await authAPI.post('/auth/webauthn/register/verify', {
      email,
      credential: credential.toJSON(),
    });

    const { sessionToken, user } = verifyResponse.data;
    
    // Store session token
    localStorage.setItem('sessionToken', sessionToken);
    localStorage.setItem('user', JSON.stringify(user));

    return { sessionToken, user };
  } catch (error) {
    console.error('[auth] Passkey signup error:', error);
    throw error;
  }
};

// Passkey Login
export const passkeyLogin = async (email: string) => {
  try {
    // Step 1: Get login options
    const optionsResponse = await authAPI.post('/auth/webauthn/login/options', { email });
    const options = optionsResponse.data;

    // Step 2: Get credential from browser
    const credential = await navigator.credentials.get({
      publicKey: options,
    });

    if (!credential) throw new Error('Failed to get credential');

    // Step 3: Verify with backend
    const verifyResponse = await authAPI.post('/auth/webauthn/login/verify', {
      email,
      credential: credential.toJSON(),
    });

    const { sessionToken, user } = verifyResponse.data;
    
    // Store session token
    localStorage.setItem('sessionToken', sessionToken);
    localStorage.setItem('user', JSON.stringify(user));

    return { sessionToken, user };
  } catch (error) {
    console.error('[auth] Passkey login error:', error);
    throw error;
  }
};

// Add session token to all requests
authAPI.interceptors.request.use((config) => {
  const token = localStorage.getItem('sessionToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default authAPI;

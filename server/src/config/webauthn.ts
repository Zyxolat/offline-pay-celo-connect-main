import type { AuthenticatorTransport } from '@simplewebauthn/types';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { config } from './index.js';

export const webauthnConfig = {
  generateRegistrationOptions: async (
    userID: string,
    userName: string,
    excludeCredentials: Array<{ id: Buffer; type: 'public-key'; transports?: AuthenticatorTransport[] }> = [],
  ) => {
    return generateRegistrationOptions({
      rpName: config.webauthn.rpName,
      rpID: config.webauthn.rpID,
      userID,
      userName,
      userDisplayName: userName,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      excludeCredentials,
      supportedAlgorithmIDs: [-7, -257],
    });
  },

  generateAuthenticationOptions: async (
    allowCredentials: Array<{ id: Buffer; type: 'public-key'; transports?: AuthenticatorTransport[] }> = [],
  ) => {
    return generateAuthenticationOptions({
      rpID: config.webauthn.rpID,
      allowCredentials,
      userVerification: 'required',
    });
  },

  verifyRegistrationResponse,
  verifyAuthenticationResponse,
};

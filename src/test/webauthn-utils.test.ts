import { describe, expect, it } from 'vitest';
import {
  base64UrlToUint8Array,
  processCredentialCreationOptions,
  processCredentialRequestOptions,
} from '@/utils/webauthn';

describe('webauthn utils', () => {
  it('converts base64url strings to Uint8Array', () => {
    expect(Array.from(base64UrlToUint8Array('AQIDBA'))).toEqual([1, 2, 3, 4]);
  });

  it('normalizes registration options for navigator.credentials.create', () => {
    const publicKey = processCredentialCreationOptions({
      challenge: 'AQIDBA',
      user: {
        id: 'BQYHCA',
        name: 'user@example.com',
        displayName: 'user@example.com',
      },
      excludeCredentials: [{ id: 'CQoLDA', type: 'public-key' }],
    });

    expect(publicKey.challenge).toBeInstanceOf(Uint8Array);
    expect(publicKey.user.id).toBeInstanceOf(Uint8Array);
    expect(publicKey.excludeCredentials[0].id).toBeInstanceOf(Uint8Array);
  });

  it('rejects malformed login options before navigator.credentials.get', () => {
    expect(() => processCredentialRequestOptions({ challenge: null })).toThrow(
      'Login challenge is missing or invalid.',
    );
    expect(() =>
      processCredentialRequestOptions({
        challenge: 'AQIDBA',
        allowCredentials: 'not-an-array',
      }),
    ).toThrow('Login allowCredentials is invalid.');
  });
});

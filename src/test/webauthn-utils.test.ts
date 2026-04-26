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

    expect(publicKey.challenge).toBeInstanceOf(ArrayBuffer);
    expect(publicKey.user.id).toBeInstanceOf(ArrayBuffer);
    expect(publicKey.excludeCredentials[0].id).toBeInstanceOf(ArrayBuffer);
  });

  it('normalizes login options for navigator.credentials.get', () => {
    const publicKey = processCredentialRequestOptions({
      challenge: 'AQIDBA',
      allowCredentials: [{ id: 'CQoLDA', type: 'public-key' }],
      rpId: 'localhost',
      timeout: 60000,
      userVerification: 'required',
    });

    expect(publicKey.challenge).toBeInstanceOf(ArrayBuffer);
    expect(publicKey.allowCredentials?.[0].id).toBeInstanceOf(ArrayBuffer);
    expect(publicKey.rpId).toBe('localhost');
  });

  it('accepts nested publicKey-style login payloads and buffer-like ids', () => {
    const publicKey = processCredentialRequestOptions({
      publicKey: {
        challenge: { type: 'Buffer', data: [1, 2, 3, 4] },
        allowCredentials: [{ id: [5, 6, 7, 8], type: 'public-key' }],
      },
    });

    expect(publicKey.challenge).toBeInstanceOf(ArrayBuffer);
    expect(publicKey.allowCredentials?.[0].id).toBeInstanceOf(ArrayBuffer);
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

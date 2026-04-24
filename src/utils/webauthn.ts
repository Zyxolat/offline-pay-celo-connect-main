function padBase64(base64: string): string {
  const remainder = base64.length % 4;
  if (remainder === 0) {
    return base64;
  }

  return `${base64}${'='.repeat(4 - remainder)}`;
}

export function base64UrlToUint8Array(base64Url: string): Uint8Array {
  if (!base64Url || typeof base64Url !== 'string') {
    throw new Error('Expected a base64url string.');
  }

  const normalized = padBase64(base64Url.replace(/-/g, '+').replace(/_/g, '/'));
  const binaryString = atob(normalized);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}

/**
 * Convert ArrayBuffer to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  return arrayBufferToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Process WebAuthn credential creation options
 */
export function processCredentialCreationOptions(options: any) {
  if (!options) {
    throw new Error('Missing passkey registration options.');
  }

  if (typeof options.challenge !== 'string') {
    throw new Error('Registration challenge is missing or invalid.');
  }

  if (!options.user || typeof options.user.id !== 'string') {
    throw new Error('Registration user identifier is missing or invalid.');
  }

  if (options.excludeCredentials && !Array.isArray(options.excludeCredentials)) {
    throw new Error('Registration excludeCredentials is invalid.');
  }

  return {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToUint8Array(options.user.id),
    },
    excludeCredentials: Array.isArray(options.excludeCredentials)
      ? options.excludeCredentials.map((credential: any) => ({
          ...credential,
          id: typeof credential.id === 'string' ? base64UrlToUint8Array(credential.id) : credential.id,
        }))
      : options.excludeCredentials,
  };
}

/**
 * Process WebAuthn credential request options
 */
export function processCredentialRequestOptions(options: any) {
  if (!options) {
    throw new Error('Missing passkey login options.');
  }

  if (typeof options.challenge !== 'string') {
    throw new Error('Login challenge is missing or invalid.');
  }

  if (options.allowCredentials && !Array.isArray(options.allowCredentials)) {
    throw new Error('Login allowCredentials is invalid.');
  }

  return {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    allowCredentials: Array.isArray(options.allowCredentials)
      ? options.allowCredentials.map((credential: any) => ({
          ...credential,
          id: typeof credential.id === 'string' ? base64UrlToUint8Array(credential.id) : credential.id,
        }))
      : options.allowCredentials,
  };
}

const serializeTransports = (response: AuthenticatorResponse) => {
  if ('getTransports' in response && typeof response.getTransports === 'function') {
    return response.getTransports();
  }
  return undefined;
};

export function serializePublicKeyCredential(credential: PublicKeyCredential) {
  const response = credential.response;

  if (response instanceof AuthenticatorAttestationResponse) {
    return {
      id: credential.id,
      rawId: arrayBufferToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
        attestationObject: arrayBufferToBase64Url(response.attestationObject),
        transports: serializeTransports(response),
      },
    };
  }

  if (response instanceof AuthenticatorAssertionResponse) {
    return {
      id: credential.id,
      rawId: arrayBufferToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
        authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
        signature: arrayBufferToBase64Url(response.signature),
        userHandle: response.userHandle ? arrayBufferToBase64Url(response.userHandle) : null,
      },
    };
  }

  throw new Error('Unsupported credential response type');
}

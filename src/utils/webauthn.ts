function padBase64(base64: string): string {
  const remainder = base64.length % 4;
  if (remainder === 0) {
    return base64;
  }

  return `${base64}${'='.repeat(4 - remainder)}`;
}

type BufferLikeJson = {
  type: 'Buffer';
  data: number[];
};

function isBufferLikeJson(value: unknown): value is BufferLikeJson {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'type' in value &&
      'data' in value &&
      (value as { type?: unknown }).type === 'Buffer' &&
      Array.isArray((value as { data?: unknown }).data),
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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

function normalizeBinaryValue(value: unknown, label: string): ArrayBuffer {
  if (typeof value === 'string') {
    return toArrayBuffer(base64UrlToUint8Array(value));
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  if (ArrayBuffer.isView(value)) {
    return toArrayBuffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }

  if (Array.isArray(value)) {
    return toArrayBuffer(Uint8Array.from(value));
  }

  if (isBufferLikeJson(value)) {
    return toArrayBuffer(Uint8Array.from(value.data));
  }

  throw new Error(`${label} is missing or invalid.`);
}

function getPublicKeyOptionsSource<T>(options: T): T {
  if (
    options &&
    typeof options === 'object' &&
    'publicKey' in (options as Record<string, unknown>) &&
    (options as Record<string, unknown>).publicKey &&
    typeof (options as Record<string, unknown>).publicKey === 'object'
  ) {
    return (options as { publicKey: T }).publicKey;
  }

  return options;
}

type PublicKeyCredentialJsonParsers = typeof PublicKeyCredential & {
  parseCreationOptionsFromJSON?: (options: unknown) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (options: unknown) => PublicKeyCredentialRequestOptions;
};

function getPublicKeyCredentialParsers() {
  if (typeof PublicKeyCredential === 'undefined') {
    return null;
  }

  return PublicKeyCredential as PublicKeyCredentialJsonParsers;
}

function isStringBackedCredentialDescriptorList(value: unknown): boolean {
  return !Array.isArray(value) || value.every((credential) => typeof credential?.id === 'string');
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
  const source = getPublicKeyOptionsSource(options);

  if (!source) {
    throw new Error('Missing passkey registration options.');
  }

  if (!source.user || source.user.id == null) {
    throw new Error('Registration user identifier is missing or invalid.');
  }

  if (source.excludeCredentials && !Array.isArray(source.excludeCredentials)) {
    throw new Error('Registration excludeCredentials is invalid.');
  }

  const parsers = getPublicKeyCredentialParsers();
  if (
    parsers?.parseCreationOptionsFromJSON &&
    typeof source.challenge === 'string' &&
    typeof source.user?.id === 'string' &&
    isStringBackedCredentialDescriptorList(source.excludeCredentials)
  ) {
    try {
      return parsers.parseCreationOptionsFromJSON(source);
    } catch {
      // Fall back to manual normalization for older payload variants.
    }
  }

  return {
    ...source,
    challenge: normalizeBinaryValue(source.challenge, 'Registration challenge'),
    user: {
      ...source.user,
      id: normalizeBinaryValue(source.user.id, 'Registration user identifier'),
    },
    excludeCredentials: Array.isArray(source.excludeCredentials)
      ? source.excludeCredentials.map((credential: any) => ({
          ...credential,
          id: normalizeBinaryValue(credential.id, 'Registration exclude credential identifier'),
        }))
      : source.excludeCredentials,
  };
}

/**
 * Process WebAuthn credential request options
 */
export function processCredentialRequestOptions(options: any) {
  const source = getPublicKeyOptionsSource(options);

  if (!source) {
    throw new Error('Missing passkey login options.');
  }

  if (source.allowCredentials && !Array.isArray(source.allowCredentials)) {
    throw new Error('Login allowCredentials is invalid.');
  }

  const parsers = getPublicKeyCredentialParsers();
  if (
    parsers?.parseRequestOptionsFromJSON &&
    typeof source.challenge === 'string' &&
    isStringBackedCredentialDescriptorList(source.allowCredentials)
  ) {
    try {
      return parsers.parseRequestOptionsFromJSON(source);
    } catch {
      // Fall back to manual normalization for older payload variants.
    }
  }

  return {
    challenge: normalizeBinaryValue(source.challenge, 'Login challenge'),
    allowCredentials: Array.isArray(source.allowCredentials)
      ? source.allowCredentials.map((credential: any) => ({
          ...credential,
          id: normalizeBinaryValue(credential.id, 'Login credential identifier'),
        }))
      : source.allowCredentials,
    rpId: source.rpId,
    timeout: source.timeout,
    userVerification: source.userVerification,
    extensions: source.extensions,
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

/**
 * HMAC-SHA256 matching Mushaffar Dart implementation.
 * Uses Web Crypto API for secure, constant-time operations.
 */

export async function generateHMAC(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return new Uint8Array(signature);
}

/**
 * Constant-time comparison to prevent timing attacks.
 * Matches Dart _constantTimeEquals exactly.
 */
export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export async function verifyHMAC(
  key: Uint8Array,
  encryptedBytes: Uint8Array,
  expectedHmac: Uint8Array
): Promise<boolean> {
  const computed = await generateHMAC(key, encryptedBytes);
  return constantTimeEquals(computed, expectedHmac);
}

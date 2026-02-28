/**
 * Key derivation matching Mushaffar app exactly.
 *
 * V1: SHA-256 with 100,000 iterations (legacy)
 * V2: Argon2id (iterations=2, memory=32MB, lanes=2)
 * V3: Argon2id (iterations=3, memory=64MB, lanes=4)
 */

import { argon2id } from 'hash-wasm';

export async function deriveKeyV1(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // Initial hash: SHA256(password + salt)
  const combined = new Uint8Array([...passwordBytes, ...salt]);
  let hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  let hash = new Uint8Array(hashBuffer);

  // 100,000 iterations of SHA256
  for (let i = 0; i < 100000; i++) {
    hashBuffer = await crypto.subtle.digest('SHA-256', hash);
    hash = new Uint8Array(hashBuffer);
  }

  return hash;
}

export async function deriveKeyV2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password);
  const hashHex = await argon2id({
    password: passwordBytes,
    salt,
    iterations: 2,
    memorySize: 32768,   // 2^15 = 32MB (in KB)
    parallelism: 2,
    hashLength: 32,
    outputType: 'hex',
  });
  return hexToBytes(hashHex);
}

export async function deriveKeyV3(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password);
  const hashHex = await argon2id({
    password: passwordBytes,
    salt,
    iterations: 3,
    memorySize: 65536,    // 2^16 = 64MB (in KB)
    parallelism: 4,
    hashLength: 32,
    outputType: 'hex',
  });
  return hexToBytes(hashHex);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

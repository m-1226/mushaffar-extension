import argon2 from 'argon2-browser';

/**
 * Key derivation matching Mushaffar app exactly.
 *
 * V1: SHA-256 with 100,000 iterations (legacy)
 * V2: Argon2id (iterations=2, memory=32MB, lanes=2)
 * V3: Argon2id (iterations=3, memory=64MB, lanes=4)
 */

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
  const result = await argon2.hash({
    pass: password,
    salt: salt,
    type: argon2.ArgonType.Argon2id,
    time: 2,        // iterations
    mem: 32768,      // 2^15 = 32MB
    parallelism: 2,  // lanes
    hashLen: 32,
  });
  return result.hash;
}

export async function deriveKeyV3(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const result = await argon2.hash({
    pass: password,
    salt: salt,
    type: argon2.ArgonType.Argon2id,
    time: 3,         // iterations
    mem: 65536,       // 2^16 = 64MB
    parallelism: 4,   // lanes
    hashLen: 32,
  });
  return result.hash;
}

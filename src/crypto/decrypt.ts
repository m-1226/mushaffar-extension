/**
 * Decryption pipeline matching Mushaffar Dart BackupService exactly.
 *
 * Backup format:
 *   v1: salt(32) + IV(16) + encrypted_data (no HMAC)
 *   v2: "v2" + salt(32) + IV(16) + encrypted_data + HMAC(32)
 *   v3: "v3" + salt(32) + IV(16) + encrypted_data + HMAC(32)
 *
 * All base64 encoded.
 */

import { deriveKeyV1, deriveKeyV2, deriveKeyV3 } from './argon2';
import { verifyHMAC, generateHMAC } from './hmac';
import type { VaultData } from '../models/vault';

/** Safe base64 encoding that doesn't overflow the call stack for large arrays. */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function detectVersion(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    const prefix = String.fromCharCode(bytes[0], bytes[1]);
    if (prefix === 'v2') return 'v2';
    if (prefix === 'v3') return 'v3';
  }
  return 'v1';
}

function isHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str.substring(0, Math.min(100, str.length)));
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function aesDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<string> {
  // Web Crypto uses AES-CBC
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key.buffer as ArrayBuffer,
    { name: 'AES-CBC' },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    data.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(decrypted);
}

async function aesEncrypt(key: Uint8Array, iv: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key.buffer as ArrayBuffer,
    { name: 'AES-CBC' },
    false,
    ['encrypt']
  );

  const encoded = new TextEncoder().encode(data);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    encoded
  );

  return new Uint8Array(encrypted);
}

/**
 * Decrypt a Mushaffar backup file.
 * Input: base64-encoded (or hex-encoded) backup string.
 * Output: parsed VaultData.
 */
export async function decryptBackup(encryptedBackup: string, password: string): Promise<VaultData> {
  // Detect format (hex or base64)
  let combinedBytes: Uint8Array;
  if (isHex(encryptedBackup)) {
    combinedBytes = hexToBytes(encryptedBackup);
  } else {
    const binary = atob(encryptedBackup);
    combinedBytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  }

  const version = detectVersion(combinedBytes);
  let decrypted: string;

  if (version === 'v2' || version === 'v3') {
    const offset = 2; // skip "v2" or "v3" prefix
    const salt = combinedBytes.slice(offset, offset + 32);
    const iv = combinedBytes.slice(offset + 32, offset + 48);
    const hmacBytes = combinedBytes.slice(combinedBytes.length - 32);
    const encryptedBytes = combinedBytes.slice(offset + 48, combinedBytes.length - 32);

    // Derive key with correct version
    const keyBytes = version === 'v3'
      ? await deriveKeyV3(password, salt)
      : await deriveKeyV2(password, salt);

    // Verify HMAC before decrypting
    const hmacValid = await verifyHMAC(keyBytes, encryptedBytes, hmacBytes);
    if (!hmacValid) {
      throw new Error('Wrong password or corrupted file');
    }

    decrypted = await aesDecrypt(keyBytes, iv, encryptedBytes);
  } else {
    // v1: no version prefix, no HMAC
    const salt = combinedBytes.slice(0, 32);
    const iv = combinedBytes.slice(32, 48);
    const encryptedBytes = combinedBytes.slice(48);

    const keyBytes = await deriveKeyV1(password, salt);
    decrypted = await aesDecrypt(keyBytes, iv, encryptedBytes);
  }

  // Handle hex-encoded decrypted data (legacy format)
  if (isHex(decrypted)) {
    const hexBytes = hexToBytes(decrypted);
    decrypted = new TextDecoder().decode(hexBytes);
  }

  const parsed = JSON.parse(decrypted);

  // v1 format: just an array of passwords
  if (Array.isArray(parsed)) {
    return {
      passwords: parsed,
      folders: [],
      cards: [],
      authenticators: [],
    };
  }

  // v2/v3 format: full vault object
  return {
    passwords: parsed.passwords || [],
    folders: parsed.folders || [],
    cards: parsed.cards || [],
    authenticators: parsed.authenticators || [],
  };
}

/**
 * Encrypt vault data into Mushaffar backup format (v3).
 * Output: base64-encoded string.
 */
export async function encryptBackup(vault: VaultData, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const keyBytes = await deriveKeyV3(password, salt);
  return encryptWithKey(vault, keyBytes, salt);
}

/**
 * Encrypt vault using a pre-derived key (skips Argon2 — fast for local saves).
 * Returns base64-encoded v3 format string.
 */
export async function encryptWithKey(vault: VaultData, key: Uint8Array, salt: Uint8Array): Promise<string> {
  const jsonString = JSON.stringify({
    passwords: vault.passwords,
    authenticators: vault.authenticators,
    cards: vault.cards,
    folders: vault.folders,
  });

  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encryptedBytes = await aesEncrypt(key, iv, jsonString);
  const hmac = await generateHMAC(key, encryptedBytes);

  const versionBytes = new TextEncoder().encode('v3');
  const totalLen = versionBytes.length + salt.length + iv.length + encryptedBytes.length + hmac.length;
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  combined.set(versionBytes, offset); offset += versionBytes.length;
  combined.set(salt, offset); offset += salt.length;
  combined.set(iv, offset); offset += iv.length;
  combined.set(encryptedBytes, offset); offset += encryptedBytes.length;
  combined.set(hmac, offset);

  return uint8ToBase64(combined);
}

/**
 * Decrypt a v3 blob using a pre-derived key (skips Argon2).
 */
export async function decryptWithKey(encryptedBlob: string, key: Uint8Array): Promise<VaultData> {
  const binary = atob(encryptedBlob);
  const combinedBytes = Uint8Array.from(binary, c => c.charCodeAt(0));

  const offset = 2; // skip "v3" prefix
  const iv = combinedBytes.slice(offset + 32, offset + 48);
  const hmacBytes = combinedBytes.slice(combinedBytes.length - 32);
  const encryptedBytes = combinedBytes.slice(offset + 48, combinedBytes.length - 32);

  const hmacValid = await verifyHMAC(key, encryptedBytes, hmacBytes);
  if (!hmacValid) {
    throw new Error('Wrong password or corrupted file');
  }

  const decrypted = await aesDecrypt(key, iv, encryptedBytes);
  const parsed = JSON.parse(decrypted);

  return {
    passwords: parsed.passwords || [],
    folders: parsed.folders || [],
    cards: parsed.cards || [],
    authenticators: parsed.authenticators || [],
  };
}

/**
 * Decrypt a backup and also return the derived key + salt for caching.
 * Used on unlock so subsequent saves can skip Argon2.
 */
export async function decryptBackupWithKeyReturn(
  encryptedBackup: string,
  password: string
): Promise<{ vault: VaultData; key: Uint8Array; salt: Uint8Array }> {
  let combinedBytes: Uint8Array;
  if (isHex(encryptedBackup)) {
    combinedBytes = hexToBytes(encryptedBackup);
  } else {
    const binary = atob(encryptedBackup);
    combinedBytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  }

  const version = detectVersion(combinedBytes);

  if (version === 'v2' || version === 'v3') {
    const offset = 2;
    const salt = combinedBytes.slice(offset, offset + 32);
    const iv = combinedBytes.slice(offset + 32, offset + 48);
    const hmacBytes = combinedBytes.slice(combinedBytes.length - 32);
    const encryptedBytes = combinedBytes.slice(offset + 48, combinedBytes.length - 32);

    const keyBytes = version === 'v3'
      ? await deriveKeyV3(password, salt)
      : await deriveKeyV2(password, salt);

    const hmacValid = await verifyHMAC(keyBytes, encryptedBytes, hmacBytes);
    if (!hmacValid) {
      throw new Error('Wrong password or corrupted file');
    }

    let decrypted = await aesDecrypt(keyBytes, iv, encryptedBytes);
    if (isHex(decrypted)) {
      decrypted = new TextDecoder().decode(hexToBytes(decrypted));
    }

    const parsed = JSON.parse(decrypted);
    const vault: VaultData = {
      passwords: parsed.passwords || [],
      folders: parsed.folders || [],
      cards: parsed.cards || [],
      authenticators: parsed.authenticators || [],
    };

    return { vault, key: keyBytes, salt };
  }

  // v1 — derive key and return it
  const salt = combinedBytes.slice(0, 32);
  const iv = combinedBytes.slice(32, 48);
  const encryptedBytes = combinedBytes.slice(48);
  const keyBytes = await deriveKeyV1(password, salt);

  let decrypted = await aesDecrypt(keyBytes, iv, encryptedBytes);
  if (isHex(decrypted)) {
    decrypted = new TextDecoder().decode(hexToBytes(decrypted));
  }

  const parsed = JSON.parse(decrypted);
  const vault: VaultData = Array.isArray(parsed)
    ? { passwords: parsed, folders: [], cards: [], authenticators: [] }
    : { passwords: parsed.passwords || [], folders: parsed.folders || [], cards: parsed.cards || [], authenticators: parsed.authenticators || [] };

  return { vault, key: keyBytes, salt };
}

/**
 * Local encrypted vault storage using chrome.storage.local.
 * Data is encrypted with the user's master password using AES-256-CBC + Argon2id v3.
 */

import { encryptWithKey, decryptBackupWithKeyReturn } from '../crypto/decrypt';
import { deriveKeyV3 } from '../crypto/argon2';
import type { VaultData } from '../models/vault';

const VAULT_BLOB_KEY = 'vault_blob';
const VAULT_SETUP_KEY = 'vault_setup';
const LAST_SYNC_KEY = 'last_sync_timestamp';

/** Check if the vault has been set up (master password established). */
export async function isVaultSetUp(): Promise<boolean> {
  const result = await chrome.storage.local.get(VAULT_SETUP_KEY);
  return result[VAULT_SETUP_KEY] === true;
}

/**
 * Create a new vault with a master password.
 * Used for first-time setup (empty vault or with imported data).
 */
export async function createVault(
  masterPassword: string,
  initialData?: VaultData
): Promise<{ key: Uint8Array; salt: Uint8Array }> {
  const vault: VaultData = initialData ?? {
    passwords: [],
    folders: [],
    cards: [],
    authenticators: [],
  };

  const salt = crypto.getRandomValues(new Uint8Array(32));
  const key = await deriveKeyV3(masterPassword, salt);
  const blob = await encryptWithKey(vault, key, salt);

  await chrome.storage.local.set({
    [VAULT_BLOB_KEY]: blob,
    [VAULT_SETUP_KEY]: true,
  });

  return { key, salt };
}

/**
 * Decrypt the local vault with the master password.
 * Returns vault data + cached key/salt for fast subsequent saves.
 */
export async function unlockVault(
  masterPassword: string
): Promise<{ vault: VaultData; key: Uint8Array; salt: Uint8Array }> {
  const result = await chrome.storage.local.get(VAULT_BLOB_KEY);
  const blob = result[VAULT_BLOB_KEY];

  if (!blob) {
    throw new Error('No vault found. Please set up the extension first.');
  }

  return decryptBackupWithKeyReturn(blob as string, masterPassword);
}

/**
 * Re-encrypt and persist the vault using a cached key (skips Argon2).
 * Called after every vault mutation for instant saves.
 */
export async function saveVault(
  vault: VaultData,
  key: Uint8Array,
  salt: Uint8Array
): Promise<void> {
  const blob = await encryptWithKey(vault, key, salt);
  await chrome.storage.local.set({ [VAULT_BLOB_KEY]: blob });
}

/** Clear vault and all stored data. */
export async function clearVault(): Promise<void> {
  await chrome.storage.local.remove([VAULT_BLOB_KEY, VAULT_SETUP_KEY, LAST_SYNC_KEY]);
}

/** Get the last Drive sync timestamp. */
export async function getLastSyncTimestamp(): Promise<Date | null> {
  const result = await chrome.storage.local.get(LAST_SYNC_KEY);
  return result[LAST_SYNC_KEY] ? new Date(result[LAST_SYNC_KEY] as string) : null;
}

/** Set the last Drive sync timestamp. */
export async function setLastSyncTimestamp(date: Date): Promise<void> {
  await chrome.storage.local.set({ [LAST_SYNC_KEY]: date.toISOString() });
}

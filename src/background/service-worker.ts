/**
 * Background service worker — vault management, auto-lock, message routing.
 */

import { decryptBackup, encryptBackup } from '../crypto/decrypt';
import { downloadBackup, uploadBackup, getUserEmail, signOut } from './google-drive';
import type { VaultData } from '../models/vault';
import type { PasswordModel } from '../models/password';
import { matchesDomain } from '../models/password';

const AUTO_LOCK_MINUTES = 5;
const ALARM_NAME = 'mushaffar-auto-lock';

// In-memory vault (cleared on lock or browser close)
let vault: VaultData | null = null;
let masterPassword: string | null = null;
let userEmail: string | null = null;

// --- Message handling ---

export type MessageType =
  | { type: 'unlock'; password: string }
  | { type: 'lock' }
  | { type: 'getState' }
  | { type: 'sync' }
  | { type: 'getMatches'; url: string }
  | { type: 'getAllPasswords' }
  | { type: 'getAllCards' }
  | { type: 'getAllAuthenticators' }
  | { type: 'getAllFolders' }
  | { type: 'savePassword'; password: PasswordModel }
  | { type: 'uploadVault' }
  | { type: 'generatePassword'; length: number; uppercase: boolean; lowercase: boolean; numbers: boolean; symbols: boolean }
  | { type: 'signOut' }
  | { type: 'resetAutoLock' };

chrome.runtime.onMessage.addListener((message: MessageType, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // async response
});

async function handleMessage(msg: MessageType): Promise<unknown> {
  switch (msg.type) {
    case 'unlock':
      return await handleUnlock(msg.password);

    case 'lock':
      lock();
      return { success: true };

    case 'getState':
      return {
        isUnlocked: vault !== null,
        passwordCount: vault?.passwords.length ?? 0,
        cardCount: vault?.cards.length ?? 0,
        authenticatorCount: vault?.authenticators.length ?? 0,
        folderCount: vault?.folders.length ?? 0,
        userEmail,
      };

    case 'sync':
      return await handleSync();

    case 'getMatches':
      return getMatchingCredentials(msg.url);

    case 'getAllPasswords':
      return vault?.passwords ?? [];

    case 'getAllCards':
      return vault?.cards ?? [];

    case 'getAllAuthenticators':
      return vault?.authenticators ?? [];

    case 'getAllFolders':
      return vault?.folders ?? [];

    case 'savePassword':
      return savePassword(msg.password);

    case 'uploadVault':
      return await handleUpload();

    case 'generatePassword':
      return generatePassword(msg.length, msg.uppercase, msg.lowercase, msg.numbers, msg.symbols);

    case 'signOut':
      await signOut();
      lock();
      return { success: true };

    case 'resetAutoLock':
      resetAutoLockTimer();
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// --- Unlock & Sync ---

async function handleUnlock(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const backup = await downloadBackup();
    if (!backup) {
      return { success: false, error: 'No backup found on Google Drive. Make sure you have synced from the app first.' };
    }

    vault = await decryptBackup(backup, password);
    masterPassword = password;
    userEmail = await getUserEmail();

    // Update badge with password count
    updateBadge();
    resetAutoLockTimer();

    return { success: true };
  } catch (err) {
    vault = null;
    masterPassword = null;
    return { success: false, error: (err as Error).message };
  }
}

async function handleSync(): Promise<{ success: boolean; error?: string }> {
  if (!masterPassword) {
    return { success: false, error: 'Vault is locked' };
  }

  try {
    const backup = await downloadBackup();
    if (!backup) {
      return { success: false, error: 'No backup found' };
    }

    vault = await decryptBackup(backup, masterPassword);
    updateBadge();
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function handleUpload(): Promise<{ success: boolean; error?: string }> {
  if (!vault || !masterPassword) {
    return { success: false, error: 'Vault is locked' };
  }

  try {
    const encrypted = await encryptBackup(vault, masterPassword);
    await uploadBackup(encrypted);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// --- Credential matching ---

function getMatchingCredentials(url: string): PasswordModel[] {
  if (!vault) return [];
  return vault.passwords.filter(p => matchesDomain(p.websiteUrl, url));
}

// --- Save new password ---

function savePassword(password: PasswordModel): { success: boolean } {
  if (!vault) return { success: false };
  // Check for duplicate by URL + email
  const exists = vault.passwords.some(
    p => p.websiteUrl === password.websiteUrl && p.email === password.email
  );
  if (!exists) {
    vault.passwords.push(password);
  } else {
    // Update existing
    const idx = vault.passwords.findIndex(
      p => p.websiteUrl === password.websiteUrl && p.email === password.email
    );
    if (idx >= 0) vault.passwords[idx] = password;
  }
  return { success: true };
}

// --- Password generator (matches Dart exactly) ---

function generatePassword(
  length: number,
  uppercase: boolean,
  lowercase: boolean,
  numbers: boolean,
  symbols: boolean
): string {
  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const NUMS = '0123456789';
  const SYMS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  let chars = '';
  if (uppercase) chars += UPPER;
  if (lowercase) chars += LOWER;
  if (numbers) chars += NUMS;
  if (symbols) chars += SYMS;

  if (!chars) return '';

  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, v => chars[v % chars.length]).join('');
}

// --- Lock & auto-lock ---

function lock(): void {
  vault = null;
  masterPassword = null;
  chrome.action.setBadgeText({ text: '' });
}

function resetAutoLockTimer(): void {
  chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: AUTO_LOCK_MINUTES });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    lock();
  }
});

// --- Badge ---

function updateBadge(): void {
  if (!vault) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const count = vault.passwords.length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#4895EF' });
}

// Update badge per tab based on matching credentials
chrome.tabs.onActivated?.addListener(async (activeInfo) => {
  if (!vault) return;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      const matches = getMatchingCredentials(tab.url);
      chrome.action.setBadgeText({
        text: matches.length > 0 ? String(matches.length) : '',
        tabId: activeInfo.tabId,
      });
    }
  } catch { /* ignore */ }
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (!vault || !changeInfo.url) return;
  const matches = getMatchingCredentials(changeInfo.url);
  chrome.action.setBadgeText({
    text: matches.length > 0 ? String(matches.length) : '',
    tabId,
  });
});

/**
 * Background service worker — local-first vault management with premium Drive sync.
 */

import { decryptBackup, encryptBackup } from '../crypto/decrypt';
import { isVaultSetUp, createVault, unlockVault, saveVault, getLastSyncTimestamp, setLastSyncTimestamp } from '../storage/vault-storage';
import { downloadBackup, uploadBackup, getUserEmail, signOut } from './google-drive';
import { checkPremiumStatus } from '../services/license-service';
import { mergeVaults } from '../services/conflict-resolver';
import type { VaultData } from '../models/vault';
import type { PasswordModel } from '../models/password';
import { matchesDomain } from '../models/password';

const AUTO_LOCK_MINUTES = 5;
const ALARM_NAME = 'mushaffar-auto-lock';
const PREMIUM_CACHE_MS = 5 * 60 * 1000;

// In-memory state (cleared on lock or service worker restart)
let vault: VaultData | null = null;
let cachedKey: Uint8Array | null = null;
let cachedSalt: Uint8Array | null = null;
let userEmail: string | null = null;
let isPremium = false;
let premiumCheckedAt = 0;

// --- Message handling ---

export type MessageType =
  | { type: 'getSetupState' }
  | { type: 'setup'; masterPassword: string }
  | { type: 'importBackup'; backupData: string; backupPassword: string; masterPassword: string }
  | { type: 'unlock'; password: string }
  | { type: 'lock' }
  | { type: 'getState' }
  | { type: 'getMatches'; url: string }
  | { type: 'getAllPasswords' }
  | { type: 'getAllCards' }
  | { type: 'getAllAuthenticators' }
  | { type: 'getAllFolders' }
  | { type: 'savePassword'; password: PasswordModel }
  | { type: 'deletePassword'; id: string }
  | { type: 'deleteCard'; id: string }
  | { type: 'deleteAuthenticator'; id: string }
  | { type: 'generatePassword'; length: number; uppercase: boolean; lowercase: boolean; numbers: boolean; symbols: boolean }
  | { type: 'syncFromDrive'; backupPassword: string }
  | { type: 'syncToDrive'; backupPassword: string }
  | { type: 'checkPremium' }
  | { type: 'connectGoogle' }
  | { type: 'signOut' }
  | { type: 'resetAutoLock' };

chrome.runtime.onMessage.addListener((message: MessageType, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(msg: MessageType): Promise<unknown> {
  switch (msg.type) {
    case 'getSetupState': {
      const isSetUp = await isVaultSetUp();
      return { isSetUp, isUnlocked: vault !== null };
    }

    case 'setup':
      return await handleSetup(msg.masterPassword);

    case 'importBackup':
      return await handleImportBackup(msg.backupData, msg.backupPassword, msg.masterPassword);

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
        isPremium,
      };

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
      return await handleSavePassword(msg.password);

    case 'deletePassword':
      return await handleDeleteItem('passwords', msg.id);

    case 'deleteCard':
      return await handleDeleteItem('cards', msg.id);

    case 'deleteAuthenticator':
      return await handleDeleteItem('authenticators', msg.id);

    case 'generatePassword':
      return generatePassword(msg.length, msg.uppercase, msg.lowercase, msg.numbers, msg.symbols);

    case 'syncFromDrive':
      return await handleSyncFromDrive(msg.backupPassword);

    case 'syncToDrive':
      return await handleSyncToDrive(msg.backupPassword);

    case 'checkPremium':
      return await handleCheckPremium();

    case 'connectGoogle':
      return await handleConnectGoogle();

    case 'signOut':
      await signOut();
      isPremium = false;
      premiumCheckedAt = 0;
      userEmail = null;
      return { success: true };

    case 'resetAutoLock':
      resetAutoLockTimer();
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// --- Setup ---

async function handleSetup(masterPassword: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await createVault(masterPassword);
    vault = { passwords: [], folders: [], cards: [], authenticators: [] };
    cachedKey = result.key;
    cachedSalt = result.salt;
    updateBadge();
    resetAutoLockTimer();
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// --- Import backup ---

async function handleImportBackup(
  backupData: string,
  backupPassword: string,
  masterPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const importedVault = await decryptBackup(backupData, backupPassword);
    const result = await createVault(masterPassword, importedVault);
    vault = importedVault;
    cachedKey = result.key;
    cachedSalt = result.salt;
    updateBadge();
    resetAutoLockTimer();
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// --- Unlock (local vault) ---

async function handleUnlock(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await unlockVault(password);
    vault = result.vault;
    cachedKey = result.key;
    cachedSalt = result.salt;
    updateBadge();
    resetAutoLockTimer();
    return { success: true };
  } catch (err) {
    vault = null;
    cachedKey = null;
    cachedSalt = null;
    return { success: false, error: (err as Error).message };
  }
}

// --- Save password ---

async function handleSavePassword(password: PasswordModel): Promise<{ success: boolean }> {
  if (!vault || !cachedKey || !cachedSalt) return { success: false };

  const exists = vault.passwords.some(
    p => p.websiteUrl === password.websiteUrl && p.email === password.email
  );
  if (!exists) {
    vault.passwords.push(password);
  } else {
    const idx = vault.passwords.findIndex(
      p => p.websiteUrl === password.websiteUrl && p.email === password.email
    );
    if (idx >= 0) vault.passwords[idx] = password;
  }

  await persistVault();
  return { success: true };
}

// --- Delete item ---

async function handleDeleteItem(
  collection: 'passwords' | 'cards' | 'authenticators',
  id: string
): Promise<{ success: boolean }> {
  if (!vault || !cachedKey || !cachedSalt) return { success: false };

  const list = vault[collection] as { id: string }[];
  const idx = list.findIndex(item => item.id === id);
  if (idx >= 0) {
    list.splice(idx, 1);
    await persistVault();
  }
  return { success: true };
}

// --- Persist vault to chrome.storage.local ---

async function persistVault(): Promise<void> {
  if (!vault || !cachedKey || !cachedSalt) return;
  await saveVault(vault, cachedKey, cachedSalt);
}

// --- Drive sync (premium) ---

async function handleSyncFromDrive(
  backupPassword: string
): Promise<{ success: boolean; error?: string }> {
  if (!vault || !cachedKey || !cachedSalt) {
    return { success: false, error: 'Vault is locked' };
  }

  const premium = await handleCheckPremium();
  if (!premium.isPremium) {
    return { success: false, error: 'Premium required for Drive sync' };
  }

  try {
    const backup = await downloadBackup();
    if (!backup) {
      return { success: false, error: 'No backup found on Google Drive' };
    }

    const remoteVault = await decryptBackup(backup, backupPassword);
    const lastSync = await getLastSyncTimestamp();
    const merged = mergeVaults(vault, remoteVault, lastSync);

    vault = merged;
    await persistVault();
    await setLastSyncTimestamp(new Date());

    // Upload merged vault back to Drive
    const encrypted = await encryptBackup(merged, backupPassword);
    await uploadBackup(encrypted);

    updateBadge();
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function handleSyncToDrive(
  backupPassword: string
): Promise<{ success: boolean; error?: string }> {
  if (!vault) {
    return { success: false, error: 'Vault is locked' };
  }

  const premium = await handleCheckPremium();
  if (!premium.isPremium) {
    return { success: false, error: 'Premium required for Drive sync' };
  }

  try {
    const encrypted = await encryptBackup(vault, backupPassword);
    await uploadBackup(encrypted);
    await setLastSyncTimestamp(new Date());
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// --- Premium check ---

async function handleCheckPremium(): Promise<{ isPremium: boolean }> {
  if (Date.now() - premiumCheckedAt < PREMIUM_CACHE_MS) {
    return { isPremium };
  }

  try {
    const token = await getAuthTokenSafe();
    if (!token) return { isPremium: false };

    const email = await getUserEmail();
    userEmail = email;
    isPremium = await checkPremiumStatus(email, token);
    premiumCheckedAt = Date.now();
    return { isPremium };
  } catch {
    return { isPremium };
  }
}

async function handleConnectGoogle(): Promise<{ success: boolean; email?: string; isPremium?: boolean; error?: string }> {
  try {
    // Interactive auth — will prompt Google sign-in if needed
    const token = await new Promise<string>((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (result) => {
        const t = typeof result === 'string' ? result : result?.token;
        if (chrome.runtime.lastError || !t) {
          reject(new Error(chrome.runtime.lastError?.message || 'Sign-in cancelled'));
        } else {
          resolve(t);
        }
      });
    });

    const email = await getUserEmail();
    userEmail = email;

    const premium = await checkPremiumStatus(email, token);
    isPremium = premium;
    premiumCheckedAt = Date.now();

    return { success: true, email, isPremium: premium };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

function getAuthTokenSafe(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (result) => {
      const token = typeof result === 'string' ? result : result?.token;
      resolve(token || null);
    });
  });
}

// --- Credential matching ---

function getMatchingCredentials(url: string): PasswordModel[] {
  if (!vault) return [];
  return vault.passwords.filter(p => matchesDomain(p.websiteUrl, url));
}

// --- Password generator ---

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
  cachedKey = null;
  cachedSalt = null;
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

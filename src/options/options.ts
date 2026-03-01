/**
 * Options page — full vault manager with sidebar navigation.
 * Sections: Vault (passwords/cards/2FA), Generator, Sync, Settings.
 */

import type { PasswordModel } from '../models/password';
import type { CardModel } from '../models/card';
import type { AuthenticatorModel } from '../models/authenticator';
import { maskedCardNumber } from '../models/card';
import { generateTOTP } from '../crypto/totp';

// --- Helpers ---

function sendMessage(msg: unknown): Promise<any> {
  return chrome.runtime.sendMessage(msg);
}

function showToast(text: string) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
  showToast('Copied!');
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
}

// --- DOM refs ---

// Lock overlay
const lockOverlay = document.getElementById('lock-overlay')!;
const lockForm = document.getElementById('lock-form') as HTMLFormElement;
const lockPassword = document.getElementById('lock-password') as HTMLInputElement;
const lockError = document.getElementById('lock-error')!;

// Sidebar nav
const navItems = document.querySelectorAll<HTMLElement>('.nav-item');
const sections = ['vault', 'generator', 'sync', 'settings'];

// Vault
const vaultSearch = document.getElementById('vault-search') as HTMLInputElement;
const vaultTabs = document.querySelectorAll<HTMLElement>('.vault-tab');
const tabPasswords = document.getElementById('tab-passwords')!;
const tabCards = document.getElementById('tab-cards')!;
const tabAuthenticators = document.getElementById('tab-authenticators')!;
const passwordCount = document.getElementById('password-count')!;
const cardCount = document.getElementById('card-count')!;
const authCount = document.getElementById('auth-count')!;

// Generator
const genPasswordEl = document.getElementById('opt-generated-password')!;
const copyGenBtn = document.getElementById('opt-copy-generated')!;
const genLengthInput = document.getElementById('opt-gen-length') as HTMLInputElement;
const lengthValueEl = document.getElementById('opt-length-value')!;
const regenerateBtn = document.getElementById('opt-regenerate-btn')!;

// Sync
const syncNotConnected = document.getElementById('sync-not-connected')!;
const syncConnected = document.getElementById('sync-connected')!;
const connectGoogleBtn = document.getElementById('connect-google-btn')!;
const connectError = document.getElementById('connect-error')!;
const syncAvatar = document.getElementById('sync-avatar')!;
const syncEmail = document.getElementById('sync-email')!;
const syncPremiumBadge = document.getElementById('sync-premium-badge')!;
const signOutBtn = document.getElementById('sign-out-btn')!;
const syncPremiumSection = document.getElementById('sync-premium-section')!;
const syncNotPremium = document.getElementById('sync-not-premium')!;
const syncBackupPassword = document.getElementById('sync-backup-password') as HTMLInputElement;
const syncFromDriveBtn = document.getElementById('sync-from-drive-btn')!;
const syncToDriveBtn = document.getElementById('sync-to-drive-btn')!;
const syncStatus = document.getElementById('sync-status')!;

// Settings
const optAutoLock = document.getElementById('opt-auto-lock') as HTMLInputElement;
const optShowAutofill = document.getElementById('opt-show-autofill') as HTMLInputElement;
const optSavePrompts = document.getElementById('opt-save-prompts') as HTMLInputElement;
const exportPassword = document.getElementById('export-password') as HTMLInputElement;
const exportBtn = document.getElementById('export-btn')!;
const optLockBtn = document.getElementById('opt-lock-btn')!;

// --- State ---

let passwords: PasswordModel[] = [];
let cards: CardModel[] = [];
let authenticators: AuthenticatorModel[] = [];
let currentVaultTab = 'passwords';
let searchQuery = '';
let totpInterval: ReturnType<typeof setInterval> | null = null;

// --- Init ---

async function init() {
  const state = await sendMessage({ type: 'getSetupState' });

  if (!state.isSetUp) {
    // Not set up — redirect or show message
    lockOverlay.innerHTML = '<div class="lock-card"><img src="/assets/icons/icon-48.png" alt=""><h2>Mushaffar</h2><p>Please open the extension popup to set up your vault first.</p></div>';
    return;
  }

  if (!state.isUnlocked) {
    lockOverlay.classList.remove('hidden');
  } else {
    lockOverlay.classList.add('hidden');
    await loadVaultData();
    await loadSyncState();
  }

  loadSettings();
  generateNewPassword();

  // Check hash for initial section
  const hash = window.location.hash.replace('#', '');
  if (sections.includes(hash)) {
    switchSection(hash);
  }
}

// --- Lock / Unlock ---

lockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pwd = lockPassword.value;
  if (!pwd) return;

  lockError.classList.add('hidden');
  const result = await sendMessage({ type: 'unlock', password: pwd });

  if (result.success) {
    lockPassword.value = '';
    lockOverlay.classList.add('hidden');
    await loadVaultData();
    await loadSyncState();
    generateNewPassword();
  } else {
    lockError.textContent = result.error || 'Wrong password';
    lockError.classList.remove('hidden');
  }
});

optLockBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'lock' });
  lockOverlay.classList.remove('hidden');
  lockPassword.focus();
  passwords = [];
  cards = [];
  authenticators = [];
  renderPasswords();
  renderCards();
  renderAuthenticators();
});

// --- Sidebar navigation ---

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const section = item.dataset.section!;
    switchSection(section);
    window.location.hash = section;
  });
});

function switchSection(section: string) {
  navItems.forEach(n => n.classList.toggle('active', n.dataset.section === section));
  sections.forEach(s => {
    const el = document.getElementById(`section-${s}`);
    if (el) el.classList.toggle('hidden', s !== section);
  });
}

// --- Vault tabs ---

vaultTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab!;
    currentVaultTab = target;
    vaultTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === target));
    tabPasswords.classList.toggle('hidden', target !== 'passwords');
    tabCards.classList.toggle('hidden', target !== 'cards');
    tabAuthenticators.classList.toggle('hidden', target !== 'authenticators');
  });
});

// --- Search ---

vaultSearch.addEventListener('input', () => {
  searchQuery = vaultSearch.value.toLowerCase();
  renderPasswords();
  renderCards();
  renderAuthenticators();
});

// --- Load vault data ---

async function loadVaultData() {
  [passwords, cards, authenticators] = await Promise.all([
    sendMessage({ type: 'getAllPasswords' }),
    sendMessage({ type: 'getAllCards' }),
    sendMessage({ type: 'getAllAuthenticators' }),
  ]);

  passwordCount.textContent = String(passwords.length);
  cardCount.textContent = String(cards.length);
  authCount.textContent = String(authenticators.length);

  renderPasswords();
  renderCards();
  renderAuthenticators();
  startTOTPTimer();
}

// --- Render passwords ---

function renderPasswords() {
  const filtered = passwords.filter(p => {
    if (!searchQuery) return true;
    return (p.keyName?.toLowerCase().includes(searchQuery)) ||
           (p.email?.toLowerCase().includes(searchQuery)) ||
           (p.websiteUrl?.toLowerCase().includes(searchQuery));
  });

  if (filtered.length === 0) {
    tabPasswords.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        <p>${searchQuery ? 'No matching passwords' : 'No saved passwords'}</p>
      </div>`;
    return;
  }

  tabPasswords.innerHTML = filtered.map(p => {
    const domain = p.websiteUrl ? extractDomain(p.websiteUrl) : '';
    const favicon = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
    return `
      <div class="item-row" data-id="${escapeHtml(p.id)}">
        <div class="item-icon">
          ${favicon ? `<img src="${favicon}" alt="">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`}
        </div>
        <div class="item-info">
          <div class="item-name">${escapeHtml(p.keyName)}</div>
          <div class="item-detail">${escapeHtml(p.email || domain || '')}</div>
        </div>
        <div class="item-actions">
          <button class="icon-btn copy-email-btn" title="Copy username" data-value="${escapeHtml(p.email || '')}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </button>
          <button class="icon-btn copy-pwd-btn" title="Copy password" data-value="${escapeHtml(p.password)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="icon-btn delete-pwd-btn" title="Delete" data-id="${escapeHtml(p.id)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');

  tabPasswords.querySelectorAll('.copy-email-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = (btn as HTMLElement).dataset.value;
      if (val) copyToClipboard(val);
    });
  });

  tabPasswords.querySelectorAll('.copy-pwd-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = (btn as HTMLElement).dataset.value;
      if (val) copyToClipboard(val);
    });
  });

  tabPasswords.querySelectorAll('.delete-pwd-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (!id) return;
      if (!confirm('Delete this password?')) return;
      await sendMessage({ type: 'deletePassword', id });
      await loadVaultData();
      showToast('Deleted');
    });
  });
}

// --- Render cards ---

function renderCards() {
  const filtered = cards.filter(c => {
    if (!searchQuery) return true;
    return (c.cardName?.toLowerCase().includes(searchQuery)) ||
           (c.cardholderName?.toLowerCase().includes(searchQuery)) ||
           (c.bankName?.toLowerCase().includes(searchQuery));
  });

  if (filtered.length === 0) {
    tabCards.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
        <p>${searchQuery ? 'No matching cards' : 'No saved cards'}</p>
      </div>`;
    return;
  }

  tabCards.innerHTML = filtered.map(c => `
    <div class="item-row">
      <div class="item-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
      </div>
      <div class="item-info">
        <div class="item-name">${escapeHtml(c.cardName)}</div>
        <div class="item-detail"><span class="card-number">${escapeHtml(maskedCardNumber(c))}</span> &middot; ${escapeHtml(c.expiryDate)}</div>
      </div>
      <div class="item-actions">
        <button class="icon-btn copy-card-btn" title="Copy number" data-value="${escapeHtml(c.cardNumber)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
        <button class="icon-btn delete-card-btn" title="Delete" data-id="${escapeHtml(c.id)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  tabCards.querySelectorAll('.copy-card-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = (btn as HTMLElement).dataset.value;
      if (val) copyToClipboard(val);
    });
  });

  tabCards.querySelectorAll('.delete-card-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (!id) return;
      if (!confirm('Delete this card?')) return;
      await sendMessage({ type: 'deleteCard', id });
      await loadVaultData();
      showToast('Deleted');
    });
  });
}

// --- Render authenticators ---

function renderAuthenticators() {
  const filtered = authenticators.filter(a => {
    if (!searchQuery) return true;
    return (a.issuer?.toLowerCase().includes(searchQuery)) ||
           (a.accountName?.toLowerCase().includes(searchQuery));
  });

  if (filtered.length === 0) {
    tabAuthenticators.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <p>${searchQuery ? 'No matching 2FA codes' : 'No saved 2FA codes'}</p>
      </div>`;
    return;
  }

  tabAuthenticators.innerHTML = filtered.map(a => {
    const totp = generateTOTP(a);
    const formatted = totp.code.replace(/(.{3})/, '$1 ');
    const progress = totp.remaining / totp.period;
    const dashOffset = 62.83 * (1 - progress);

    return `
      <div class="item-row">
        <div class="item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div class="item-info">
          <div class="item-name">${escapeHtml(a.issuer)}</div>
          <div class="item-detail">${escapeHtml(a.accountName)}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="totp-code" data-secret="${escapeHtml(a.id)}">${formatted}</span>
          <div class="totp-timer">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" style="stroke-dashoffset:${dashOffset}" data-auth-id="${escapeHtml(a.id)}"/>
            </svg>
          </div>
        </div>
        <div class="item-actions">
          <button class="icon-btn copy-totp-btn" title="Copy code" data-value="${totp.code}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="icon-btn delete-auth-btn" title="Delete" data-id="${escapeHtml(a.id)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');

  tabAuthenticators.querySelectorAll('.copy-totp-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = (btn as HTMLElement).dataset.value;
      if (val) copyToClipboard(val);
    });
  });

  tabAuthenticators.querySelectorAll('.delete-auth-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (!id) return;
      if (!confirm('Delete this 2FA code?')) return;
      await sendMessage({ type: 'deleteAuthenticator', id });
      await loadVaultData();
      showToast('Deleted');
    });
  });
}

// --- TOTP timer ---

function startTOTPTimer() {
  if (totpInterval) clearInterval(totpInterval);
  if (authenticators.length === 0) return;

  totpInterval = setInterval(() => {
    authenticators.forEach(a => {
      const totp = generateTOTP(a);
      const formatted = totp.code.replace(/(.{3})/, '$1 ');
      const progress = totp.remaining / totp.period;
      const dashOffset = 62.83 * (1 - progress);

      const codeEl = tabAuthenticators.querySelector(`[data-secret="${a.id}"]`);
      if (codeEl) codeEl.textContent = formatted;

      const circleEl = tabAuthenticators.querySelector(`[data-auth-id="${a.id}"]`);
      if (circleEl) (circleEl as SVGElement).style.strokeDashoffset = String(dashOffset);

      // Update copy button value
      const copyBtn = codeEl?.closest('.item-row')?.querySelector('.copy-totp-btn') as HTMLElement | null;
      if (copyBtn) copyBtn.dataset.value = totp.code;
    });
  }, 1000);
}

// --- Generator ---

genLengthInput.addEventListener('input', () => {
  lengthValueEl.textContent = genLengthInput.value;
  generateNewPassword();
});

['opt-gen-uppercase', 'opt-gen-lowercase', 'opt-gen-numbers', 'opt-gen-symbols'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', generateNewPassword);
});

regenerateBtn.addEventListener('click', generateNewPassword);

copyGenBtn.addEventListener('click', () => {
  const text = genPasswordEl.textContent || '';
  if (text && text !== '............') copyToClipboard(text);
});

async function generateNewPassword() {
  const length = parseInt(genLengthInput.value);
  const uppercase = (document.getElementById('opt-gen-uppercase') as HTMLInputElement).checked;
  const lowercase = (document.getElementById('opt-gen-lowercase') as HTMLInputElement).checked;
  const numbers = (document.getElementById('opt-gen-numbers') as HTMLInputElement).checked;
  const symbols = (document.getElementById('opt-gen-symbols') as HTMLInputElement).checked;

  const password = await sendMessage({ type: 'generatePassword', length, uppercase, lowercase, numbers, symbols });
  genPasswordEl.textContent = password || 'Select at least one option';
}

// --- Sync ---

async function loadSyncState() {
  const state = await sendMessage({ type: 'getState' });

  if (state.userEmail) {
    showConnectedState(state.userEmail, state.isPremium);
  } else {
    // Try non-interactive check
    const result = await sendMessage({ type: 'checkPremium' });
    if (result.isPremium) {
      const fullState = await sendMessage({ type: 'getState' });
      if (fullState.userEmail) {
        showConnectedState(fullState.userEmail, true);
        return;
      }
    }
    syncNotConnected.classList.remove('hidden');
    syncConnected.classList.add('hidden');
  }
}

function showConnectedState(email: string, premium: boolean) {
  syncNotConnected.classList.add('hidden');
  syncConnected.classList.remove('hidden');
  syncEmail.textContent = email;
  syncAvatar.textContent = email.charAt(0).toUpperCase();

  if (premium) {
    syncPremiumBadge.innerHTML = '<span class="premium-badge">Premium</span>';
    syncPremiumSection.classList.remove('hidden');
    syncNotPremium.classList.add('hidden');
  } else {
    syncPremiumBadge.innerHTML = '<span class="free-badge">Free</span>';
    syncPremiumSection.classList.add('hidden');
    syncNotPremium.classList.remove('hidden');
  }
}

connectGoogleBtn.addEventListener('click', async () => {
  connectGoogleBtn.textContent = 'Connecting...';
  connectGoogleBtn.setAttribute('disabled', 'true');
  connectError.classList.add('hidden');

  const result = await sendMessage({ type: 'connectGoogle' });

  connectGoogleBtn.textContent = 'Connect Google Account';
  connectGoogleBtn.removeAttribute('disabled');

  if (result.success) {
    showConnectedState(result.email, result.isPremium);
  } else {
    connectError.textContent = result.error || 'Connection failed';
    connectError.classList.remove('hidden');
  }
});

signOutBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'signOut' });
  syncNotConnected.classList.remove('hidden');
  syncConnected.classList.add('hidden');
  showToast('Signed out');
});

syncFromDriveBtn.addEventListener('click', async () => {
  const pwd = syncBackupPassword.value;
  if (!pwd) { showSyncStatus('Enter your backup password', true); return; }

  syncFromDriveBtn.textContent = 'Syncing...';
  syncFromDriveBtn.setAttribute('disabled', 'true');

  const result = await sendMessage({ type: 'syncFromDrive', backupPassword: pwd });

  syncFromDriveBtn.textContent = 'Sync from Drive';
  syncFromDriveBtn.removeAttribute('disabled');

  if (result.success) {
    showSyncStatus('Synced successfully!', false);
    await loadVaultData();
  } else {
    showSyncStatus(result.error || 'Sync failed', true);
  }
});

syncToDriveBtn.addEventListener('click', async () => {
  const pwd = syncBackupPassword.value;
  if (!pwd) { showSyncStatus('Enter your backup password', true); return; }

  syncToDriveBtn.textContent = 'Uploading...';
  syncToDriveBtn.setAttribute('disabled', 'true');

  const result = await sendMessage({ type: 'syncToDrive', backupPassword: pwd });

  syncToDriveBtn.textContent = 'Upload to Drive';
  syncToDriveBtn.removeAttribute('disabled');

  if (result.success) {
    showSyncStatus('Uploaded to Drive!', false);
  } else {
    showSyncStatus(result.error || 'Upload failed', true);
  }
});

function showSyncStatus(msg: string, isError: boolean) {
  syncStatus.textContent = msg;
  syncStatus.className = `status-msg ${isError ? 'error' : 'success'}`;
  syncStatus.classList.remove('hidden');
  setTimeout(() => syncStatus.classList.add('hidden'), 4000);
}

// --- Settings ---

function loadSettings() {
  chrome.storage.local.get(['autoLockMinutes', 'showAutofill', 'savePrompts'], (result) => {
    if (result.autoLockMinutes) optAutoLock.value = String(result.autoLockMinutes);
    if (result.showAutofill !== undefined) optShowAutofill.checked = result.showAutofill as boolean;
    if (result.savePrompts !== undefined) optSavePrompts.checked = result.savePrompts as boolean;
  });
}

// Auto-save settings on change
[optAutoLock, optShowAutofill, optSavePrompts].forEach(el => {
  el.addEventListener('change', () => {
    chrome.storage.local.set({
      autoLockMinutes: parseInt(optAutoLock.value) || 5,
      showAutofill: optShowAutofill.checked,
      savePrompts: optSavePrompts.checked,
    });
    showToast('Settings saved');
  });
});

// --- Export ---

exportBtn.addEventListener('click', async () => {
  const pwd = exportPassword.value;
  if (!pwd) { showToast('Enter a backup password'); return; }
  if (pwd.length < 4) { showToast('Password too short'); return; }

  exportBtn.textContent = 'Encrypting...';
  exportBtn.setAttribute('disabled', 'true');

  const result = await sendMessage({ type: 'exportBackup', backupPassword: pwd });

  exportBtn.textContent = 'Export';
  exportBtn.removeAttribute('disabled');

  if (result.error) {
    showToast(result.error);
    return;
  }

  // Trigger file download
  const blob = new Blob([result.data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mushaffar_backup.mushaffar';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded');
  exportPassword.value = '';
});

// --- Start ---
init();

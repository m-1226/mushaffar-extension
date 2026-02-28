/**
 * Popup main script — 3-state flow: Setup → Lock → Main.
 */

import type { PasswordModel } from '../models/password';
import type { CardModel } from '../models/card';
import type { AuthenticatorModel } from '../models/authenticator';
import type { FolderModel } from '../models/folder';
import { generateTOTP } from '../crypto/totp';
import { maskedCardNumber } from '../models/card';
import { matchesDomain } from '../models/password';

// --- DOM references ---
const setupScreen = document.getElementById('setup-screen')!;
const lockScreen = document.getElementById('lock-screen')!;
const mainScreen = document.getElementById('main-screen')!;

// Setup
const setupChoice = document.getElementById('setup-choice')!;
const setupFreshBtn = document.getElementById('setup-fresh-btn')!;
const setupImportBtn = document.getElementById('setup-import-btn')!;
const setupFreshSection = document.getElementById('setup-fresh')!;
const setupImportSection = document.getElementById('setup-import')!;
const setupForm = document.getElementById('setup-form') as HTMLFormElement;
const setupPasswordInput = document.getElementById('setup-password') as HTMLInputElement;
const setupConfirmInput = document.getElementById('setup-confirm') as HTMLInputElement;
const setupError = document.getElementById('setup-error')!;
const importForm = document.getElementById('import-form') as HTMLFormElement;
const importFileInput = document.getElementById('import-file') as HTMLInputElement;
const fileDropZone = document.getElementById('file-drop-zone')!;
const fileLabel = document.getElementById('file-label')!;
const importBackupPwdInput = document.getElementById('import-backup-password') as HTMLInputElement;
const importMasterPwdInput = document.getElementById('import-master-password') as HTMLInputElement;
const importConfirmInput = document.getElementById('import-confirm') as HTMLInputElement;
const importError = document.getElementById('import-error')!;
const setupBack1 = document.getElementById('setup-back-1')!;
const setupBack2 = document.getElementById('setup-back-2')!;

// Lock
const unlockForm = document.getElementById('unlock-form') as HTMLFormElement;
const masterPasswordInput = document.getElementById('master-password') as HTMLInputElement;
const togglePasswordBtn = document.getElementById('toggle-password')!;
const unlockBtn = document.getElementById('unlock-btn') as HTMLButtonElement;
const unlockError = document.getElementById('unlock-error')!;

// Main
const userEmailEl = document.getElementById('user-email')!;
const connectGoogleBtn = document.getElementById('connect-google-btn')!;
const syncBtn = document.getElementById('sync-btn')!;
const lockBtn = document.getElementById('lock-btn')!;
const suggestedSection = document.getElementById('suggested-section')!;
const suggestedList = document.getElementById('suggested-list')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');
const passwordList = document.getElementById('password-list')!;
const cardList = document.getElementById('card-list')!;
const authenticatorList = document.getElementById('authenticator-list')!;
const generatedPasswordEl = document.getElementById('generated-password')!;
const copyGeneratedBtn = document.getElementById('copy-generated')!;
const genLengthInput = document.getElementById('gen-length') as HTMLInputElement;
const lengthValueEl = document.getElementById('length-value')!;
const regenerateBtn = document.getElementById('regenerate-btn')!;

// --- State ---
let allPasswords: PasswordModel[] = [];
let allCards: CardModel[] = [];
let allAuthenticators: AuthenticatorModel[] = [];
let allFolders: FolderModel[] = [];
let totpInterval: ReturnType<typeof setInterval> | null = null;
let importFileData: string | null = null;
let currentTabId: number | null = null;

// --- Init ---
async function init() {
  const state = await sendMessage({ type: 'getSetupState' });

  if (!state.isSetUp) {
    showScreen('setup');
  } else if (!state.isUnlocked) {
    showScreen('lock');
  } else {
    showScreen('main');
    const fullState = await sendMessage({ type: 'getState' });
    if (fullState.userEmail) userEmailEl.textContent = fullState.userEmail;
    await loadAllData();
    await showSuggestedForCurrentSite();
    await checkPremiumUI();
  }
}

async function showSuggestedForCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !tab.id) return;
    currentTabId = tab.id;

    const matches = allPasswords.filter(p => matchesDomain(p.websiteUrl, tab.url!));
    if (matches.length === 0) {
      suggestedSection.classList.add('hidden');
      return;
    }

    suggestedSection.classList.remove('hidden');
    suggestedList.innerHTML = matches.map(p => {
      const domain = p.websiteUrl ? extractDomainForFavicon(p.websiteUrl) : '';
      const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';

      return `
        <div class="item-card suggested-card" data-id="${p.id}">
          <div class="item-icon">
            ${faviconUrl ? `<img src="${faviconUrl}" alt="">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`}
          </div>
          <div class="item-info">
            <div class="item-name">${escapeHtml(p.keyName)}</div>
            <div class="item-detail">${escapeHtml(p.email || '')}</div>
          </div>
          <button class="btn-fill" data-email="${escapeAttr(p.email || '')}" data-password="${escapeAttr(p.password)}">Fill</button>
        </div>
      `;
    }).join('');

    // Fill button handlers
    suggestedList.querySelectorAll('.btn-fill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = btn as HTMLElement;
        if (currentTabId) {
          chrome.tabs.sendMessage(currentTabId, {
            type: 'fillCredential',
            email: el.dataset.email,
            password: el.dataset.password,
          });
          window.close();
        }
      });
    });
  } catch { /* ignore — e.g. on chrome:// pages */ }
}

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

// --- Screen switching ---
function showScreen(screen: 'setup' | 'lock' | 'main') {
  setupScreen.classList.remove('active');
  lockScreen.classList.remove('active');
  mainScreen.classList.remove('active');

  if (screen === 'setup') {
    setupScreen.classList.add('active');
  } else if (screen === 'lock') {
    lockScreen.classList.add('active');
    masterPasswordInput.focus();
  } else {
    mainScreen.classList.add('active');
  }
}

// --- Setup: Fresh vault ---
setupFreshBtn.addEventListener('click', () => {
  setupChoice.classList.add('hidden');
  setupFreshSection.classList.remove('hidden');
  setupPasswordInput.focus();
});

setupBack1.addEventListener('click', () => {
  setupFreshSection.classList.add('hidden');
  setupChoice.classList.remove('hidden');
});

setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setupError.classList.add('hidden');

  const pwd = setupPasswordInput.value;
  const confirm = setupConfirmInput.value;

  if (pwd.length < 8) {
    setupError.textContent = 'Password must be at least 8 characters';
    setupError.classList.remove('hidden');
    return;
  }
  if (pwd !== confirm) {
    setupError.textContent = 'Passwords do not match';
    setupError.classList.remove('hidden');
    return;
  }

  const result = await sendMessage({ type: 'setup', masterPassword: pwd });
  if (result.success) {
    showScreen('main');
    await loadAllData();
  } else {
    setupError.textContent = result.error || 'Setup failed';
    setupError.classList.remove('hidden');
  }
});

// --- Setup: Import ---
setupImportBtn.addEventListener('click', () => {
  setupChoice.classList.add('hidden');
  setupImportSection.classList.remove('hidden');
});

setupBack2.addEventListener('click', () => {
  setupImportSection.classList.add('hidden');
  setupChoice.classList.remove('hidden');
  importFileData = null;
  fileLabel.textContent = 'Drop .mushaffar file or click';
});

fileDropZone.addEventListener('click', () => importFileInput.click());
fileDropZone.addEventListener('dragover', (e) => { e.preventDefault(); fileDropZone.classList.add('dragover'); });
fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('dragover'));
fileDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  fileDropZone.classList.remove('dragover');
  const file = (e as DragEvent).dataTransfer?.files[0];
  if (file) handleFileSelect(file);
});

importFileInput.addEventListener('change', () => {
  const file = importFileInput.files?.[0];
  if (file) handleFileSelect(file);
});

function handleFileSelect(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    // Read as text (base64-encoded backup)
    importFileData = reader.result as string;
    fileLabel.textContent = file.name;
  };
  reader.readAsText(file);
}

importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  importError.classList.add('hidden');

  if (!importFileData) {
    importError.textContent = 'Please select a .mushaffar file';
    importError.classList.remove('hidden');
    return;
  }

  const backupPwd = importBackupPwdInput.value;
  const masterPwd = importMasterPwdInput.value;
  const confirm = importConfirmInput.value;

  if (!backupPwd) {
    importError.textContent = 'Enter backup password from your app';
    importError.classList.remove('hidden');
    return;
  }
  if (masterPwd.length < 8) {
    importError.textContent = 'Master password must be at least 8 characters';
    importError.classList.remove('hidden');
    return;
  }
  if (masterPwd !== confirm) {
    importError.textContent = 'Passwords do not match';
    importError.classList.remove('hidden');
    return;
  }

  const importBtn = document.getElementById('import-btn') as HTMLButtonElement;
  importBtn.disabled = true;
  importBtn.textContent = 'Decrypting...';

  const result = await sendMessage({
    type: 'importBackup',
    backupData: importFileData.trim(),
    backupPassword: backupPwd,
    masterPassword: masterPwd,
  });

  importBtn.disabled = false;
  importBtn.textContent = 'Import & Create Vault';

  if (result.success) {
    showScreen('main');
    await loadAllData();
  } else {
    importError.textContent = result.error || 'Import failed';
    importError.classList.remove('hidden');
  }
});

// --- Unlock ---
unlockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = masterPasswordInput.value;
  if (!password) return;

  unlockBtn.classList.add('loading');
  unlockBtn.disabled = true;
  unlockError.classList.add('hidden');

  const result = await sendMessage({ type: 'unlock', password });

  unlockBtn.classList.remove('loading');
  unlockBtn.disabled = false;

  if (result.success) {
    masterPasswordInput.value = '';
    showScreen('main');
    const state = await sendMessage({ type: 'getState' });
    if (state.userEmail) userEmailEl.textContent = state.userEmail;
    await loadAllData();
    await checkPremiumUI();
  } else {
    unlockError.textContent = result.error || 'Wrong password';
    unlockError.classList.remove('hidden');
  }
});

togglePasswordBtn.addEventListener('click', () => {
  const isPassword = masterPasswordInput.type === 'password';
  masterPasswordInput.type = isPassword ? 'text' : 'password';
});

// --- Lock ---
lockBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'lock' });
  allPasswords = [];
  allCards = [];
  allAuthenticators = [];
  if (totpInterval) clearInterval(totpInterval);
  showScreen('lock');
});

// --- Premium check (show/hide sync button) ---
async function checkPremiumUI() {
  const result = await sendMessage({ type: 'checkPremium' });
  if (result.isPremium) {
    syncBtn.style.display = '';
    connectGoogleBtn.style.display = 'none';
    const state = await sendMessage({ type: 'getState' });
    if (state.userEmail) userEmailEl.textContent = state.userEmail;
  } else {
    syncBtn.style.display = 'none';
    connectGoogleBtn.style.display = '';
  }
}

// --- Connect Google (interactive sign-in) ---
connectGoogleBtn.addEventListener('click', async () => {
  connectGoogleBtn.querySelector('svg')?.classList.add('spinning');
  try {
    const result = await sendMessage({ type: 'connectGoogle' });
    if (result.error) {
      showToast(result.error);
      return;
    }
    if (result.email) userEmailEl.textContent = result.email;
    if (result.isPremium) {
      syncBtn.style.display = '';
      connectGoogleBtn.style.display = 'none';
      showToast('Drive sync enabled!');
    } else {
      showToast('Drive sync requires Premium');
    }
  } catch {
    showToast('Google sign-in failed');
  } finally {
    connectGoogleBtn.querySelector('svg')?.classList.remove('spinning');
  }
});

// --- Sync ---
syncBtn.addEventListener('click', async () => {
  const backupPassword = prompt('Enter your Drive backup password:');
  if (!backupPassword) return;

  syncBtn.querySelector('svg')?.classList.add('spinning');
  const result = await sendMessage({ type: 'syncFromDrive', backupPassword });
  syncBtn.querySelector('svg')?.classList.remove('spinning');

  if (result.success) {
    await loadAllData();
    await showSuggestedForCurrentSite();
    showToast('Synced!');
  } else {
    showToast(result.error || 'Sync failed');
  }
});

// --- Tabs ---
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = (tab as HTMLElement).dataset.tab!;
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(tc => tc.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${target}`)?.classList.add('active');
    sendMessage({ type: 'resetAutoLock' });
  });
});

// --- Search ---
searchInput.addEventListener('input', () => {
  const query = searchInput.value.toLowerCase();
  renderPasswords(query);
  renderCards(query);
  renderAuthenticators(query);
});

// --- Load data ---
async function loadAllData() {
  [allPasswords, allCards, allAuthenticators, allFolders] = await Promise.all([
    sendMessage({ type: 'getAllPasswords' }),
    sendMessage({ type: 'getAllCards' }),
    sendMessage({ type: 'getAllAuthenticators' }),
    sendMessage({ type: 'getAllFolders' }),
  ]);

  renderPasswords();
  renderCards();
  renderAuthenticators();
  generateNewPassword();
  startTOTPTimer();
}

// --- Render passwords ---
function renderPasswords(filter = '') {
  const filtered = allPasswords.filter(p =>
    p.keyName.toLowerCase().includes(filter) ||
    (p.email?.toLowerCase().includes(filter)) ||
    (p.websiteUrl?.toLowerCase().includes(filter))
  );

  const noPasswords = document.getElementById('no-passwords')!;
  if (filtered.length === 0) {
    passwordList.innerHTML = '';
    noPasswords.classList.remove('hidden');
    return;
  }
  noPasswords.classList.add('hidden');

  passwordList.innerHTML = filtered.map(p => {
    const domain = p.websiteUrl ? extractDomainForFavicon(p.websiteUrl) : '';
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';

    return `
      <div class="item-card" data-id="${p.id}">
        <div class="item-icon">
          ${faviconUrl ? `<img src="${faviconUrl}" alt="">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`}
        </div>
        <div class="item-info">
          <div class="item-name">${escapeHtml(p.keyName)}</div>
          <div class="item-detail">${escapeHtml(p.email || '')}</div>
        </div>
        <div class="item-actions">
          <button class="icon-btn copy-user" title="Copy username" data-value="${escapeAttr(p.email || '')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </button>
          <button class="icon-btn copy-pass" title="Copy password" data-value="${escapeAttr(p.password)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  passwordList.querySelectorAll('.copy-user').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard((btn as HTMLElement).dataset.value || '');
    });
  });
  passwordList.querySelectorAll('.copy-pass').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard((btn as HTMLElement).dataset.value || '');
    });
  });
}

// --- Render cards ---
function renderCards(filter = '') {
  const filtered = allCards.filter(c =>
    c.cardName.toLowerCase().includes(filter) ||
    c.cardholderName.toLowerCase().includes(filter) ||
    (c.bankName?.toLowerCase().includes(filter))
  );

  const noCards = document.getElementById('no-cards')!;
  if (filtered.length === 0) {
    cardList.innerHTML = '';
    noCards.classList.remove('hidden');
    return;
  }
  noCards.classList.add('hidden');

  cardList.innerHTML = filtered.map(c => `
    <div class="item-card" data-id="${c.id}">
      <div class="item-icon" style="background: ${c.brandColor ? intToColor(c.brandColor) : 'var(--bg-input)'}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
      </div>
      <div class="item-info">
        <div class="item-name">${escapeHtml(c.cardName)}</div>
        <div class="item-detail card-number">${maskedCardNumber(c)}</div>
      </div>
      <div class="item-actions">
        <button class="icon-btn copy-card" title="Copy card number" data-value="${escapeAttr(c.cardNumber)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  cardList.querySelectorAll('.copy-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard((btn as HTMLElement).dataset.value || '');
    });
  });
}

// --- Render authenticators ---
function renderAuthenticators(filter = '') {
  const filtered = allAuthenticators.filter(a =>
    a.issuer.toLowerCase().includes(filter) ||
    a.accountName.toLowerCase().includes(filter)
  );

  const noAuth = document.getElementById('no-authenticators')!;
  if (filtered.length === 0) {
    authenticatorList.innerHTML = '';
    noAuth.classList.remove('hidden');
    return;
  }
  noAuth.classList.add('hidden');

  authenticatorList.innerHTML = filtered.map(a => {
    const { code, remaining, period } = generateTOTP(a);
    const circumference = 2 * Math.PI * 10;
    const offset = circumference * (1 - remaining / period);

    return `
      <div class="item-card" data-id="${a.id}">
        <div class="item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
          </svg>
        </div>
        <div class="item-info">
          <div class="item-name">${escapeHtml(a.issuer)}</div>
          <div class="item-detail">${escapeHtml(a.accountName)}</div>
        </div>
        <div class="totp-code">${formatTOTP(code)}</div>
        <div class="totp-timer">
          <svg class="totp-timer-circle" width="28" height="28" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="none" stroke="var(--border)" stroke-width="2"/>
            <circle cx="12" cy="12" r="10" fill="none" stroke="var(--primary)" stroke-width="2"
              stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
          </svg>
          <span class="totp-timer-text">${remaining}</span>
        </div>
        <button class="icon-btn copy-totp" title="Copy code" data-value="${code}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
      </div>
    `;
  }).join('');

  authenticatorList.querySelectorAll('.copy-totp').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard((btn as HTMLElement).dataset.value || '');
    });
  });
}

function startTOTPTimer() {
  if (totpInterval) clearInterval(totpInterval);
  totpInterval = setInterval(() => {
    if (allAuthenticators.length > 0) {
      renderAuthenticators(searchInput.value.toLowerCase());
    }
  }, 1000);
}

function formatTOTP(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}

// --- Generator ---
genLengthInput.addEventListener('input', () => {
  lengthValueEl.textContent = genLengthInput.value;
  generateNewPassword();
});

['gen-uppercase', 'gen-lowercase', 'gen-numbers', 'gen-symbols'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', generateNewPassword);
});

regenerateBtn.addEventListener('click', generateNewPassword);

copyGeneratedBtn.addEventListener('click', () => {
  const text = generatedPasswordEl.textContent || '';
  if (text && text !== '............') copyToClipboard(text);
});

async function generateNewPassword() {
  const length = parseInt(genLengthInput.value);
  const uppercase = (document.getElementById('gen-uppercase') as HTMLInputElement).checked;
  const lowercase = (document.getElementById('gen-lowercase') as HTMLInputElement).checked;
  const numbers = (document.getElementById('gen-numbers') as HTMLInputElement).checked;
  const symbols = (document.getElementById('gen-symbols') as HTMLInputElement).checked;

  const password = await sendMessage({
    type: 'generatePassword',
    length, uppercase, lowercase, numbers, symbols,
  });

  generatedPasswordEl.textContent = password || 'Select at least one option';
}

// --- Helpers ---
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function extractDomainForFavicon(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
}

function intToColor(colorInt: number): string {
  return `#${(colorInt & 0xFFFFFF).toString(16).padStart(6, '0')}`;
}

// --- Start ---
init();

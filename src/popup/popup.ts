/**
 * Popup — minimal Google Password Manager style.
 * Shows matching credentials for current site + collapsible generator.
 * Full vault browsing lives in the options page.
 */

import type { PasswordModel } from '../models/password';

// --- DOM refs ---

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
const syncBtn = document.getElementById('sync-btn')!;
const lockBtn = document.getElementById('lock-btn')!;
const siteLabel = document.getElementById('site-label')!;
const credentialList = document.getElementById('credential-list')!;
const noMatchState = document.getElementById('no-match-state')!;
const vaultSummary = document.getElementById('vault-summary')!;
const generatorToggle = document.getElementById('generator-toggle')!;
const generatorBody = document.getElementById('generator-body')!;
const generatedPasswordEl = document.getElementById('generated-password')!;
const copyGeneratedBtn = document.getElementById('copy-generated')!;
const genLengthInput = document.getElementById('gen-length') as HTMLInputElement;
const lengthValueEl = document.getElementById('length-value')!;
const regenerateBtn = document.getElementById('regenerate-btn')!;
const openVaultBtn = document.getElementById('open-vault-btn')!;
const openSettingsBtn = document.getElementById('open-settings-btn')!;

// --- State ---
let currentTabId: number | null = null;
let importFileData: string | null = null;

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

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
}

// --- Screen switching ---

function showScreen(screen: 'setup' | 'lock' | 'main') {
  setupScreen.classList.remove('active');
  lockScreen.classList.remove('active');
  mainScreen.classList.remove('active');

  if (screen === 'setup') setupScreen.classList.add('active');
  else if (screen === 'lock') { lockScreen.classList.add('active'); masterPasswordInput.focus(); }
  else mainScreen.classList.add('active');
}

// --- Init ---

async function init() {
  const state = await sendMessage({ type: 'getSetupState' });

  if (!state.isSetUp) {
    showScreen('setup');
  } else if (!state.isUnlocked) {
    showScreen('lock');
  } else {
    showScreen('main');
    await showMatchingCredentials();
    await checkPremiumUI();
    generateNewPassword();
  }
}

// --- Main: show matching credentials for current site ---

async function showMatchingCredentials() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !tab.id || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      showNoMatchState();
      return;
    }
    currentTabId = tab.id;

    const matches: PasswordModel[] = await sendMessage({ type: 'getMatches', url: tab.url });

    if (matches.length > 0) {
      const domain = extractDomain(tab.url);
      siteLabel.innerHTML = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" alt=""><span>${escapeHtml(domain)}</span>`;
      siteLabel.classList.remove('hidden');
      noMatchState.classList.add('hidden');
      vaultSummary.classList.add('hidden');

      credentialList.innerHTML = matches.map(p => {
        const pDomain = p.websiteUrl ? extractDomain(p.websiteUrl) : '';
        const favicon = pDomain ? `https://www.google.com/s2/favicons?domain=${pDomain}&sz=32` : '';
        return `
          <div class="credential-row">
            <div class="credential-icon">
              ${favicon ? `<img src="${favicon}" alt="">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`}
            </div>
            <div class="credential-info">
              <div class="credential-name">${escapeHtml(p.email || p.keyName)}</div>
              <div class="credential-detail">${escapeHtml(p.keyName)}</div>
            </div>
            <button class="btn-fill" data-email="${escapeAttr(p.email || '')}" data-password="${escapeAttr(p.password)}">Fill</button>
          </div>`;
      }).join('');

      credentialList.querySelectorAll('.btn-fill').forEach(btn => {
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
    } else {
      showNoMatchState();
    }
  } catch {
    showNoMatchState();
  }
}

async function showNoMatchState() {
  siteLabel.classList.add('hidden');
  credentialList.innerHTML = '';
  noMatchState.classList.remove('hidden');

  const state = await sendMessage({ type: 'getState' });
  const parts: string[] = [];
  if (state.passwordCount > 0) parts.push(`${state.passwordCount} passwords`);
  if (state.cardCount > 0) parts.push(`${state.cardCount} cards`);
  if (state.authenticatorCount > 0) parts.push(`${state.authenticatorCount} 2FA codes`);

  if (parts.length > 0) {
    vaultSummary.textContent = parts.join(' \u00B7 ');
    vaultSummary.classList.remove('hidden');
  }
}

// --- Premium / Sync ---

async function checkPremiumUI() {
  const result = await sendMessage({ type: 'checkPremium' });
  syncBtn.style.display = result.isPremium ? '' : 'none';
}

syncBtn.addEventListener('click', async () => {
  const backupPassword = prompt('Enter your Drive backup password:');
  if (!backupPassword) return;

  syncBtn.querySelector('svg')?.classList.add('spinning');
  const result = await sendMessage({ type: 'syncFromDrive', backupPassword });
  syncBtn.querySelector('svg')?.classList.remove('spinning');

  if (result.success) {
    await showMatchingCredentials();
    showToast('Synced!');
  } else {
    showToast(result.error || 'Sync failed');
  }
});

// --- Lock / Unlock ---

lockBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'lock' });
  showScreen('lock');
});

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
    await showMatchingCredentials();
    await checkPremiumUI();
    generateNewPassword();
  } else {
    unlockError.textContent = result.error || 'Wrong password';
    unlockError.classList.remove('hidden');
  }
});

togglePasswordBtn.addEventListener('click', () => {
  masterPasswordInput.type = masterPasswordInput.type === 'password' ? 'text' : 'password';
});

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

  if (pwd.length < 8) { setupError.textContent = 'Password must be at least 8 characters'; setupError.classList.remove('hidden'); return; }
  if (pwd !== confirm) { setupError.textContent = 'Passwords do not match'; setupError.classList.remove('hidden'); return; }

  const result = await sendMessage({ type: 'setup', masterPassword: pwd });
  if (result.success) {
    showScreen('main');
    await showMatchingCredentials();
    generateNewPassword();
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
  reader.onload = () => { importFileData = reader.result as string; fileLabel.textContent = file.name; };
  reader.readAsText(file);
}

importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  importError.classList.add('hidden');

  if (!importFileData) { importError.textContent = 'Please select a .mushaffar file'; importError.classList.remove('hidden'); return; }
  const backupPwd = importBackupPwdInput.value;
  const masterPwd = importMasterPwdInput.value;
  const confirm = importConfirmInput.value;
  if (!backupPwd) { importError.textContent = 'Enter backup password from your app'; importError.classList.remove('hidden'); return; }
  if (masterPwd.length < 8) { importError.textContent = 'Master password must be at least 8 characters'; importError.classList.remove('hidden'); return; }
  if (masterPwd !== confirm) { importError.textContent = 'Passwords do not match'; importError.classList.remove('hidden'); return; }

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
    await showMatchingCredentials();
    generateNewPassword();
  } else {
    importError.textContent = result.error || 'Import failed';
    importError.classList.remove('hidden');
  }
});

// --- Generator (collapsible) ---

generatorToggle.addEventListener('click', () => {
  generatorBody.classList.toggle('hidden');
  generatorToggle.querySelector('.chevron')?.classList.toggle('rotated');
});

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

  const password = await sendMessage({ type: 'generatePassword', length, uppercase, lowercase, numbers, symbols });
  generatedPasswordEl.textContent = password || 'Select at least one option';
}

// --- Footer ---

openVaultBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html#vault') });
  window.close();
});

openSettingsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html#settings') });
  window.close();
});

// --- Start ---
init();

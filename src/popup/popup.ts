/**
 * Popup main script — handles all popup UI interactions.
 */

import type { PasswordModel } from '../models/password';
import type { CardModel } from '../models/card';
import type { AuthenticatorModel } from '../models/authenticator';
import type { FolderModel } from '../models/folder';
import { generateTOTP } from '../crypto/totp';
import { maskedCardNumber } from '../models/card';

// --- DOM references ---
const lockScreen = document.getElementById('lock-screen')!;
const mainScreen = document.getElementById('main-screen')!;
const unlockForm = document.getElementById('unlock-form') as HTMLFormElement;
const masterPasswordInput = document.getElementById('master-password') as HTMLInputElement;
const togglePasswordBtn = document.getElementById('toggle-password')!;
const unlockBtn = document.getElementById('unlock-btn') as HTMLButtonElement;
const unlockError = document.getElementById('unlock-error')!;
const userEmailEl = document.getElementById('user-email')!;
const syncBtn = document.getElementById('sync-btn')!;
const lockBtn = document.getElementById('lock-btn')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;

// Tab elements
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// Lists
const passwordList = document.getElementById('password-list')!;
const cardList = document.getElementById('card-list')!;
const authenticatorList = document.getElementById('authenticator-list')!;

// Generator
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

// --- Init ---
async function init() {
  const state = await sendMessage({ type: 'getState' });
  if (state.isUnlocked) {
    showMainScreen(state.userEmail);
    await loadAllData();
  } else {
    showLockScreen();
  }
}

// --- Message helpers ---
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
function showLockScreen() {
  lockScreen.classList.add('active');
  mainScreen.classList.remove('active');
  masterPasswordInput.focus();
}

function showMainScreen(email?: string) {
  lockScreen.classList.remove('active');
  mainScreen.classList.add('active');
  if (email) userEmailEl.textContent = email;
}

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
    showMainScreen();
    const state = await sendMessage({ type: 'getState' });
    if (state.userEmail) userEmailEl.textContent = state.userEmail;
    await loadAllData();
  } else {
    unlockError.textContent = result.error || 'Wrong password';
    unlockError.classList.remove('hidden');
  }
});

// Toggle password visibility
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
  showLockScreen();
});

// --- Sync ---
syncBtn.addEventListener('click', async () => {
  syncBtn.querySelector('svg')?.classList.add('spinning');
  const result = await sendMessage({ type: 'sync' });
  syncBtn.querySelector('svg')?.classList.remove('spinning');

  if (result.success) {
    await loadAllData();
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

    // Reset auto-lock timer on interaction
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
    const faviconUrl = domain
      ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
      : '';

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

  // Click handlers
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

  renderTOTPList(filtered);
}

function renderTOTPList(authenticators: AuthenticatorModel[]) {
  authenticatorList.innerHTML = authenticators.map(a => {
    const { code, remaining, period } = generateTOTP(a);
    const progress = remaining / period;
    const circumference = 2 * Math.PI * 10;
    const offset = circumference * (1 - progress);

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
        <div class="totp-code" data-secret="${escapeAttr(a.secret)}" data-digits="${a.digits || 6}" data-period="${a.period || 30}" data-algorithm="${a.algorithm || 'SHA1'}">${formatTOTP(code)}</div>
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
      const filter = searchInput.value.toLowerCase();
      renderAuthenticators(filter);
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

const genCheckboxes = ['gen-uppercase', 'gen-lowercase', 'gen-numbers', 'gen-symbols'];
genCheckboxes.forEach(id => {
  document.getElementById(id)?.addEventListener('change', generateNewPassword);
});

regenerateBtn.addEventListener('click', generateNewPassword);

copyGeneratedBtn.addEventListener('click', () => {
  const text = generatedPasswordEl.textContent || '';
  if (text && text !== '••••••••••••') copyToClipboard(text);
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
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname;
  } catch {
    return '';
  }
}

function intToColor(colorInt: number): string {
  const hex = (colorInt & 0xFFFFFF).toString(16).padStart(6, '0');
  return `#${hex}`;
}

// --- Start ---
init();

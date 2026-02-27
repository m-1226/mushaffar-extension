/**
 * Content script — form detection, inline auto-fill dropdown, save-password detection.
 * Injected on all pages.
 */

import type { PasswordModel } from '../models/password';
import type { CardModel } from '../models/card';

let dropdown: HTMLElement | null = null;
let activeInput: HTMLInputElement | null = null;
let matchedCredentials: PasswordModel[] = [];
let matchedCards: CardModel[] = [];

// --- Form field detection ---

function isUsernameField(input: HTMLInputElement): boolean {
  const type = input.type.toLowerCase();
  const name = (input.name + input.id + (input.getAttribute('autocomplete') || '')).toLowerCase();
  if (type === 'email') return true;
  if (type === 'text' && /user|email|login|account|name/i.test(name)) return true;
  return false;
}

function isPasswordField(input: HTMLInputElement): boolean {
  return input.type === 'password';
}

function isCardNumberField(input: HTMLInputElement): boolean {
  const name = (input.name + input.id + (input.getAttribute('autocomplete') || '')).toLowerCase();
  return /card.?num|cc.?num|cc-number/i.test(name) || input.getAttribute('autocomplete') === 'cc-number';
}

function isCardNameField(input: HTMLInputElement): boolean {
  const name = (input.name + input.id + (input.getAttribute('autocomplete') || '')).toLowerCase();
  return /card.?holder|cc.?name|cc-name/i.test(name) || input.getAttribute('autocomplete') === 'cc-name';
}

function isCardExpiryField(input: HTMLInputElement): boolean {
  const name = (input.name + input.id + (input.getAttribute('autocomplete') || '')).toLowerCase();
  return /expir|cc.?exp/i.test(name) || /cc-exp/.test(input.getAttribute('autocomplete') || '');
}

function isCardCVVField(input: HTMLInputElement): boolean {
  const name = (input.name + input.id + (input.getAttribute('autocomplete') || '')).toLowerCase();
  return /cvv|cvc|csc|cc-csc/i.test(name) || input.getAttribute('autocomplete') === 'cc-csc';
}

// --- Dropdown UI ---

function createDropdown(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'mushaffar-dropdown';
  el.setAttribute('style', `
    position: absolute;
    z-index: 2147483647;
    background: #1A1D27;
    border: 1px solid #2A2D3A;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    max-height: 280px;
    overflow-y: auto;
    min-width: 280px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `);
  return el;
}

function showCredentialDropdown(input: HTMLInputElement, credentials: PasswordModel[]) {
  removeDropdown();
  if (credentials.length === 0) return;

  dropdown = createDropdown();

  // Header
  const header = document.createElement('div');
  header.setAttribute('style', 'padding: 8px 12px; border-bottom: 1px solid #2A2D3A; display: flex; align-items: center; gap: 6px;');
  header.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4895EF" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
    <span style="font-size: 11px; color: #8E95A5; font-weight: 500;">Mushaffar</span>
  `;
  dropdown.appendChild(header);

  // Credential items
  credentials.forEach(cred => {
    const item = document.createElement('div');
    item.setAttribute('style', `
      padding: 10px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: background 0.15s;
    `);
    item.addEventListener('mouseenter', () => item.style.background = '#252833');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');

    const domain = cred.websiteUrl ? extractDomain(cred.websiteUrl) : '';
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';

    item.innerHTML = `
      <div style="width: 28px; height: 28px; border-radius: 6px; background: #252833; display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden;">
        ${faviconUrl ? `<img src="${faviconUrl}" width="18" height="18" style="border-radius: 2px;">` : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8E95A5" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`}
      </div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 13px; font-weight: 600; color: #EAEDF3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(cred.keyName)}</div>
        <div style="font-size: 11px; color: #8E95A5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(cred.email || '')}</div>
      </div>
    `;

    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fillCredential(input, cred);
      removeDropdown();
    });

    dropdown!.appendChild(item);
  });

  positionDropdown(input, dropdown);
  document.body.appendChild(dropdown);
}

function showCardDropdown(input: HTMLInputElement, cards: CardModel[]) {
  removeDropdown();
  if (cards.length === 0) return;

  dropdown = createDropdown();

  const header = document.createElement('div');
  header.setAttribute('style', 'padding: 8px 12px; border-bottom: 1px solid #2A2D3A; display: flex; align-items: center; gap: 6px;');
  header.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4895EF" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
    <span style="font-size: 11px; color: #8E95A5; font-weight: 500;">Mushaffar Cards</span>
  `;
  dropdown.appendChild(header);

  cards.forEach(card => {
    const item = document.createElement('div');
    item.setAttribute('style', `padding: 10px 12px; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: background 0.15s;`);
    item.addEventListener('mouseenter', () => item.style.background = '#252833');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');

    const last4 = card.cardNumber.replace(/\s/g, '').slice(-4);
    item.innerHTML = `
      <div style="width: 28px; height: 28px; border-radius: 6px; background: #252833; display: flex; align-items: center; justify-content: center;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8E95A5" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
      </div>
      <div style="flex: 1;">
        <div style="font-size: 13px; font-weight: 600; color: #EAEDF3;">${escapeHtml(card.cardName)}</div>
        <div style="font-size: 11px; color: #8E95A5; font-family: monospace;">•••• ${last4}</div>
      </div>
    `;

    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fillCard(input, card);
      removeDropdown();
    });

    dropdown!.appendChild(item);
  });

  positionDropdown(input, dropdown);
  document.body.appendChild(dropdown);
}

function positionDropdown(input: HTMLInputElement, el: HTMLElement) {
  const rect = input.getBoundingClientRect();
  el.style.top = `${rect.bottom + window.scrollY + 4}px`;
  el.style.left = `${rect.left + window.scrollX}px`;
  el.style.width = `${Math.max(rect.width, 280)}px`;
}

function removeDropdown() {
  if (dropdown) {
    dropdown.remove();
    dropdown = null;
  }
}

// --- Fill credentials ---

function fillCredential(input: HTMLInputElement, cred: PasswordModel) {
  const form = input.closest('form') || input.parentElement;
  if (!form) return;

  const inputs = form.querySelectorAll<HTMLInputElement>('input');
  inputs.forEach(inp => {
    if (isUsernameField(inp) && cred.email) {
      setInputValue(inp, cred.email);
    } else if (isPasswordField(inp)) {
      setInputValue(inp, cred.password);
    }
  });
}

function fillCard(input: HTMLInputElement, card: CardModel) {
  const form = input.closest('form') || document.body;
  const inputs = form.querySelectorAll<HTMLInputElement>('input');

  inputs.forEach(inp => {
    if (isCardNumberField(inp)) setInputValue(inp, card.cardNumber);
    else if (isCardNameField(inp)) setInputValue(inp, card.cardholderName);
    else if (isCardExpiryField(inp)) setInputValue(inp, card.expiryDate);
    else if (isCardCVVField(inp)) setInputValue(inp, card.cvv);
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }

  // Dispatch events so frameworks (React, Angular, Vue) detect the change
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// --- Event listeners ---

function handleFocus(e: FocusEvent) {
  const input = e.target as HTMLInputElement;
  if (!(input instanceof HTMLInputElement)) return;
  activeInput = input;

  // Reset auto-lock timer
  chrome.runtime.sendMessage({ type: 'resetAutoLock' });

  if (isUsernameField(input) || isPasswordField(input)) {
    chrome.runtime.sendMessage({ type: 'getMatches', url: window.location.href }, (matches: PasswordModel[]) => {
      if (matches && matches.length > 0) {
        matchedCredentials = matches;
        showCredentialDropdown(input, matches);
      }
    });
  } else if (isCardNumberField(input)) {
    chrome.runtime.sendMessage({ type: 'getAllCards' }, (cards: CardModel[]) => {
      if (cards && cards.length > 0) {
        matchedCards = cards;
        showCardDropdown(input, cards);
      }
    });
  }
}

// Close dropdown on click outside
document.addEventListener('click', (e) => {
  if (dropdown && !dropdown.contains(e.target as Node)) {
    removeDropdown();
  }
});

// Close dropdown on scroll
document.addEventListener('scroll', () => removeDropdown(), true);

// Close dropdown on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') removeDropdown();
});

// --- Save password detection ---

function handleFormSubmit(e: Event) {
  const form = e.target as HTMLFormElement;
  if (!(form instanceof HTMLFormElement)) return;

  const inputs = form.querySelectorAll<HTMLInputElement>('input');
  let username = '';
  let password = '';

  inputs.forEach(inp => {
    if (isUsernameField(inp) && inp.value) username = inp.value;
    if (isPasswordField(inp) && inp.value) password = inp.value;
  });

  if (username && password) {
    // Check if this is a new credential
    const alreadySaved = matchedCredentials.some(
      c => c.email === username && c.password === password
    );

    if (!alreadySaved) {
      showSaveBanner(username, password);
    }
  }
}

function showSaveBanner(username: string, password: string) {
  const banner = document.createElement('div');
  banner.id = 'mushaffar-save-banner';
  banner.setAttribute('style', `
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 2147483647;
    background: #1A1D27;
    border: 1px solid #2A2D3A;
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    width: 320px;
    animation: mushaffar-slide-in 0.3s ease;
  `);

  const domain = window.location.hostname;
  banner.innerHTML = `
    <style>
      @keyframes mushaffar-slide-in {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4895EF" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
      <span style="font-size: 13px; font-weight: 600; color: #EAEDF3;">Save password?</span>
    </div>
    <div style="font-size: 12px; color: #8E95A5; margin-bottom: 12px;">
      ${escapeHtml(username)} on ${escapeHtml(domain)}
    </div>
    <div style="display: flex; gap: 8px;">
      <button id="mushaffar-save-yes" style="flex: 1; padding: 8px; background: #4895EF; color: white; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">Save</button>
      <button id="mushaffar-save-no" style="flex: 1; padding: 8px; background: #252833; color: #8E95A5; border: 1px solid #2A2D3A; border-radius: 8px; font-size: 12px; cursor: pointer;">Not now</button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById('mushaffar-save-yes')?.addEventListener('click', () => {
    const newPassword: PasswordModel = {
      id: crypto.randomUUID(),
      keyName: domain,
      password: password,
      email: username,
      websiteUrl: window.location.origin,
      lastEditDate: new Date().toISOString(),
    };
    chrome.runtime.sendMessage({ type: 'savePassword', password: newPassword });
    // Upload to Drive
    chrome.runtime.sendMessage({ type: 'uploadVault' });
    banner.remove();
  });

  document.getElementById('mushaffar-save-no')?.addEventListener('click', () => {
    banner.remove();
  });

  // Auto-dismiss after 15 seconds
  setTimeout(() => banner.remove(), 15000);
}

// --- Helpers ---

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

// --- Initialize ---

// Listen for focus events on inputs
document.addEventListener('focusin', handleFocus, true);

// Listen for form submissions
document.addEventListener('submit', handleFormSubmit, true);

// Also observe dynamically added forms/inputs
const observer = new MutationObserver(() => {
  // Re-attach is not needed since we use event delegation on document
});
observer.observe(document.body, { childList: true, subtree: true });

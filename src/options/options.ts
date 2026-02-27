const autoLockInput = document.getElementById('auto-lock-minutes') as HTMLInputElement;
const showAutofillInput = document.getElementById('show-autofill') as HTMLInputElement;
const savePromptsInput = document.getElementById('save-prompts') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn')!;
const savedMsg = document.getElementById('saved-msg')!;

// Load saved settings
chrome.storage.local.get(['autoLockMinutes', 'showAutofill', 'savePrompts'], (result) => {
  if (result.autoLockMinutes) autoLockInput.value = String(result.autoLockMinutes);
  if (result.showAutofill !== undefined) showAutofillInput.checked = result.showAutofill;
  if (result.savePrompts !== undefined) savePromptsInput.checked = result.savePrompts;
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    autoLockMinutes: parseInt(autoLockInput.value) || 5,
    showAutofill: showAutofillInput.checked,
    savePrompts: savePromptsInput.checked,
  }, () => {
    savedMsg.style.display = 'inline';
    setTimeout(() => savedMsg.style.display = 'none', 2000);
  });
});

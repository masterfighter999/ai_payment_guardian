document.addEventListener('DOMContentLoaded', () => {
  const enableToggle = document.getElementById('enableToggle');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveBtn = document.getElementById('saveBtn');
  const statusMsg = document.getElementById('statusMsg');

  // Load existing settings
  chrome.storage.local.get(['aipg_enabled', 'aipg_api_key'], (result) => {
    if (result.aipg_enabled !== undefined) {
      enableToggle.checked = result.aipg_enabled;
    }
    if (result.aipg_api_key) {
      apiKeyInput.value = result.aipg_api_key;
    }
  });

  // Handle toggle change
  enableToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ aipg_enabled: e.target.checked });
  });

  // Handle API key save
  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus('Please enter an API key', 'error');
      return;
    }

    chrome.storage.local.set({ aipg_api_key: key }, () => {
      showStatus('API Key saved successfully', 'success');
      setTimeout(() => {
        statusMsg.textContent = '';
      }, 3000);
    });
  });

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status-msg ${type}`;
  }
});

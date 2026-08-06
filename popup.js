document.addEventListener('DOMContentLoaded', () => {
    const patInput = document.getElementById('pat-input');
    const saveBtn = document.getElementById('save-btn');
    const statusMsg = document.getElementById('status-msg');

    // Load saved settings
    chrome.storage.local.get(['githubPat'], (result) => {
        if (result.githubPat) {
            patInput.value = result.githubPat;
            showStatus('Token loaded.', 'success');
        }
    });

    // Save settings
    saveBtn.addEventListener('click', () => {
        const token = patInput.value.trim();
        if (!token) {
            showStatus('Please enter a valid token.', 'error');
            return;
        }

        chrome.storage.local.set({ githubPat: token }, () => {
             // Verify if it was saved (optional, but good for feedback)
             if (chrome.runtime.lastError) {
                 showStatus('Error saving token.', 'error');
                 return;
             }
             showStatus('Token saved securely!', 'success');
             setTimeout(() => {
                 statusMsg.textContent = '';
                 statusMsg.className = 'status';
             }, 2000);
        });
    });

    function showStatus(message, type) {
        statusMsg.textContent = message;
        statusMsg.className = `status ${type}`;
    }
});

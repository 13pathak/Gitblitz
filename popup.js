document.addEventListener('DOMContentLoaded', () => {
    const patInput = document.getElementById('pat-input');
    const saveBtn = document.getElementById('save-btn');
    const statusMsg = document.getElementById('status-msg');
    const clearBtn = document.getElementById('clear-btn');
    const usernameDisplay = document.getElementById('username-display');
    const cloneUrlRadios = document.querySelectorAll('input[name="clone-url"]');

    // Load saved settings
    chrome.storage.local.get(['githubPat', 'githubUsername', 'cloneUrlPreference'], (result) => {
        if (result.githubPat) {
            patInput.value = result.githubPat;
            if (result.githubUsername) {
                showUsername(result.githubUsername);
            }
            showStatus('Token loaded.', 'success');
        }
        if (result.cloneUrlPreference) {
            cloneUrlRadios.forEach(radio => {
                if (radio.value === result.cloneUrlPreference) {
                    radio.checked = true;
                }
            });
        }
    });

    // Save settings with validation
    saveBtn.addEventListener('click', async () => {
        const token = patInput.value.trim();
        if (!token) {
            showStatus('Please enter a valid token.', 'error');
            return;
        }

        // Validate token before saving
        saveBtn.disabled = true;
        saveBtn.textContent = 'Validating...';
        showStatus('Validating token...', 'info');

        try {
            const isValid = await validateToken(token);
            if (isValid.valid) {
                chrome.storage.local.set({ 
                    githubPat: token,
                    githubUsername: isValid.username 
                }, () => {
                    if (chrome.runtime.lastError) {
                        showStatus('Error saving token.', 'error');
                        resetSaveButton();
                        return;
                    }
                    showUsername(isValid.username);
                    showStatus('Token saved successfully!', 'success');
                    resetSaveButton();
                    setTimeout(() => {
                        statusMsg.textContent = '';
                        statusMsg.className = 'status';
                    }, 3000);
                });
            } else {
                showStatus('Invalid token. Please check your token.', 'error');
                resetSaveButton();
            }
        } catch (err) {
            showStatus('Validation failed. Check your network.', 'error');
            resetSaveButton();
        }
    });

    // Clear token
    clearBtn.addEventListener('click', () => {
        chrome.storage.local.remove(['githubPat', 'githubUsername'], () => {
            patInput.value = '';
            hideUsername();
            showStatus('Token cleared.', 'success');
        });
    });

    // Save clone URL preference on change
    cloneUrlRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const selected = document.querySelector('input[name="clone-url"]:checked').value;
            chrome.storage.local.set({ cloneUrlPreference: selected });
        });
    });

    function validateToken(token) {
        return fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        })
        .then(res => {
            if (res.ok) {
                return res.json().then(data => ({ valid: true, username: data.login }));
            }
            return { valid: false };
        })
        .catch(() => ({ valid: false }));
    }

    function resetSaveButton() {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Token';
    }

    function showUsername(username) {
        usernameDisplay.textContent = `Authenticated as: ${username}`;
        usernameDisplay.style.display = 'block';
    }

    function hideUsername() {
        usernameDisplay.textContent = '';
        usernameDisplay.style.display = 'none';
    }

    function showStatus(message, type) {
        statusMsg.textContent = message;
        statusMsg.className = `status ${type}`;
    }
});

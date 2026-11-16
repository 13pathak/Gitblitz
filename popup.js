document.addEventListener('DOMContentLoaded', () => {
    const patInput = document.getElementById('pat-input');
    const saveBtn = document.getElementById('save-btn');
    const statusMsg = document.getElementById('status-msg');
    const clearBtn = document.getElementById('clear-btn');
    const usernameDisplay = document.getElementById('username-display');
    const cloneUrlRadios = document.querySelectorAll('input[name="clone-url"]');
    const clearHistoryBtn = document.getElementById('clear-history');
    const forkHistoryList = document.getElementById('fork-history');

    // Load saved settings
    chrome.storage.local.get(['githubPat', 'githubUsername', 'cloneUrlPreference', 'forkHistory', 'workflowOptions'], (result) => {
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
        displayForkHistory(result.forkHistory || []);
        const defaultsForm = GitBlitzForms.create({
            id: 'gitblitz-defaults', values: result.workflowOptions,
            onSubmit: values => new Promise((resolve, reject) => {
                // Fork names and destinations are always chosen per repository.
                chrome.storage.local.set({ workflowOptions: { ...values, forkName: '', organization: '' } }, () => {
                    if (chrome.runtime.lastError) reject(new Error('Could not save command defaults. Try again.'));
                    else resolve();
                });
            })
        });
        document.getElementById('workflow-defaults').appendChild(defaultsForm);
    });

    // Save settings with validation
    document.getElementById('token-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        if (saveBtn.disabled) return;
        const token = patInput.value.trim();
        if (!token) {
            showStatus('Please enter a valid token.', 'error');
            return;
        }

        // Validate token before saving
        saveBtn.disabled = true;
        clearBtn.disabled = true;
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
                });
            } else {
                showStatus('Invalid token. Please check your token.', 'error');
                resetSaveButton();
            }
        } catch (err) {
            showStatus(err.message || 'Validation failed. Check your network.', 'error');
            resetSaveButton();
        }
    });

    // Clear token
    clearBtn.addEventListener('click', () => {
        chrome.storage.local.remove(['githubPat', 'githubUsername'], () => {
            if (chrome.runtime.lastError) {
                showStatus('Could not clear the token. Please try again.', 'error');
                return;
            }
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

    // Clear fork history
    clearHistoryBtn.addEventListener('click', () => {
        chrome.storage.local.set({ forkHistory: [] }, () => {
            if (chrome.runtime.lastError) {
                showStatus('Could not clear history. Please try again.', 'error');
                return;
            }
            displayForkHistory([]);
        });
    });

    async function validateToken(token) {
        let response;
        try {
            response = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json'
                },
                signal: AbortSignal.timeout(15000)
            });
        } catch {
            throw new Error('Could not reach GitHub. Check your connection and try again.');
        }
        if (response.status === 401) return { valid: false };
        if (response.status === 403 || response.status === 429) {
            throw new Error('GitHub denied validation. Check token access or wait if you have reached an API rate limit.');
        }
        if (!response.ok) throw new Error(`GitHub could not validate the token (${response.status}). Try again later.`);
        const user = await response.json();
        return { valid: true, username: user.login };
    }

    function resetSaveButton() {
        saveBtn.disabled = false;
        clearBtn.disabled = false;
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

    function displayForkHistory(history) {
        forkHistoryList.replaceChildren();
        if (!history || history.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty-history';
            empty.textContent = 'No recent forks';
            forkHistoryList.appendChild(empty);
            return;
        }

        for (const entry of history) {
            const item = document.createElement('div');
            item.className = 'history-item';
            const names = document.createElement('div');
            names.className = 'repo-name';
            for (const name of [entry.forkRepo, entry.originalRepo]) {
                const link = document.createElement('a');
                link.href = `https://github.com/${name.split('/').map(encodeURIComponent).join('/')}`;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = name;
                if (names.childElementCount) names.append(' ← ');
                names.appendChild(link);
            }
            const timestamp = document.createElement('span');
            timestamp.className = 'timestamp';
            timestamp.textContent = formatTimeAgo(new Date(entry.timestamp));
            item.append(names, timestamp);
            forkHistoryList.appendChild(item);
        }
    }

    function formatTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);

        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
        return date.toLocaleDateString();
    }

    function showStatus(message, type) {
        statusMsg.textContent = message;
        statusMsg.className = `status ${type}`;
    }
});

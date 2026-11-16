// GitHub uses Turbo (formerly Turbolinks), so we need to observe page changes
// and re-inject the button if it disappears.

const BUTTON_ID = 'gitblitz-fix-btn';

function injectButton() {
    // 1. Check if we are on a repository page (contains /owner/repo)
    // Avoids injecting on profile pages or dashboard
    const pathParts = window.location.pathname.split('/').filter(p => p);
    if (pathParts.length < 2) return;

    // 2. Do not inject if already exists
    if (document.getElementById(BUTTON_ID)) return;

    // 3. Find the action bar (Star, Fork, Watch buttons)
    // GitHub's structure varies, usually it's .pagehead-actions or #repository-details-container ul
    // We'll target the main action list.
    const actionList = document.querySelector('.pagehead-actions') ||
        document.querySelector('ul.pagehead-actions');

    if (!actionList) {
        // Maybe it's not loaded yet, or strictly not a repo header
        return;
    }

    // 4. Create the button li wrapper
    const li = document.createElement('li');
    li.id = BUTTON_ID;
    li.className = 'tooltipped tooltipped-s';
    li.setAttribute('aria-label', 'Fork & Clone with GitBlitz');

    // 5. Create the actual button
    const btn = document.createElement('button');
    btn.className = 'gitblitz-btn btn-sm btn'; // Mix of my class + GitHub classes
    btn.innerHTML = `
        <span style="margin-right: 4px;">⚡</span> Fix This Repo
    `;

    // 6. Handle Click
    btn.addEventListener('click', async (e) => {
        e.preventDefault();

        // Provide immediate visual feedback
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span class="AnimatedEllipsis">Working</span>`;
        btn.disabled = true;

        // Send message to background
        try {
            chrome.runtime.sendMessage({
                action: 'ACTION_FIX_REPO',
                owner: pathParts[0],
                repo: pathParts[1]
            }, (response) => {
                // Handle response
                if (chrome.runtime.lastError) {
                    alert(`GitBlitz Error: ${chrome.runtime.lastError.message}\n\nPlease check if the extension is properly loaded.`);
                    resetButton(btn, originalText);
                    return;
                }

                if (response && response.success) {
                    // Copy to clipboard
                    const cloneUrl = response.cloneUrl;
                    const cloneCommand = `git clone ${cloneUrl}`;
                    copyToClipboard(cloneUrl)
                        .then(() => {
                            btn.innerHTML = `✅ Copied!`;
                            // Show success notification
                            showNotification(`Copied: ${cloneCommand}`);
                            // Reset after 3 seconds
                            setTimeout(() => resetButton(btn, originalText), 3000);
                        })
                        .catch((err) => {
                            console.error('Clipboard failed', err);
                            btn.innerHTML = `⚠️ Copy Failed`;
                            prompt("Manual Copy - Press Ctrl+C then Enter:", cloneCommand);
                            setTimeout(() => resetButton(btn, originalText), 3000);
                        });
                } else {
                    const msg = response ? response.error : 'Unknown error';
                    // Provide helpful error messages
                    let helpfulMsg = msg;
                    if (msg.includes('Token')) {
                        helpfulMsg = `${msg}\n\nPlease open the GitBlitz extension popup and set your GitHub token.`;
                    } else if (msg.includes('rate limit')) {
                        helpfulMsg = `${msg}\n\nPlease wait a few minutes before trying again.`;
                    }
                    alert(`GitBlitz Failed: ${helpfulMsg}`);
                    resetButton(btn, originalText);
                }
            });
        } catch (err) {
            console.error(err);
            alert(`GitBlitz Error: An unexpected error occurred.\n\n${err.message}`);
            resetButton(btn, originalText);
        }
    });

    li.appendChild(btn);
    // Prepend or append? Usually Fork is last. Let's put it first for visibility.
    actionList.insertBefore(li, actionList.firstChild);
}

function resetButton(btn, html) {
    btn.innerHTML = html;
    btn.disabled = false;
}

function showNotification(message) {
    // Create a temporary notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #238636;
        color: white;
        padding: 12px 16px;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Modern Clipboard API - requires 'clipboardWrite' permission and secure context (HTTPS)
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(`git clone ${text}`);
        // Also verify if we need to open Antigravity?
        // For now just copy.
    } catch (err) {
        throw err;
    }
}

// Observer for SPA navigation
const observer = new MutationObserver((mutations) => {
    // Debounce or just check?
    injectButton();
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Initial run
injectButton();

const BUTTON_ID = 'gitblitz-fix-btn';
const BUTTON_LABEL = 'Fork & Copy Clone Command';
let working = false;
let scheduledInjection = false;
let lastAnnouncement = '';

chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === 'TRIGGER_FIX_REPO') {
        document.getElementById(BUTTON_ID)?.click();
    }
});

function repositoryContext() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    try {
        const [owner, repo] = parts.slice(0, 2).map(decodeURIComponent);
        if (!/^[\w-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
        const path = ['tree', 'blob'].includes(parts[2])
            ? decodeURIComponent(parts.slice(3).join('/')) : '';
        const selector = document.querySelector('[data-menu-button="branch-switcher"]') ||
            document.querySelector('#ref-picker-repos-header-ref-selector [data-component="text"]') ||
            document.querySelector('#branch-picker-repos-header-ref-selector [data-component="text"]');
        const name = selector?.textContent.trim() || '';
        return { owner, repo, ref: { path, name: name === 'Switch branches or tags' ? '' : name } };
    } catch {
        return null;
    }
}

function findActionList() {
    return document.querySelector('[data-testid="repo-header-actions"]') ||
        document.querySelector('.pagehead-actions');
}

function injectButton() {
    if (!repositoryContext() || document.getElementById(BUTTON_ID)) return;
    const actionList = findActionList();
    if (!actionList) return;

    const item = document.createElement('li');
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'gitblitz-btn btn-sm btn';
    button.textContent = BUTTON_LABEL;
    button.setAttribute('aria-disabled', String(working));
    button.addEventListener('click', handleClick);
    item.appendChild(button);
    actionList.insertBefore(item, actionList.firstChild);
    ensureFeedback(actionList);
}

function ensureFeedback(actionList = findActionList()) {
    let panel = document.getElementById('gitblitz-feedback');
    if (panel) return panel;
    if (!actionList) return null;

    panel = document.createElement('div');
    panel.id = 'gitblitz-feedback';
    panel.className = 'gitblitz-feedback';
    const status = document.createElement('p');
    status.id = 'gitblitz-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-atomic', 'true');
    panel.appendChild(status);
    const details = document.createElement('div');
    details.id = 'gitblitz-details';
    panel.appendChild(details);
    // The current React header wraps its actions; put feedback on its own row.
    const anchor = actionList.matches('[data-testid="repo-header-actions"]')
        ? actionList.parentElement : actionList;
    anchor.insertAdjacentElement('afterend', panel);
    return panel;
}

function showFeedback(message, type = 'success', command = '') {
    const panel = ensureFeedback();
    if (!panel) return;
    panel.dataset.type = type;
    panel.classList.add('gitblitz-feedback-visible');
    const status = panel.querySelector('#gitblitz-status');
    // Repeated identical messages still need to be announced by screen readers.
    const announcement = message === lastAnnouncement ? `${message}\u00a0` : message;
    status.textContent = announcement;
    lastAnnouncement = announcement;
    const details = panel.querySelector('#gitblitz-details');
    details.replaceChildren();
    if (command) {
        const label = document.createElement('label');
        label.htmlFor = 'gitblitz-command';
        label.textContent = 'Clone command';
        const field = document.createElement('textarea');
        field.id = 'gitblitz-command';
        field.className = 'gitblitz-command';
        field.readOnly = true;
        field.rows = 2;
        field.value = command;
        field.addEventListener('focus', () => field.select());
        details.append(label, field);
    }
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'gitblitz-dismiss';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => {
        document.getElementById(BUTTON_ID)?.focus();
        panel.classList.remove('gitblitz-feedback-visible');
        status.textContent = '';
        details.replaceChildren();
    });
    details.appendChild(dismiss);
}

function buildCloneCommand(cloneUrl, branch) {
    if (typeof cloneUrl !== 'string' || !/^(https:\/\/github\.com\/|git@github\.com:)[\w.-]+\/[\w.-]+\.git$/.test(cloneUrl)) {
        throw new Error('GitHub returned an unexpected clone URL. Open your fork on GitHub and copy its URL.');
    }
    // Keep copied commands safe in PowerShell, cmd.exe and POSIX shells.
    // Unusual shell metacharacters must never become executable pasted input.
    if (branch && !/^[\p{L}\p{N}._\/-]+$/u.test(branch)) {
        throw new Error('This branch name contains shell-special characters. Copy its clone command from GitHub and quote the branch for your terminal.');
    }
    return `git clone${branch ? ` --branch ${branch}` : ''} -- ${cloneUrl}`;
}

async function handleClick(event) {
    event.preventDefault();
    if (working) return;
    // Capture repository and ref together before any asynchronous work or navigation.
    const context = repositoryContext();
    if (!context) return;
    const pagePath = window.location.pathname;
    working = true;
    const button = event.currentTarget;
    button.textContent = 'Preparing repository…';
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    try {
        const response = await chrome.runtime.sendMessage({ action: 'ACTION_FIX_REPO', ...context });
        if (!response?.success) throw new Error(response?.error || 'GitBlitz did not receive a response. Reload this page and try again.');
        if (window.location.pathname !== pagePath) return;
        const command = buildCloneCommand(response.cloneUrl, response.branch);
        try {
            await navigator.clipboard.writeText(command);
            showFeedback('Clone command copied.', 'success', command);
        } catch {
            showFeedback('Clipboard access failed. Select the command below and copy it manually.', 'error', command);
        }
    } catch (error) {
        if (window.location.pathname === pagePath) {
            showFeedback(error.message || 'GitBlitz could not prepare this repository. Reload the page and try again.', 'error');
        }
    } finally {
        working = false;
        for (const target of new Set([button, document.getElementById(BUTTON_ID)])) {
            if (!target) continue;
            target.textContent = BUTTON_LABEL;
            target.setAttribute('aria-disabled', 'false');
            target.removeAttribute('aria-busy');
        }
    }
}

// GitHub replaces its header during navigation. Batch mutation checks per frame.
const observer = new MutationObserver(() => {
    if (scheduledInjection) return;
    scheduledInjection = true;
    requestAnimationFrame(() => {
        scheduledInjection = false;
        injectButton();
    });
});
observer.observe(document.body, { childList: true, subtree: true });
injectButton();

const BUTTON_ID = 'gitblitz-fix-btn';
const BUTTON_LABEL = 'Fork & Copy Command';
let working = false;
let scheduledInjection = false;
let lastAnnouncement = '';
let optionsRepository = '';
let pageOptions;

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
    const context = repositoryContext();
    if (!context) return;
    const key = `${context.owner}/${context.repo}`.toLowerCase();
    if (optionsRepository !== key) {
        optionsRepository = key;
        pageOptions = undefined;
        document.getElementById('gitblitz-options')?.remove();
        document.getElementById('gitblitz-feedback')?.remove();
        document.getElementById('gitblitz-options-toggle')?.setAttribute('aria-expanded', 'false');
    }
    if (document.getElementById(BUTTON_ID)) return;
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
    const optionsButton = document.createElement('button');
    optionsButton.id = 'gitblitz-options-toggle';
    optionsButton.type = 'button';
    optionsButton.className = 'gitblitz-secondary btn-sm btn';
    optionsButton.textContent = 'GitBlitz options';
    optionsButton.setAttribute('aria-expanded', 'false');
    optionsButton.setAttribute('aria-controls', 'gitblitz-options');
    optionsButton.addEventListener('click', toggleOptions);
    item.appendChild(optionsButton);
    actionList.insertBefore(item, actionList.firstChild);
    ensureFeedback(actionList);
}

async function toggleOptions() {
    injectButton();
    const toggle = document.getElementById('gitblitz-options-toggle');
    let panel = document.getElementById('gitblitz-options');
    if (!panel) {
        const context = repositoryContext();
        const key = `${context.owner}/${context.repo}`.toLowerCase();
        toggle.disabled = true;
        try {
            const response = await chrome.runtime.sendMessage({ action: 'GET_WORKFLOW_OPTIONS' });
            if (!response?.success) throw new Error(response?.error || 'Could not load options.');
            const current = repositoryContext();
            if (key !== `${current?.owner}/${current?.repo}`.toLowerCase()) return;
            panel = document.createElement('div');
            panel.id = 'gitblitz-options';
            panel.className = 'gitblitz-options-panel';
            panel.appendChild(GitBlitzForms.create({
                id: 'gitblitz-recipe', values: pageOptions || response.options,
                repositoryOptions: true, submitLabel: 'Prepare & copy command',
                onSubmit: async values => {
                    const current = repositoryContext();
                    if (key !== `${current?.owner}/${current?.repo}`.toLowerCase()) throw new Error('The repository changed. Reopen GitBlitz options.');
                    pageOptions = values;
                    await prepareRepository(document.getElementById(BUTTON_ID), values);
                }
            }));
            ensureFeedback().insertAdjacentElement('beforebegin', panel);
        } catch (error) {
            showFeedback(error.message, 'error');
            return;
        } finally {
            toggle.disabled = false;
        }
    } else {
        panel.hidden = !panel.hidden;
    }
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
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
        label.textContent = 'Terminal command';
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

function buildCloneCommand(cloneUrl, branch, options = {}) {
    return GitBlitz.buildCommand({ cloneUrl, branch }, options);
}

function addResultActions(recipe) {
    const pagePath = window.location.pathname;
    const details = document.getElementById('gitblitz-details');
    if (!details) return;
    const actions = document.createElement('div');
    actions.className = 'gitblitz-result-actions';
    const editor = document.createElement('a');
    editor.id = 'gitblitz-vscode';
    editor.className = 'gitblitz-secondary';
    editor.href = GitBlitz.vscodeUrl(recipe.cloneUrl, recipe.branch);
    editor.textContent = 'Clone in VS Code';
    actions.appendChild(editor);
    const note = document.createElement('p');
    note.className = 'gitblitz-hint';
    note.textContent = 'VS Code asks where to clone. Use the terminal command for contribution setup and history presets.';
    details.append(actions, note);
    if (!recipe.isFork || !recipe.fullName || !recipe.syncBranch) return;
    const section = document.createElement('div');
    section.className = 'gitblitz-sync';
    const status = document.createElement('p');
    status.id = 'gitblitz-sync-status';
    status.setAttribute('role', 'status');
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'gitblitz-secondary';
    check.textContent = 'Refresh fork status';
    const sync = document.createElement('button');
    sync.type = 'button';
    sync.id = 'gitblitz-sync';
    sync.className = 'gitblitz-secondary';
    sync.hidden = true;
    let pending = false;
    const update = async (mutate = false) => {
        if (pending || window.location.pathname !== pagePath) return;
        pending = true;
        check.disabled = true;
        sync.disabled = true;
        try {
            const result = await chrome.runtime.sendMessage({ action: mutate ? 'SYNC_FORK' : 'CHECK_FORK_STATUS', fullName: recipe.fullName, branch: recipe.syncBranch });
            if (!section.isConnected) return;
            if (!result?.success) throw new Error(result?.error || 'Could not check fork status.');
            status.textContent = `${result.synced ? 'Sync finished. ' : ''}${recipe.fullName} · ${recipe.syncBranch}: ${result.behind} behind, ${result.ahead} ahead of ${result.upstream}.`;
            sync.hidden = !(result.canSync && result.behind > 0 && result.ahead === 0);
            sync.textContent = `Sync ${recipe.fullName} · ${recipe.syncBranch}`;
            if (result.ahead > 0 && result.behind > 0) status.textContent += ' Review the diverged branches on GitHub before merging.';
            else if (!result.canSync && result.behind > 0) status.textContent += ' Write access is required to sync.';
        } catch (error) {
            status.textContent = error.message;
            sync.hidden = true;
        } finally {
            pending = false;
            check.disabled = false;
            sync.disabled = false;
        }
    };
    check.addEventListener('click', () => update());
    sync.addEventListener('click', () => update(true));
    section.append(status, check, sync);
    details.appendChild(section);
    void update();
}

async function handleClick(event) {
    event.preventDefault();
    if (working) return;
    injectButton();
    const form = document.getElementById('gitblitz-recipe');
    let overrides = pageOptions;
    if (form && !form.parentElement.hidden) {
        overrides = GitBlitzForms.read(form);
        if (!overrides) return;
        pageOptions = overrides;
    }
    await prepareRepository(event.currentTarget, overrides);
}

async function prepareRepository(button, options) {
    if (working) return;
    // Capture repository and ref together before any asynchronous work or navigation.
    const context = repositoryContext();
    if (!context) return;
    const pagePath = window.location.pathname;
    working = true;
    button.textContent = 'Preparing repository…';
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    try {
        const response = await chrome.runtime.sendMessage({ action: 'ACTION_FIX_REPO', ...context, options });
        if (!response?.success) throw new Error(response?.error || 'GitBlitz did not receive a response. Reload this page and try again.');
        if (window.location.pathname !== pagePath) return;
        const command = response.command || buildCloneCommand(response.cloneUrl, response.branch);
        try {
            await navigator.clipboard.writeText(command);
            showFeedback(response.options?.mode === 'contribute' ? 'Contribution setup command copied.' : 'Clone command copied.', 'success', command);
        } catch {
            showFeedback('Clipboard access failed. Select the command below and copy it manually.', 'error', command);
        }
        addResultActions(response);
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

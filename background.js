chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === 'ACTION_FIX_REPO') {
        handleFixRepo(message.owner, message.repo, message.ref)
            .then(data => sendResponse({ success: true, ...data }))
            .catch(err => sendResponse({ success: false, error: err.message }));

        return true; // Keep channel open for async
    }
});

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'fix-repo') return;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url?.startsWith('https://github.com/')) {
            await chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_FIX_REPO' });
        }
    } catch {
        // A tab opened before installation may not have a content script yet.
    }
});

function checkRateLimit(response) {
    // The final successful request may legitimately consume the remaining quota.
    if (response.status !== 403 && response.status !== 429) return;
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
        throw new Error(`GitHub API rate limit reached. Retry after ${retryAfter} seconds.`);
    }
    if (remaining === '0') {
        const resetTime = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : null;
        throw new Error(`GitHub API rate limit reached.${resetTime ? ` Retry after ${resetTime}.` : ' Please try again later.'}`);
    }
    if (response.status === 429) throw new Error('GitHub API rate limit reached. Please try again later.');
}

async function githubRequest(path, headers, { method = 'GET', body, allowMissing = false } = {}) {
    let response;
    try {
        response = await fetch(`https://api.github.com${path}`, {
            method,
            headers,
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15000)
        });
    } catch (error) {
        throw new Error(error.name === 'TimeoutError'
            ? 'GitHub took too long to respond. Please try again.'
            : 'Could not reach GitHub. Check your connection and try again.');
    }
    checkRateLimit(response);
    if (allowMissing && response.status === 404) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('GitHub token is invalid or expired. Update it in the GitBlitz popup.');
        }
        if (/rate limit/i.test(data.message || '')) {
            throw new Error('GitHub API rate limit reached. Wait at least a minute before trying again.');
        }
        const detail = data.message || response.statusText || 'Request failed';
        const hint = response.status === 403 || response.status === 404
            ? ' Check the token’s repository access and your organization’s fork policy.' : '';
        throw new Error(`GitHub: ${detail} (${response.status}).${hint}`);
    }
    return data;
}

function repositoryPath(fullName) {
    return `/repos/${fullName.split('/').map(encodeURIComponent).join('/')}`;
}

function sameForkNetwork(candidate, upstream) {
    const sourceId = upstream.source?.id || upstream.id;
    return Boolean(sourceId && (candidate.id === sourceId ||
        (candidate.fork && (candidate.source?.id === sourceId || candidate.parent?.id === upstream.id))));
}

async function handleFixRepo(owner, repo, ref = {}) {
    if (typeof owner !== 'string' || !/^[\w-]+$/.test(owner) ||
        typeof repo !== 'string' || !/^[\w.-]+$/.test(repo) || repo === '.' || repo === '..') {
        throw new Error('Open a GitHub repository and try again.');
    }
    const storage = await chrome.storage.local.get(['githubPat', 'cloneUrlPreference']);
    const token = storage.githubPat;
    const useSsh = storage.cloneUrlPreference === 'ssh';
    if (!token) {
        throw new Error('No GitHub token found. Open the GitBlitz popup to save a token.');
    }
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
    const user = await githubRequest('/user', headers);
    const upstream = await githubRequest(repositoryPath(`${owner}/${repo}`), headers);
    const branch = await resolveBranch(upstream, ref, headers);
    let target = upstream;
    if (upstream.owner.login.toLowerCase() !== user.login.toLowerCase()) {
        target = await githubRequest(repositoryPath(`${user.login}/${upstream.name}`), headers, { allowMissing: true });
        if (target && !sameForkNetwork(target, upstream)) {
            throw new Error(`${target.full_name} already exists and is unrelated to ${upstream.full_name}. Rename that repository or create a differently named fork on GitHub, then open your fork.`);
        }
        if (!target) target = await createFork(upstream, headers, branch);
    }
    if (branch && target.id !== upstream.id) {
        const targetBranch = await githubRequest(`${repositoryPath(target.full_name)}/branches/${encodeURIComponent(branch)}`, headers, { allowMissing: true });
        if (!targetBranch) {
            throw new Error(`The branch "${branch}" is missing from ${target.full_name}. Sync that branch to your fork, then try again.`);
        }
    }
    return { cloneUrl: useSsh ? target.ssh_url : target.clone_url, branch };
}

async function resolveBranch(upstream, ref, headers) {
    const name = typeof ref?.name === 'string' ? ref.name : '';
    const path = typeof ref?.path === 'string' ? ref.path : '';
    if (!name && !path) return null;
    if (name.length > 1024 || path.length > 2048) throw new Error('Open the branch root and try again.');
    const candidates = [];
    if (name && (!path || path === name || path.startsWith(`${name}/`))) candidates.push(name);
    // A tree/blob URL can contain both a slash-containing branch and a file path.
    // Verify full prefixes, rather than assuming the first segment is the branch.
    for (let candidate = path; candidate; candidate = candidate.includes('/') ? candidate.slice(0, candidate.lastIndexOf('/')) : '') {
        candidates.push(candidate);
    }
    if (candidates.length > 32) throw new Error('Open the branch root and try again.');
    for (const candidate of new Set(candidates)) {
        const branch = await githubRequest(`${repositoryPath(upstream.full_name)}/branches/${encodeURIComponent(candidate)}`, headers, { allowMissing: true });
        if (branch) return branch.name;
    }
    throw new Error('Could not identify a branch on this page. Select a branch on the repository’s Code tab and try again.');
}

async function createFork(upstream, headers, branch = null) {
    const fork = await githubRequest(`${repositoryPath(upstream.full_name)}/forks`, headers, {
        method: 'POST',
        body: { default_branch_only: false }
    });
    if (!fork.full_name) throw new Error('GitHub did not return the fork location. Please try again.');
    const readyFork = await pollForFork(fork.full_name, upstream, headers, branch);
    // A history storage failure must not turn a successful fork into an API error.
    try {
        await addToForkHistory(upstream.full_name, readyFork.full_name);
    } catch {
        // The clone command is still available when local history cannot be saved.
    }
    return readyFork;
}

async function addToForkHistory(originalRepo, forkRepo) {
    const storage = await chrome.storage.local.get(['forkHistory']);
    const history = storage.forkHistory || [];

    const newEntry = {
        originalRepo,
        forkRepo,
        timestamp: Date.now()
    };

    // Add to beginning of array and keep only last 20 entries
    history.unshift(newEntry);
    const trimmedHistory = history.slice(0, 20);

    await chrome.storage.local.set({ forkHistory: trimmedHistory });
}

async function pollForFork(fullName, upstream, headers, requestedBranch = null) {
    for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const fork = await githubRequest(repositoryPath(fullName), headers, { allowMissing: true });
        if (!fork) continue;
        if (!sameForkNetwork(fork, upstream)) throw new Error('GitHub returned a repository from a different fork network.');
        // Repository metadata can appear before its Git objects are available.
        if (upstream.size > 0) {
            const branch = await githubRequest(`${repositoryPath(fullName)}/branches/${encodeURIComponent(requestedBranch || fork.default_branch)}`, headers, { allowMissing: true });
            if (!branch) continue;
        }
        return fork;
    }
    throw new Error(`GitHub is still preparing ${fullName}. Wait a moment and try again; your fork may already have been created.`);
}

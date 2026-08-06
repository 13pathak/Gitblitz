// Background Worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ACTION_FIX_REPO') {
        handleFixRepo(message.owner, message.repo)
            .then(data => sendResponse({ success: true, cloneUrl: data }))
            .catch(err => sendResponse({ success: false, error: err.message }));

        return true; // Keep channel open for async
    }
});

async function handleFixRepo(owner, repo) {
    // 1. Get Token
    const storage = await chrome.storage.local.get(['githubPat']);
    const token = storage.githubPat;

    if (!token) {
        throw new Error('No GitHub Token found. Please set one in the extension popup.');
    }

    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    };

    // 2. Get Authenticated User Info (to know who WE are)
    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) throw new Error('Failed to fetch user info. Check token.');
    const user = await userRes.json();
    const myUsername = user.login;

    // 3. Logic:
    // A. Check if we already have a fork OR if the repo is already ours.
    // Use GET /repos/{user}/{repo}
    // If 200 -> It exists. Return URL.
    // If 404 -> It doesn't exist. Fork it.

    if (owner === myUsername) {
        // We are on our own repo. Just return the clone URL.
        // We need to fetch repo details to be sure we get the correct clone URL.
        return getCloneUrl(owner, repo, headers);
    }

    const checkRes = await fetch(`https://api.github.com/repos/${myUsername}/${repo}`, { headers });

    if (checkRes.ok) {
        // Fork exists!
        const forkData = await checkRes.json();
        return forkData.clone_url || forkData.ssh_url;
    } else if (checkRes.status === 404) {
        // Fork does not exist. Create it.
        return await createFork(owner, repo, headers, myUsername);
    } else {
        throw new Error(`Error checking for fork: ${checkRes.status}`);
    }
}

async function getCloneUrl(owner, repo, headers) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!res.ok) throw new Error('Failed to get repo details');
    const data = await res.json();
    return data.clone_url;
}

async function createFork(owner, repo, headers, myUsername) {
    const forkUrl = `https://api.github.com/repos/${owner}/${repo}/forks`;
    const res = await fetch(forkUrl, {
        method: 'POST',
        headers: headers
    });

    if (res.status === 202 || res.status === 200) {
        // 202 Accepted = Job queued. We must wait.
        return await pollForFork(myUsername, repo, headers);
    } else {
        const errData = await res.json();
        throw new Error(`Fork failed: ${errData.message || res.statusText}`);
    }
}

async function pollForFork(user, repo, headers, attempts = 0) {
    if (attempts > 20) throw new Error('Fork creation timed out.'); // 20 * 1.5s = 30s max

    // Wait 1.5s
    await new Promise(resolve => setTimeout(resolve, 1500));

    const res = await fetch(`https://api.github.com/repos/${user}/${repo}`, { headers });
    if (res.ok) {
        const data = await res.json();
        return data.clone_url;
    } else {
        return pollForFork(user, repo, headers, attempts + 1);
    }
}

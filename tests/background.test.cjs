const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const upstream = {
    id: 10, name: 'demo', full_name: 'upstream/demo', owner: { login: 'upstream' },
    default_branch: 'main', size: 12, clone_url: 'https://github.com/upstream/demo.git',
    ssh_url: 'git@github.com:upstream/demo.git'
};
const fork = {
    ...upstream, id: 20, fork: true, full_name: 'me/demo', owner: { login: 'me' },
    parent: { id: 10 }, source: { id: 10 }, clone_url: 'https://github.com/me/demo.git',
    ssh_url: 'git@github.com:me/demo.git'
};

function harness(responses, storage = {}) {
    const requests = [];
    const saved = { githubPat: 'test-token', ...storage };
    const queue = [...responses];
    const context = vm.createContext({
        AbortSignal,
        importScripts(file) { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context); },
        setTimeout(resolve) { resolve(); },
        chrome: {
            runtime: { onMessage: { addListener() {} } },
            commands: { onCommand: { addListener() {} } },
            storage: { local: {
                async get() { return saved; },
                async set(data) { Object.assign(saved, data); }
            } }
        },
        async fetch(url, options) {
            const requestPath = new URL(url).pathname;
            const expected = queue.shift();
            assert.ok(expected, `Unexpected request: ${requestPath}`);
            assert.equal(requestPath, expected.path);
            assert.equal(options.method, expected.method || 'GET');
            requests.push({ path: requestPath, ...options });
            const status = expected.status || 200;
            return {
                status, ok: status >= 200 && status < 300,
                headers: { get(name) { return expected.headers?.[name] ?? null; } },
                async json() { return expected.data || {}; }
            };
        }
    });
    vm.runInContext(source, context);
    return { context, requests, saved, remaining: () => queue.length };
}

const userResponse = { path: '/user', data: { login: 'me' } };
const upstreamResponse = { path: '/repos/upstream/demo', data: upstream };
const forkResponse = { path: '/repos/me/demo', data: fork };

test('rejects unrelated same-name repositories without creating a fork', async () => {
    for (const unrelated of [{ ...fork, fork: false, source: undefined, parent: undefined },
        { ...fork, source: { id: 99 }, parent: { id: 99 } }]) {
        const h = harness([userResponse, upstreamResponse, { ...forkResponse, data: unrelated }]);
        await assert.rejects(h.context.handleFixRepo('upstream', 'demo'), /already exists and is unrelated/);
        assert.equal(h.requests.length, 3);
        assert.ok(h.requests.every(request => request.method === 'GET'));
    }
});

test('reuses forks in the same network, including sibling forks', async () => {
    const h = harness([userResponse, { ...upstreamResponse, data: { ...upstream, source: { id: 5 } } },
        { ...forkResponse, data: { ...fork, source: { id: 5 }, parent: { id: 6 } } }]);
    const result = await h.context.handleFixRepo('upstream', 'demo');
    assert.equal(result.cloneUrl, fork.clone_url);
    assert.equal(result.branch, null);
});

test('handles your own repository case-insensitively and honors SSH', async () => {
    const h = harness([userResponse, { path: '/repos/ME/demo', data: fork }], { cloneUrlPreference: 'ssh' });
    const result = await h.context.handleFixRepo('ME', 'demo');
    assert.equal(result.cloneUrl, fork.ssh_url);
    assert.equal(h.requests.length, 2);
});

test('resolves slash-containing branches with nested paths without truncation', async () => {
    const h = harness([userResponse, upstreamResponse,
        { path: '/repos/upstream/demo/branches/feature%2Flogin%2Fsrc%2Findex.js', status: 404 },
        { path: '/repos/upstream/demo/branches/feature%2Flogin%2Fsrc', status: 404 },
        { path: '/repos/upstream/demo/branches/feature%2Flogin', data: { name: 'feature/login' } },
        forkResponse,
        { path: '/repos/me/demo/branches/feature%2Flogin', data: { name: 'feature/login' } }
    ]);
    const result = await h.context.handleFixRepo('upstream', 'demo', { path: 'feature/login/src/index.js' });
    assert.equal(result.branch, 'feature/login');
    assert.equal(h.remaining(), 0);
});

test('preserves explicitly selected main and master branches', async () => {
    for (const name of ['main', 'master']) {
        const h = harness([userResponse, upstreamResponse,
            { path: `/repos/upstream/demo/branches/${name}`, data: { name } }, forkResponse,
            { path: `/repos/me/demo/branches/${name}`, data: { name } }]);
        const result = await h.context.handleFixRepo('upstream', 'demo', { name });
        assert.equal(result.branch, name);
    }
});

test('does not use a stale UI branch that conflicts with the URL', async () => {
    const h = harness([{ path: '/repos/upstream/demo/branches/feature%2Flogin', data: { name: 'feature/login' } }]);
    assert.equal(await h.context.resolveBranch(upstream, { name: 'main', path: 'feature/login' }, {}), 'feature/login');
});

test('does not produce a clone command for a branch missing from the fork', async () => {
    const h = harness([userResponse, upstreamResponse,
        { path: '/repos/upstream/demo/branches/develop', data: { name: 'develop' } },
        forkResponse, { path: '/repos/me/demo/branches/develop', status: 404 }]);
    await assert.rejects(h.context.handleFixRepo('upstream', 'demo', { name: 'develop' }), /missing from me\/demo/);
});

test('successful final response with zero remaining quota is still accepted', async () => {
    const h = harness([userResponse, upstreamResponse, {
        ...forkResponse, headers: { 'X-RateLimit-Remaining': '0' }
    }]);
    assert.equal((await h.context.handleFixRepo('upstream', 'demo')).cloneUrl, fork.clone_url);
});

test('reports primary and secondary rate limits without polling again', async () => {
    for (const response of [
        { status: 403, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '2000000000' } },
        { status: 429, headers: { 'Retry-After': '60' } },
        { status: 403, data: { message: 'You have exceeded a secondary rate limit.' } }
    ]) {
        const h = harness([{ path: '/repos/me/demo', ...response }]);
        await assert.rejects(h.context.pollForFork('me/demo', upstream, {}), /rate limit/i);
        assert.equal(h.requests.length, 1);
    }
});

test('polling stops immediately for invalid credentials', async () => {
    const h = harness([{ path: '/repos/me/demo', status: 401 }]);
    await assert.rejects(h.context.pollForFork('me/demo', upstream, {}), /invalid or expired/);
    assert.equal(h.requests.length, 1);
});

test('uses the returned fork location and records history after Git objects are ready', async () => {
    const renamedFork = { ...fork, full_name: 'me/renamed', name: 'renamed', clone_url: 'https://github.com/me/renamed.git' };
    const h = harness([userResponse, upstreamResponse, { path: '/repos/me/demo', status: 404 },
        { path: '/repos/upstream/demo/forks', method: 'POST', status: 202, data: renamedFork },
        { path: '/repos/me/renamed', status: 404 },
        { path: '/repos/me/renamed', data: renamedFork },
        { path: '/repos/me/renamed/branches/main', status: 404 },
        { path: '/repos/me/renamed', data: renamedFork },
        { path: '/repos/me/renamed/branches/main', data: { name: 'main' } }
    ]);
    const result = await h.context.handleFixRepo('upstream', 'demo');
    assert.equal(result.cloneUrl, renamedFork.clone_url);
    assert.equal(JSON.parse(h.requests.find(request => request.method === 'POST').body).default_branch_only, false);
    assert.equal(h.saved.forkHistory[0].forkRepo, 'me/renamed');
    assert.equal(h.saved.forkHistory[0].originalRepo, 'upstream/demo');
    assert.equal(h.remaining(), 0);
});

test('fork timeout is bounded and does not add a successful history entry', async () => {
    const h = harness([
        { path: '/repos/upstream/demo/forks', method: 'POST', status: 202, data: fork },
        ...Array.from({ length: 20 }, () => ({ path: '/repos/me/demo', status: 404 }))
    ]);
    await assert.rejects(h.context.createFork(upstream, {}), /still preparing/);
    assert.equal(h.saved.forkHistory, undefined);
    assert.equal(h.requests.length, 21);
});

test('waits for the selected branch when a new fork is still being populated', async () => {
    const h = harness([
        { path: '/repos/upstream/demo/forks', method: 'POST', status: 202, data: fork },
        forkResponse, { path: '/repos/me/demo/branches/feature%2Flogin', status: 404 },
        forkResponse, { path: '/repos/me/demo/branches/feature%2Flogin', data: { name: 'feature/login' } }
    ]);
    assert.equal((await h.context.createFork(upstream, {}, 'feature/login')).id, fork.id);
    assert.equal(h.remaining(), 0);
});

test('history storage failure does not discard the ready fork', async () => {
    const h = harness([
        { path: '/repos/upstream/demo/forks', method: 'POST', status: 202, data: fork },
        forkResponse, { path: '/repos/me/demo/branches/main', data: { name: 'main' } }
    ]);
    h.context.chrome.storage.local.set = async () => { throw new Error('Storage unavailable'); };
    assert.equal((await h.context.createFork(upstream, {})).id, fork.id);
});

test('missing token fails before any network request', async () => {
    const h = harness([], { githubPat: '' });
    await assert.rejects(h.context.handleFixRepo('upstream', 'demo'), /No GitHub token/);
    assert.equal(h.requests.length, 0);
});

test('custom fork names and organization destinations are sent to GitHub', async () => {
    const organizationFork = { ...fork, name: 'demo-custom', full_name: 'team/demo-custom', owner: { login: 'team' }, clone_url: 'https://github.com/team/demo-custom.git' };
    const h = harness([userResponse, upstreamResponse,
        { path: '/repos/team/demo-custom', status: 404 },
        { path: '/repos/upstream/demo/forks', method: 'POST', status: 202, data: organizationFork },
        { path: '/repos/team/demo-custom', data: organizationFork },
        { path: '/repos/team/demo-custom/branches/main', data: { name: 'main' } }
    ]);
    const result = await h.context.handleFixRepo('upstream', 'demo', {}, { organization: 'team', forkName: 'demo-custom', mode: 'contribute', featureBranch: 'fix/issue' });
    const body = JSON.parse(h.requests.find(request => request.method === 'POST').body);
    assert.deepEqual(body, { default_branch_only: false, name: 'demo-custom', organization: 'team' });
    assert.match(result.command, /team\/demo-custom.git \.\/demo-custom/);
    assert.match(result.command, /remote add upstream https:\/\/github.com\/upstream\/demo.git/);
    assert.match(result.command, /switch -c fix\/issue/);
});

test('reuses a correctly named organization fork without another POST', async () => {
    const h = harness([userResponse, upstreamResponse, { path: '/repos/team/demo-custom', data: { ...fork, name: 'demo-custom', full_name: 'team/demo-custom' } }]);
    await h.context.handleFixRepo('upstream', 'demo', {}, { organization: 'team', forkName: 'demo-custom' });
    assert.ok(h.requests.every(request => request.method === 'GET'));
});

test('invalid workflow input fails before making requests', async () => {
    const h = harness([]);
    await assert.rejects(h.context.handleFixRepo('upstream', 'demo', {}, { mode: 'contribute', featureBranch: 'bad branch' }), /valid new branch/);
    await assert.rejects(h.context.handleFixRepo('upstream', 'demo', {}, { organization: '../bad' }), /organization login/);
    assert.equal(h.requests.length, 0);
});

test('saved preferences apply unless overridden for this repository', async () => {
    const h = harness([userResponse, upstreamResponse, forkResponse], { workflowOptions: { shell: 'powershell', mode: 'contribute', preset: 'shallow', featureBranch: 'fix/saved' } });
    const result = await h.context.handleFixRepo('upstream', 'demo', {}, { preset: 'single' });
    assert.match(result.command, /--single-branch/);
    assert.doesNotMatch(result.command, /--depth/);
    assert.match(result.command, /if \(\$LASTEXITCODE -eq 0\)/);
    assert.match(result.command, /switch -c fix\/saved/);
});

function syncResponses({ ahead = 0, behind = 3, canSync = true } = {}) {
    return [
        { path: '/repos/me/demo', data: { ...fork, parent: { id: 10, full_name: 'upstream/demo' }, permissions: { push: canSync } } },
        { path: '/repos/me/demo/branches/feature%2Flogin', data: { commit: { sha: 'fork-sha' } } },
        { path: '/repos/upstream/demo/branches/feature%2Flogin', data: { commit: { sha: 'upstream-sha' } } },
        { path: '/repos/upstream/demo/compare/upstream-sha...fork-sha', data: { ahead_by: ahead, behind_by: behind } }
    ];
}

test('fork status reports ahead/behind counts relative to the direct parent without writes', async () => {
    const h = harness(syncResponses({ ahead: 2, behind: 3 }));
    const result = await h.context.handleForkStatus('me/demo', 'feature/login');
    assert.equal(result.ahead, 2);
    assert.equal(result.behind, 3);
    assert.equal(result.upstream, 'upstream/demo');
    assert.ok(h.requests.every(request => request.method === 'GET'));
});

test('explicit sync revalidates status, updates the named branch and rechecks results', async () => {
    const h = harness([...syncResponses(), { path: '/repos/me/demo/merge-upstream', method: 'POST', data: { merge_type: 'fast-forward' } }, ...syncResponses({ behind: 0 })]);
    const result = await h.context.handleForkStatus('me/demo', 'feature/login', true);
    assert.equal(result.synced, true);
    assert.equal(result.behind, 0);
    assert.deepEqual(JSON.parse(h.requests.find(request => request.method === 'POST').body), { branch: 'feature/login' });
    assert.ok(h.requests.every(request => request.method !== 'PATCH'));
});

test('sync refuses diverged or read-only forks without mutating them', async () => {
    for (const options of [{ ahead: 2, behind: 3 }, { canSync: false }]) {
        const h = harness(syncResponses(options));
        await assert.rejects(h.context.handleForkStatus('me/demo', 'feature/login', true), /diverged|write access/);
        assert.equal(h.requests.length, 4);
    }
});

test('sync is a no-op when the fork is up to date or ahead', async () => {
    const h = harness(syncResponses({ ahead: 2, behind: 0 }));
    const result = await h.context.handleForkStatus('me/demo', 'feature/login', true);
    assert.equal(result.synced, false);
    assert.ok(h.requests.every(request => request.method === 'GET'));
});

test('merge conflicts surface an actionable error without force updating refs', async () => {
    const h = harness([...syncResponses(), { path: '/repos/me/demo/merge-upstream', method: 'POST', status: 409 }]);
    await assert.rejects(h.context.handleForkStatus('me/demo', 'feature/login', true), /merge conflict/);
    assert.equal(h.requests.length, 5);
});

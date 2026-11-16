const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(pathname = '/upstream/demo', name = '') {
    const context = vm.createContext({
        chrome: { runtime: { onMessage: { addListener() {} } } },
        document: {
            body: {}, getElementById() { return null; },
            querySelector(selector) { return selector.includes('branch-switcher') && name ? { textContent: name } : null; }
        },
        window: { location: { pathname } }, MutationObserver: class { observe() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../workflow.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8'), context);
    return context;
}

test('keeps full decoded slash-containing branch paths for API resolution', () => {
    for (const url of ['/upstream/demo/tree/feature/login', '/upstream/demo/tree/feature%2Flogin']) {
        assert.equal(harness(url).repositoryContext().ref.path, 'feature/login');
    }
    assert.equal(harness('/upstream/demo/blob/feature/login/src/index.js').repositoryContext().ref.path, 'feature/login/src/index.js');
});

test('malformed URL encoding does not break page observation', () => {
    assert.equal(harness('/upstream/demo/tree/%ZZ').repositoryContext(), null);
});

test('builds complete HTTPS and SSH commands, including main and master', () => {
    const context = harness();
    for (const url of ['https://github.com/me/demo.git', 'git@github.com:me/demo.git']) {
        for (const branch of ['feature/login', 'main', 'master']) {
            assert.equal(context.buildCloneCommand(url, branch), `git clone --branch ${branch} -- ${url}`);
        }
        assert.equal(context.buildCloneCommand(url, null), `git clone -- ${url}`);
    }
});

test('quotes shell-special branches and rejects unexpected clone URLs', () => {
    const context = harness();
    for (const branch of ['a;echo-bad', '$(whoami)', '`whoami`', 'a&b', '%PATH%', 'a"b']) {
        assert.ok(context.buildCloneCommand('https://github.com/me/demo.git', branch).includes(`--branch '${branch}'`));
    }
    assert.throws(() => context.buildCloneCommand('https://example.com/me/demo.git', 'main'), /unexpected clone URL/);
});

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

(async () => {
    const channel = process.env.GITBLITZ_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
    const browser = await chromium.launch({ channel, headless: true });
    const errors = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
            <html lang="en"><head><title>GitBlitz workflow fixture</title></head><body>
            <header><h1>upstream/demo</h1><div><ul data-testid="repo-header-actions"></ul></div></header>
            <main><p>Repository files</p><button id="ref-picker-repos-header-ref-selector"><span data-component="text">feature/login</span></button></main></body></html>` }));
        await page.addInitScript(() => {
            window.testState = { messages: [], copied: [], behind: 3, ahead: 0 };
            window.chrome = window.chrome || {};
            chrome.runtime = {
                onMessage: { addListener() {} },
                async sendMessage(message) {
                    testState.messages.push(message);
                    if (message.action === 'GET_WORKFLOW_OPTIONS') return { success: true, options: {} };
                    if (message.action === 'CHECK_FORK_STATUS' || message.action === 'SYNC_FORK') {
                        if (testState.statusError) return { success: false, error: 'Token does not have repository access.' };
                        if (message.action === 'SYNC_FORK') testState.behind = 0;
                        return { success: true, behind: testState.behind, ahead: testState.ahead, canSync: true, upstream: 'upstream/demo', synced: message.action === 'SYNC_FORK' };
                    }
                    const options = GitBlitz.options(message.options);
                    const fullName = `${options.organization || 'me'}/${options.forkName || message.repo}`;
                    const recipe = { cloneUrl: `https://github.com/${fullName}.git`, upstreamUrl: `https://github.com/${message.owner}/${message.repo}.git`, branch: 'feature/login', directory: options.forkName || message.repo, fullName, isFork: true, syncBranch: 'feature/login', options };
                    return { success: true, ...recipe, command: GitBlitz.buildCommand(recipe, options) };
                }
            };
            Object.defineProperty(navigator, 'clipboard', { value: { async writeText(text) { testState.copied.push(text); } } });
        });
        await page.goto('https://github.com/upstream/demo/tree/feature/login');
        for (const file of ['options.css', 'content.css']) await page.addStyleTag({ path: path.resolve(file) });
        for (const file of ['workflow.js', 'options.js', 'content.js']) await page.addScriptTag({ path: path.resolve(file) });
        await page.locator('#gitblitz-options-toggle').click();
        await page.locator('#gitblitz-recipe').waitFor();
        assert.equal(await page.locator('#gitblitz-recipe-featureBranch').isDisabled(), true);
        assert.equal(await page.evaluate(() => testState.messages.some(message => message.action === 'ACTION_FIX_REPO')), false);
        await page.locator('#gitblitz-recipe-mode').selectOption('contribute');
        await page.locator('#gitblitz-recipe-featureBranch').fill('bad branch');
        await page.locator('#gitblitz-recipe button[type="submit"]').click();
        assert.equal(await page.locator('#gitblitz-recipe-featureBranch').getAttribute('aria-invalid'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'gitblitz-recipe-featureBranch');
        assert.equal(await page.evaluate(() => testState.messages.some(message => message.action === 'ACTION_FIX_REPO')), false);
        await page.locator('#gitblitz-recipe-featureBranch').fill('fix/login');
        await page.locator('#gitblitz-recipe-shell').selectOption('powershell');
        await page.locator('#gitblitz-recipe-preset').selectOption('shallow');
        await page.locator('#gitblitz-recipe-forkName').fill('demo-copy');
        await page.locator('#gitblitz-recipe-organization').fill('team');
        await page.locator('#gitblitz-recipe button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('#gitblitz-sync-status')?.textContent.includes('3 behind'));
        const command = await page.locator('#gitblitz-command').inputValue();
        assert.match(command, /git clone --depth 1 --branch feature\/login -- https:\/\/github.com\/team\/demo-copy.git \.\/demo-copy/);
        assert.match(command, /remote add upstream https:\/\/github.com\/upstream\/demo.git/);
        assert.match(command, /if \(\$LASTEXITCODE -eq 0\)/);
        assert.match(command, /switch -c fix\/login/);
        assert.equal(command, await page.evaluate(() => testState.copied.at(-1)));
        const editor = new URL(await page.locator('#gitblitz-vscode').getAttribute('href'));
        assert.equal(editor.searchParams.get('url'), 'https://github.com/team/demo-copy.git');
        assert.equal(editor.searchParams.get('ref'), 'feature/login');
        assert.equal(await page.evaluate(() => testState.messages.filter(message => message.action === 'SYNC_FORK').length), 0);
        assert.match(await page.locator('#gitblitz-sync').innerText(), /team\/demo-copy/);
        await page.locator('#gitblitz-sync').click();
        await page.waitForFunction(() => document.querySelector('#gitblitz-sync-status').textContent.startsWith('Sync finished.'));
        assert.equal(await page.evaluate(() => testState.messages.filter(message => message.action === 'SYNC_FORK').length), 1);
        assert.equal(await page.locator('#gitblitz-sync').isHidden(), true);
        await page.evaluate(() => { testState.ahead = 2; testState.behind = 3; });
        await page.getByRole('button', { name: 'Refresh fork status' }).click();
        await page.waitForFunction(() => document.querySelector('#gitblitz-sync-status').textContent.includes('diverged'));
        assert.equal(await page.locator('#gitblitz-sync').isHidden(), true);
        await page.evaluate(() => { testState.statusError = true; });
        await page.getByRole('button', { name: 'Refresh fork status' }).click();
        await page.waitForFunction(() => document.querySelector('#gitblitz-sync-status').textContent.includes('Token does not'));
        assert.equal(await page.locator('#gitblitz-command').inputValue(), command);
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const violations = await page.evaluate(async () => (await axe.run({ include: ['#gitblitz-options', '#gitblitz-feedback'] })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));
        assert.deepEqual(violations, []);
        await page.screenshot({ path: path.join(os.tmpdir(), 'gitblitz-features-check.png'), fullPage: true });
        await page.setViewportSize({ width: 320, height: 700 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.evaluate(() => {
            history.pushState({}, '', '/another/project');
            document.querySelector('main').append(document.createElement('span'));
        });
        await page.waitForFunction(() => !document.querySelector('#gitblitz-options'));
        await page.locator('#gitblitz-fix-btn').click();
        await page.waitForFunction(() => document.querySelector('#gitblitz-command')?.value.includes('me/project.git'));
        const lastPrepare = await page.evaluate(() => testState.messages.filter(message => message.action === 'ACTION_FIX_REPO').at(-1));
        assert.equal(lastPrepare.options, undefined);
        console.log('PASS: workflow form validation, custom name/org, PowerShell contribution setup, shallow clone, VS Code URL, explicit sync, divergence and status failures, navigation reset, 320px layout; axe violations: 0.');

        const popup = await browser.newPage({ viewport: { width: 360, height: 800 } });
        popup.on('pageerror', error => errors.push(error.message));
        await popup.addInitScript(() => {
            window.testState = { storage: { workflowOptions: { mode: 'contribute', shell: 'powershell', preset: 'single', featureBranch: 'fix/saved' } }, failStorage: false };
            window.chrome = window.chrome || {};
            chrome.runtime = {};
            chrome.storage = { local: {
                get(keys, callback) { callback(testState.storage); },
                set(data, callback) {
                    if (testState.failStorage) chrome.runtime.lastError = { message: 'Storage unavailable' };
                    else Object.assign(testState.storage, data);
                    callback?.();
                    delete chrome.runtime.lastError;
                }
            } };
        });
        await popup.goto(pathToFileURL(path.resolve('popup.html')).href);
        await popup.locator('.preferences-section summary').click();
        assert.equal(await popup.locator('#gitblitz-defaults-shell').inputValue(), 'powershell');
        assert.equal(await popup.locator('#gitblitz-defaults-featureBranch').inputValue(), 'fix/saved');
        await popup.locator('#gitblitz-defaults-preset').selectOption('shallow');
        assert.equal(await popup.evaluate(() => testState.storage.workflowOptions.preset), 'single');
        await popup.getByRole('button', { name: 'Save defaults' }).click();
        await popup.waitForFunction(() => document.querySelector('.gitblitz-form-status').textContent === 'Command defaults saved.');
        assert.equal(await popup.evaluate(() => testState.storage.workflowOptions.preset), 'shallow');
        assert.equal(await popup.evaluate(() => testState.storage.workflowOptions.organization), '');
        await popup.evaluate(() => { testState.failStorage = true; });
        await popup.getByRole('button', { name: 'Save defaults' }).click();
        await popup.waitForFunction(() => document.querySelector('.gitblitz-form-status').textContent.includes('Could not save'));
        await popup.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const popupViolations = await popup.evaluate(async () => (await axe.run()).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));
        assert.deepEqual(popupViolations, []);
        await popup.screenshot({ path: path.join(os.tmpdir(), 'gitblitz-defaults-check.png'), fullPage: true });
        assert.deepEqual(errors, []);
        console.log('PASS: saved defaults load, explicit preference save, storage failure feedback, popup accessibility; axe violations: 0.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

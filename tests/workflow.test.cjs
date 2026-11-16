const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const workflow = require('../workflow.js');

const recipe = { cloneUrl: 'https://github.com/me/demo.git', upstreamUrl: 'https://github.com/upstream/demo.git', branch: 'feature/login', directory: 'demo' };

test('clone presets select the intended history and branch flags', () => {
    assert.equal(workflow.buildCommand(recipe), 'git clone --branch feature/login -- https://github.com/me/demo.git');
    assert.equal(workflow.buildCommand(recipe, { preset: 'shallow' }), 'git clone --depth 1 --branch feature/login -- https://github.com/me/demo.git');
    assert.equal(workflow.buildCommand(recipe, { preset: 'single' }), 'git clone --single-branch --branch feature/login -- https://github.com/me/demo.git');
});

test('contribution setup clones into an explicit folder and configures upstream and a new branch', () => {
    assert.equal(workflow.buildCommand(recipe, { mode: 'contribute', featureBranch: 'fix/login' }),
        'git clone --branch feature/login -- https://github.com/me/demo.git ./demo && git -C ./demo remote add upstream https://github.com/upstream/demo.git && git -C ./demo switch -c fix/login');
    const own = workflow.buildCommand({ ...recipe, upstreamUrl: recipe.cloneUrl }, { mode: 'contribute' });
    assert.equal(own.includes('remote add upstream'), false);
    assert.throws(() => workflow.buildCommand(recipe, { mode: 'contribute', featureBranch: 'feature/login' }), /differs/);
});

test('validates workflow enums, organization, repository name and Git branch rules', () => {
    for (const options of [{ shell: 'cmd' }, { preset: 'unknown' }, { organization: 'https://github.com/org' },
        { forkName: '../other' }, { forkName: '..' }, { mode: 'contribute', featureBranch: 'bad name' },
        { mode: 'contribute', featureBranch: '-bad' }, { mode: 'contribute', featureBranch: 'a/.hidden' },
        { mode: 'contribute', featureBranch: 'a.lock/b' }]) {
        assert.throws(() => workflow.options(options));
    }
    assert.equal(workflow.options({ forkName: 'demo-fork', organization: 'my-org' }).organization, 'my-org');
});

test('VS Code URI preserves HTTPS or SSH URLs and full branch names', () => {
    for (const cloneUrl of [recipe.cloneUrl, 'git@github.com:me/demo.git']) {
        const uri = new URL(workflow.vscodeUrl(cloneUrl, 'feature/login'));
        assert.equal(uri.protocol, 'vscode:');
        assert.equal(uri.hostname, 'vscode.git');
        assert.equal(uri.pathname, '/clone');
        assert.equal(uri.searchParams.get('url'), cloneUrl);
        assert.equal(uri.searchParams.get('ref'), 'feature/login');
    }
    assert.throws(() => workflow.vscodeUrl('file:///tmp/repo'), /unexpected/);
});

// Exercise generated commands in actual shells with a fake git function. These
// tests never clone or modify a real repository, even when a command is malformed.
function runShell(shell, script) {
    const executable = shell === 'powershell' ? 'powershell.exe'
        : process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblitz-shell-'));
    const file = path.join(directory, shell === 'powershell' ? 'check.ps1' : 'check.sh');
    try {
        fs.writeFileSync(file, script);
        const args = shell === 'powershell' ? ['-NoProfile', '-NonInteractive', '-File', file] : [file.replaceAll('\\', '/')];
        const result = spawnSync(executable, args, { encoding: 'utf8', cwd: directory });
        if (result.error?.code === 'ENOENT') return null;
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    } finally {
        fs.unlinkSync(file);
        fs.rmdirSync(directory);
    }
}

for (const shell of ['bash', 'powershell']) {
    test(`${shell}: shell metacharacters are passed as literal Git arguments`, t => {
        if (shell === 'powershell' && process.platform !== 'win32') return t.skip('Windows PowerShell is not installed');
        const values = ['$(echo INJECTED)', 'feature/a;b', "fix/O'Reilly", '`whoami`', '@argument', 'feature/$USER'];
        const prelude = shell === 'powershell' ? "function git { $args[-1] }\n" : "git() { printf '%s\\n' \"${@: -1}\"; }\n";
        const output = runShell(shell, prelude + values.map(value => `git check ${workflow.quote(value, shell)}`).join('\n'));
        if (output === null) return t.skip(`${shell} is not installed`);
        assert.deepEqual(output.split(/\r?\n/), values);
    });

    test(`${shell}: setup stops after clone failure and runs all steps after success`, t => {
        if (shell === 'powershell' && process.platform !== 'win32') return t.skip('Windows PowerShell is not installed');
        for (const fail of [true, false]) {
            const prelude = shell === 'powershell'
                ? `function git { $args -join ' '; $global:LASTEXITCODE = ${fail ? 1 : 0} }\n`
                : `git() { printf '%s\\n' "$*"; return ${fail ? 1 : 0}; }\n`;
            const command = workflow.buildCommand(recipe, { mode: 'contribute', shell, featureBranch: 'fix/login' });
            const output = runShell(shell, prelude + command + (shell === 'bash' ? '\nexit 0\n' : '\n'));
            if (output === null) return t.skip(`${shell} is not installed`);
            const lines = output.split(/\r?\n/);
            assert.equal(lines.length, fail ? 1 : 3);
            if (!fail) {
                assert.match(lines[1], /remote add upstream/);
                assert.match(lines[2], /switch -c fix\/login/);
            }
        }
    });
}

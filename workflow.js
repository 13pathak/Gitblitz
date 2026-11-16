// Pure workflow helpers shared by the service worker, popup and content script.
globalThis.GitBlitz = (() => {
    const defaults = Object.freeze({ mode: 'clone', shell: 'bash', preset: 'full', featureBranch: 'fix/my-change', organization: '', forkName: '' });

    function invalid(field, message) {
        const error = new Error(message);
        error.field = field;
        throw error;
    }

    function validBranch(value) {
        return typeof value === 'string' && value.length > 0 && value.length <= 255 &&
            !/[\x00-\x20\x7f~^:?*\[\\]/.test(value) && !value.includes('..') && !value.includes('@{') &&
            !value.startsWith('-') && !value.endsWith('.') && value !== '@' &&
            value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
    }

    function options(input = {}) {
        const result = {};
        for (const [key, fallback] of Object.entries(defaults)) {
            result[key] = typeof input?.[key] === 'string' ? input[key].trim() : fallback;
        }
        for (const [key, allowed] of Object.entries({ mode: ['clone', 'contribute'], shell: ['bash', 'powershell'], preset: ['full', 'shallow', 'single'] })) {
            if (!allowed.includes(result[key])) invalid(key, `Choose a supported ${key}.`);
        }
        if (result.organization && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(result.organization)) {
            invalid('organization', 'Enter an organization login, without a URL or spaces.');
        }
        if (result.forkName && (!/^[\w.-]{1,100}$/.test(result.forkName) || /^\.+$/.test(result.forkName))) {
            invalid('forkName', 'Use 1–100 letters, numbers, dots, underscores or hyphens for the fork name.');
        }
        if (result.mode === 'contribute' && !validBranch(result.featureBranch)) {
            invalid('featureBranch', 'Enter a valid new branch, such as fix/login. Avoid spaces, .. and a leading hyphen.');
        }
        return result;
    }

    function quote(value, shell) {
        if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid command argument.');
        if (/^[A-Za-z0-9_./:@-]+$/.test(value) && !value.startsWith('@')) return value;
        // PowerShell also recognizes curly single quotes as delimiters.
        return shell === 'powershell'
            ? `'${value.replace(/['\u2018\u2019]/g, '$&$&')}'`
            : `'${value.replace(/'/g, "'\\''")}'`;
    }

    function validateCloneUrl(url) {
        if (typeof url !== 'string' || !/^(https:\/\/github\.com\/|git@github\.com:)[\w.-]+\/[\w.-]+\.git$/.test(url)) {
            throw new Error('GitHub returned an unexpected clone URL.');
        }
        return url;
    }

    function buildCommand(recipe, input = {}) {
        const settings = options(input);
        const { cloneUrl, branch, upstreamUrl } = recipe;
        validateCloneUrl(cloneUrl);
        if (branch && !validBranch(branch)) throw new Error('GitHub returned an invalid branch name.');
        const q = value => quote(value, settings.shell);
        const args = ['git clone'];
        if (settings.preset === 'shallow') args.push('--depth 1');
        if (settings.preset === 'single') args.push('--single-branch');
        if (branch) args.push(`--branch ${q(branch)}`);
        args.push(`-- ${q(cloneUrl)}`);
        if (settings.mode === 'clone') return args.join(' ');

        if (settings.featureBranch === branch) invalid('featureBranch', 'Choose a new feature branch that differs from the starting branch.');
        const directory = recipe.directory || cloneUrl.split(/[/:]/).pop().replace(/\.git$/, '');
        if (!/^[\w.-]+$/.test(directory) || /^\.+$/.test(directory) || directory.endsWith('.')) {
            throw new Error('This repository name cannot be used as a local folder. Choose another fork name.');
        }
        // An explicit ./ path remains a literal folder, even when its name starts with '-'.
        const folder = q(`./${directory}`);
        args.push(folder);
        const commands = [args.join(' ')];
        if (upstreamUrl && upstreamUrl !== cloneUrl) {
            commands.push(`git -C ${folder} remote add upstream ${q(validateCloneUrl(upstreamUrl))}`);
        }
        commands.push(`git -C ${folder} switch -c ${q(settings.featureBranch)}`);
        // PowerShell 5.1 lacks &&. Nest exit-code guards so subsequent steps never
        // run after clone fails (for example, when the destination already exists).
        if (settings.shell === 'powershell') {
            return commands.reduceRight((next, command) => next
                ? `${command}; if ($LASTEXITCODE -eq 0) { ${next} }` : command, '');
        }
        return commands.join(' && ');
    }

    function vscodeUrl(cloneUrl, branch) {
        validateCloneUrl(cloneUrl);
        return `vscode://vscode.git/clone?url=${encodeURIComponent(cloneUrl)}${branch ? `&ref=${encodeURIComponent(branch)}` : ''}`;
    }

    return Object.freeze({ defaults, options, validBranch, quote, validateCloneUrl, buildCommand, vscodeUrl });
})();

if (typeof module !== 'undefined') module.exports = globalThis.GitBlitz;

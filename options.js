globalThis.GitBlitzForms = (() => {
    function create({ id, values = {}, repositoryOptions = false, onSubmit, submitLabel = 'Save defaults', headingLevel = 2 }) {
        const settings = GitBlitz.options(values);
        const form = document.createElement('form');
        form.id = id;
        form.className = 'gitblitz-options-form';
        form.setAttribute('aria-labelledby', `${id}-title`);
        const title = document.createElement(`h${headingLevel}`);
        title.id = `${id}-title`;
        title.textContent = repositoryOptions ? 'Options for this repository' : 'Command defaults';
        form.appendChild(title);
        const fields = [
            ['mode', 'Command', [['clone', 'Clone only'], ['contribute', 'Set up a contribution']]],
            ['shell', 'Terminal', [['bash', 'Bash / zsh'], ['powershell', 'PowerShell (5.1 or newer)']]],
            ['preset', 'Clone history', [['full', 'Full history, all branches'], ['shallow', 'Shallow: latest commit'], ['single', 'Single branch, full history']]],
            ['featureBranch', 'New feature branch', null, 'Used for contribution setup, for example fix/login.']
        ];
        if (repositoryOptions) fields.push(
            ['forkName', 'Fork name (optional)', null, 'Leave blank to keep the repository’s name.'],
            ['organization', 'Destination organization (optional)', null, 'Leave blank to fork into your personal account.']
        );
        for (const [name, labelText, choices, hintText] of fields) {
            const group = document.createElement('div');
            group.className = 'gitblitz-field';
            const label = document.createElement('label');
            label.htmlFor = `${id}-${name}`;
            label.textContent = labelText;
            group.appendChild(label);
            const control = document.createElement(choices ? 'select' : 'input');
            control.id = label.htmlFor;
            control.name = name;
            control.setAttribute('aria-invalid', 'false');
            if (choices) {
                for (const [value, text] of choices) {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = text;
                    control.appendChild(option);
                }
            } else {
                control.type = 'text';
                control.maxLength = name === 'featureBranch' ? 255 : name === 'forkName' ? 100 : 39;
                control.autocomplete = 'off';
                control.spellcheck = false;
                control.setAttribute('autocapitalize', 'none');
                control.setAttribute('autocorrect', 'off');
            }
            if (hintText) {
                const hint = document.createElement('p');
                hint.id = `${control.id}-hint`;
                hint.className = 'gitblitz-hint';
                hint.textContent = hintText;
                group.appendChild(hint);
                control.setAttribute('aria-describedby', hint.id);
            }
            control.value = settings[name];
            group.appendChild(control);
            const error = document.createElement('p');
            error.id = `${control.id}-error`;
            error.className = 'gitblitz-field-error';
            error.hidden = true;
            group.appendChild(error);
            control.addEventListener('input', () => clearError(control));
            control.addEventListener('invalid', () => showError(control, control.validationMessage));
            form.appendChild(group);
        }
        const updateBranch = () => {
            const branch = form.elements.namedItem('featureBranch');
            branch.disabled = form.elements.namedItem('mode').value !== 'contribute';
            branch.required = !branch.disabled;
            if (branch.disabled) clearError(branch);
        };
        form.elements.namedItem('mode').addEventListener('change', updateBranch);
        updateBranch();
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'gitblitz-option-submit';
        submit.textContent = submitLabel;
        form.appendChild(submit);
        const status = document.createElement('p');
        status.className = 'gitblitz-form-status';
        status.setAttribute('role', 'status');
        form.appendChild(status);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const result = read(form);
            if (!result || submit.disabled) return;
            submit.disabled = true;
            status.textContent = '';
            try {
                await onSubmit(result);
                if (!repositoryOptions) status.textContent = 'Command defaults saved.';
            } catch (error) {
                status.textContent = error.message || 'Could not save these options. Try again.';
            } finally {
                submit.disabled = false;
            }
        });
        return form;
    }

    function clearError(control) {
        control.setCustomValidity('');
        control.setAttribute('aria-invalid', 'false');
        const error = control.parentElement.querySelector('.gitblitz-field-error');
        error.hidden = true;
        const hint = control.parentElement.querySelector('.gitblitz-hint');
        if (hint) control.setAttribute('aria-describedby', hint.id);
        else control.removeAttribute('aria-describedby');
    }

    function showError(control, message) {
        const error = control.parentElement.querySelector('.gitblitz-field-error');
        error.textContent = message;
        error.hidden = false;
        control.setAttribute('aria-invalid', 'true');
        const hint = control.parentElement.querySelector('.gitblitz-hint');
        control.setAttribute('aria-describedby', [hint?.id, error.id].filter(Boolean).join(' '));
    }

    function read(form) {
        for (const control of form.querySelectorAll('input, select')) clearError(control);
        try {
            const values = Object.fromEntries([...form.querySelectorAll('input, select')].map(control => [control.name, control.value]));
            const result = GitBlitz.options(values);
            return form.reportValidity() ? result : null;
        } catch (error) {
            const control = form.elements.namedItem(error.field);
            if (control) {
                control.setCustomValidity(error.message);
                showError(control, error.message);
                control.reportValidity();
                control.focus();
            }
            return null;
        }
    }
    return { create, read };
})();

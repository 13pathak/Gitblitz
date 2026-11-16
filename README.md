# GitBlitz

GitBlitz is a Chrome extension that creates or reuses GitHub forks and prepares terminal commands for cloning and contributing.

## Features

- Adds **Fork & Copy Command** and **GitBlitz options** to GitHub repository pages.
- Saves a GitHub personal access token locally in Chrome extension storage.
- Detects the GitHub account associated with the saved token.
- Reuses your existing fork after verifying its fork network; reports unrelated name collisions.
- Creates a fork automatically when you do not already have one.
- Waits for GitHub to finish creating a new fork before continuing.
- Handles repositories you already own without creating another fork.
- Copies a complete HTTPS or SSH clone command, including the selected branch when available.
- Builds contribution setup commands that clone, configure an upstream remote, and create a feature branch.
- Supports custom fork names and organization destinations per repository.
- Offers full-history, shallow, and single-branch clone presets, with Bash/zsh or PowerShell quoting.
- Checks whether a fork is ahead or behind its direct upstream and offers an explicit sync action.
- Hands the prepared repository and selected branch to VS Code’s clone workflow.
- Resolves branches containing slashes and checks that the branch exists in your fork.
- Supports **Ctrl+Shift+G** (**Command+Shift+G** on macOS); customize it at `chrome://extensions/shortcuts` if the shortcut is already assigned.
- Shows accessible, persistent inline feedback and a selectable command if clipboard access fails.
- Keeps the 20 most recently prepared forks in the popup.
- Supports GitHub's single-page navigation and reinserts its button when the page changes.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select this project folder.

## Setup and use

1. Open the GitBlitz extension popup.
2. Paste a GitHub personal access token and select **Save Token**.
3. Visit any GitHub repository page.
4. Select **Fork & Copy Command**, or open **GitBlitz options** to customize this repository’s workflow.
5. Paste the copied command into a terminal to clone your fork or repository.

For a classic token, use `public_repo` for public repositories or `repo` when private repositories are needed. Organization policies and SSO authorization may also apply. For fine-grained tokens, configure repository access and a permission set supported by [GitHub’s Create a fork endpoint](https://docs.github.com/en/rest/repos/forks#create-a-fork), including Contents read access. Validation confirms your identity; individual repository operations can still require additional access.

Choose **HTTPS** or **SSH** in the popup. SSH cloning requires an SSH key configured with GitHub. Your browser token is used for GitHub API requests; terminal authentication is configured separately.

If a same-name repository belongs to another fork network, choose another fork name in **GitBlitz options**. To reuse a differently named fork, enter that name or open the fork directly. On tag or commit pages, select a branch first. If a selected branch is missing from the fork, add it to your fork before retrying.

After updating this extension, reload it at `chrome://extensions` and refresh open GitHub tabs.

## Contribution setup and clone presets

In **GitBlitz options**, choose **Set up a contribution**, select your terminal, and enter a new feature branch such as `fix/login`. The generated command clones into a new folder, adds the original repository as `upstream` when appropriate, and creates your branch. Later steps only run if previous steps succeed. Existing folders are not overwritten.

For example, a Bash setup command looks like:

```sh
git clone --branch main -- https://github.com/you/project.git ./project && git -C ./project remote add upstream https://github.com/original/project.git && git -C ./project switch -c fix/login
```

PowerShell commands work with Windows PowerShell 5.1 and newer. Choose the correct terminal before pasting; commands are quoted for Bash/zsh or PowerShell, not cmd.exe.

- **Full history, all branches:** a normal clone with all remote branches available.
- **Shallow: latest commit:** uses `--depth 1`, which limits history and normally clones only the selected branch. Use full history when you need older commits.
- **Single branch, full history:** fetches only the selected branch, retaining its history.

Save your preferred command mode, terminal, history preset, and feature branch under **Command defaults** in the popup. Fork names and organizations are chosen on individual repository pages and are cleared when you move to another repository. Preferences are saved only when you select **Save defaults**.

## Custom forks, sync, and VS Code

Leave **Fork name** blank to preserve the original name. Leave **Destination organization** blank to fork into the account associated with your token. For an organization destination, enter its GitHub login; your account and token must have permission to create repositories there. GitHub’s organization and fork policies still apply.

After preparing a fork, GitBlitz displays the selected branch’s ahead/behind counts relative to the fork’s **direct parent**. Select **Sync owner/repo · branch** to update that remote branch. Sync requires Contents write permission for fine-grained tokens. GitBlitz rechecks status before writing, refuses branches already known to have diverged, and never force-resets a branch. Conflicts and permission failures leave the command available for copying. See [GitHub’s sync endpoint](https://docs.github.com/en/rest/branches/branches#sync-a-fork-branch-with-the-upstream-repository).

**Clone in VS Code** opens the installed editor’s clone workflow with the repository URL and selected branch. Your browser may ask permission to open the application. VS Code chooses the local folder and uses its own clone settings; use the terminal command when you want GitBlitz’s contribution setup or history presets. See [VS Code’s URL handling](https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls).

## Development checks

With Node.js 20 or newer, run `node --test` for the dependency-free regression suite. For browser checks, run `npm ci` and `npm run test:browser`. The browser suite uses installed Microsoft Edge on Windows; elsewhere, install Chromium with `npx playwright install chromium`. Set `GITBLITZ_BROWSER_CHANNEL` to override the browser channel (for example, `chrome`).

Tests mock GitHub requests and extension APIs; they do not access tokens or create remote repositories. Shell checks execute generated commands with a fake Git function in Bash and Windows PowerShell when those shells are installed. Browser checks cover both repository header layouts, clipboard fallback, navigation, workflow validation, custom destinations, sync controls, VS Code links, saved defaults, and axe accessibility checks. Development dependencies are only used for testing; the extension itself requires no build step.

## Permissions

- `storage` stores the token in the browser's local extension storage.
- `activeTab` and `scripting` support the extension on the active GitHub page.
- `clipboardWrite` copies the clone command.
- GitHub and GitHub API host access is used to display the button and create or look up forks.

## Project files

- `manifest.json` — Chrome Extension Manifest V3 configuration.
- `popup.html`, `popup.js`, and `popup.css` — token settings interface.
- `content.js` and `content.css` — GitHub-page button and clipboard behavior.
- `background.js` — GitHub API calls and fork polling.
- `workflow.js` — shared validation, shell quoting, command generation, and editor links.
- `options.js` and `options.css` — reusable workflow forms for the popup and repository pages.
- `tests/` — API, command, shell, and browser regression checks.
- `icons/` — extension icons.

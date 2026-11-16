# GitBlitz

GitBlitz is a Chrome extension that makes it quick to create (or reuse) a GitHub fork and copy a ready-to-run `git clone` command.

## Features

- Adds a **Fork & Copy Clone Command** button to GitHub repository pages.
- Saves a GitHub personal access token locally in Chrome extension storage.
- Detects the GitHub account associated with the saved token.
- Reuses your existing fork after verifying its fork network; reports unrelated name collisions.
- Creates a fork automatically when you do not already have one.
- Waits for GitHub to finish creating a new fork before continuing.
- Handles repositories you already own without creating another fork.
- Copies a complete HTTPS or SSH clone command, including the selected branch when available.
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
4. Select **Fork & Copy Clone Command**.
5. Paste the copied command into a terminal to clone your fork or repository.

For a classic token, use `public_repo` for public repositories or `repo` when private repositories are needed. Organization policies and SSO authorization may also apply. For fine-grained tokens, configure repository access and a permission set supported by [GitHub’s Create a fork endpoint](https://docs.github.com/en/rest/repos/forks#create-a-fork), including Contents read access. Validation confirms your identity; individual repository operations can still require additional access.

Choose **HTTPS** or **SSH** in the popup. SSH cloning requires an SSH key configured with GitHub. Your browser token is used for GitHub API requests; terminal authentication is configured separately.

If a same-name repository belongs to another fork network, GitBlitz stops and explains the collision. Open an existing differently named fork directly to copy its command. On tag or commit pages, select a branch first. If the branch is missing from your fork, sync it before retrying. Names containing shell metacharacters require manual quoting for your terminal and are not inserted into generated commands.

After updating this extension, reload it at `chrome://extensions` and refresh open GitHub tabs.

## Development checks

With Node.js 20 or newer, run `node --test` for the dependency-free regression suite. For browser checks, run `npm ci` and `npm run test:browser`. The browser suite uses installed Microsoft Edge on Windows; elsewhere, install Chromium with `npx playwright install chromium`. Set `GITBLITZ_BROWSER_CHANNEL` to override the browser channel (for example, `chrome`).

Tests mock GitHub requests and extension APIs; they do not access tokens or create repositories. Browser checks cover both repository header layouts, the shortcut, clipboard-denied fallback, navigation during a request, keyboard focus, the popup’s token form, and axe accessibility checks. Development dependencies are only used for testing; the extension itself requires no build step.

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
- `icons/` — extension icons.

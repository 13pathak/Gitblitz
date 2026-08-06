# GitBlitz

GitBlitz is a Chrome extension that makes it quick to create (or reuse) a GitHub fork and copy a ready-to-run `git clone` command.

## Features

- Adds a **Fix This Repo** button to GitHub repository pages.
- Saves a GitHub personal access token locally in Chrome extension storage.
- Detects the GitHub account associated with the saved token.
- Reuses your existing fork when one already exists.
- Creates a fork automatically when you do not already have one.
- Waits for GitHub to finish creating a new fork before continuing.
- Handles repositories you already own without creating another fork.
- Copies `git clone <repository-url>` to the clipboard after the repository is ready.
- Shows in-button progress and success feedback, and reports token, API, and clipboard errors.
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
4. Select **Fix This Repo**.
5. Paste the copied command into a terminal to clone your fork or repository.

The token must be allowed to read the repositories you want to fork. For private repositories, grant it the appropriate repository access and permissions.

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

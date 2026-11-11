# Minimal Personal Notebook

A lightweight, static, cross-platform text notebook that stores notes in GitHub Gists. No application server or build step is required.

## Features

- Multiple editor tabs, with an independent local copy for every registered Gist file.
- Syntax highlighting based on file extension.
- Undo and redo history per file. Typing is grouped into short editing sessions to avoid creating one history entry per keystroke.
- Immediate local persistence on each editor input, plus persistence on blur, tab changes, page hiding, and page exit.
- Pull and Push cover every registered file, including files that are not currently open.
- One Gist can register multiple files. The filename is discovered from the Gist API after entering its URL or ID; no GitHub username is needed.

## Getting Started

### 1. Create GitHub Gists

1. You need a GitHub account to use GitHub Gist for synchronization. 
2. Create one or more Gists at [GitHub Gist](https://gist.github.com/). Secret Gists are supported.

### 2. Create a GitHub Personal Access Token

1. Open GitHub's [Personal access tokens settings](https://github.com/settings/tokens).
2. Choose `Tokens(classic)`, then `Generate new token (classic)`.
3. In `Select scopes`, enable the `gist` scope.
4. Generate the token and copy it immediately. GitHub will not show you the full token again.

### 3. Open or Deploy the App

You can use the hosted version:

[https://notebook.gamefang.fun](https://notebook.gamefang.fun)

Or deploy the static project to a public web host, such as [GitHub Pages](https://pages.github.com).

### 4. Configure the App

1. Open **Settings**, enter a page title and token, then choose **Add Gist file**.
2. Paste a Gist URL or ID and choose **Load files**. Select one or more existing files. To add a brand-new note, create the file in the Gist website first, then load the Gist again and register that file.
3. Newly registered files are opened in tabs automatically when there is room. Click **＋** next to the tabs later to open any other registered file.

## Editing, Saving and Synchronization

- Every text input is written synchronously to localStorage. The Save button explicitly flushes the current edit history and workspace state; it does not upload anything to GitHub.
- Switching tabs, closing a tab, losing window focus, hiding the page, and leaving the page also flush local state.
- Undo/redo history is stored with each note and grouped by a 650 ms typing pause.
- Closing a tab does not delete its local copy or history. Removing a Gist file from Settings deletes that file's local cache and history after confirmation.
- The current defaults allow 8 open tabs and 16 registered files. A note is limited to 32 KiB of UTF-8 text; each undo/redo stack is limited to 30 snapshots and approximately 8 KiB (a single snapshot is retained even when it is larger). These limits can be adjusted in `config.json`.
- **Pull** fetches all registered Gists and updates all registered local files. If any target file has local edits, the app asks before replacing those edits. Files that no longer exist remotely are left unchanged and listed in the status message.
- **Push** first fetches the current remote versions. It only uploads files with local changes. If a remote file differs from its stored `baseContent`, the app asks before overwriting the newer remote version. Files in the same Gist are sent in one PATCH request. If a registered file has been deleted remotely, Push stops and asks you to recreate that file in GitHub before retrying. The app updates existing Gist files; it does not create or delete remote files. This follows GitHub's Gist update API, whose file keys identify existing remote filenames.

## Data and Privacy Notes

- Gist visibility: A Secret Gist is unlisted, not private. Anyone with its URL may be able to access its contents. Do not use it to store passwords, private notes, or other sensitive information.
- Token security: The app stores its settings in your browser. A token saved in the browser may be accessible to someone who can access that browser profile or its local data. Do not share your token or use it on a device you do not trust.
- Local storage: Local note data is stored in the browser's local storage and is specific to the browser and website origin. Clearing browser data may remove the local copy.
- Sync carefully: When using multiple devices, pull and push deliberately. If different devices have made changes independently, pushing one device's data may overwrite the version currently stored in the Gist. Pulling also replaces the current local data.

## Technical Overview

- Frontend: HTML, CSS, and vanilla JavaScript.
- Editor: CodeMirror 5.
- Storage: Browser `localStorage` for local documents and settings.
- Synchronization: GitHub Gist REST API.
- Internationalization: Text is organized for data-driven language support.
- Deployment: Static hosting; no dedicated application server or build step is required.
- AI tools were used to assist with development.
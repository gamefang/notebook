# Minimal Personal Notebook

A lightweight, static, cross-platform text notebook. Notes are stored in the current browser and can be synchronized with GitHub Gists. No application server or build step is required.

## Features

- Multiple editor tabs, with an independent local copy for every registered document.
- Syntax highlighting based on file extension.
- Undo and redo history per file. Typing is grouped into short editing sessions to avoid creating one history entry per keystroke.
- Immediate local persistence on each editor input, plus persistence on blur, tab changes, page hiding, and page exit.
- Pull and Push act only on the currently active document.
- Allow add a local note without creating a Gist first.

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

1. Open **Settings**, enter a page title and GitHub token.
2. Choose **Add file** to create a local document, or paste a Gist URL/ID or browse your Gists to import existing files.
3. Local documents do not need to be linked manually. Push will search your Gists for an exact filename match.
4. Newly registered files are opened in tabs automatically when there is room. Click **＋** next to the tabs later to open any other registered document.

## Editing, Saving and Synchronization

- Every text input is written synchronously to `localStorage`. The toolbar's **Save** button explicitly flushes the current edit-history group and saves the workspace state; it does not upload anything to GitHub.
- Switching tabs, closing a tab, losing window focus, hiding the page, and leaving the page also flush local state.
- Undo/redo history is stored with each note and grouped by a 650 ms typing pause.
- The Find and Replace buttons are always visible in the editor toolbar when CodeMirror is available. Keyboard shortcuts remain available (`Ctrl/Cmd-F`, `Ctrl-H`, etc.).
- Tabs can be reordered by dragging with a mouse or touch. Their order is stored with the workspace.
- Closing a tab does not delete its local copy or history. Removing a document from Settings deletes its local cache and history after confirmation.
- The current defaults allow 8 open tabs and 16 registered documents. A note is limited to 32 KiB of UTF-8 text; each undo/redo stack is limited to 30 snapshots and approximately 8 KiB (a single snapshot is retained even when it is larger). These limits can be adjusted in `config.json`.
- **Pull** fetches the currently active linked document's Gist and updates only that local document. If it has local edits, the app asks before replacing them. If the remote file no longer exists, local contents are left unchanged.
- **Push** works for both local and Gist-linked documents. For a local document, it lists the Gists owned by the authenticated account, including Secret Gists, and searches for an exact filename match.
- If one matching Gist file exists, Push asks before overwriting it. If several Gists contain the same filename, you can select the target before confirming the overwrite. Other files in that Gist are preserved.
- If no matching filename exists, Push asks whether to create a Gist. You can enter an optional description and choose Secret visibility (selected by default) or Public visibility. After success, the local document is automatically linked to the new Gist.
- For an already linked document, Push retains the remote conflict check against its stored `baseContent` and asks before overwriting a newer remote version.

## Data and Privacy Notes

- A Secret Gist is unlisted, not private. Anyone with its URL may be able to access its contents. Do not use it to store passwords, private notes, or other sensitive information.
- The app stores its settings, including the GitHub token, in this browser. A token saved in the browser may be accessible to someone who can access that browser profile or its local data. Do not share your token or use it on a device you do not trust.
- Local note data is stored in the browser's local storage and is specific to the browser and website origin. Clearing browser data may remove the local copy.
- When using multiple devices, pull and push deliberately. If different devices have made changes independently, pushing one device's data may overwrite the version currently stored in the Gist. Pulling also replaces the current local data after confirmation when local edits exist.

## Technical Overview

- Frontend: HTML, CSS, and vanilla JavaScript.
- Editor: CodeMirror 5.
- Storage: Browser `localStorage` for local documents and settings.
- Synchronization: GitHub Gist REST API.
- Internationalization: Text is organized for data-driven language support.
- Deployment: Static hosting; no dedicated application server or build step is required.
- AI tools were used to assist with development.
import { config } from './config.js';
import { getLocale, setLocale, t } from './i18n.js';
import { LocalStore, StorageKeys } from './storage.js';
import { GistService } from './gist.js';

const elements = {
  appTitle: document.querySelector('#appTitle'),
  status: document.querySelector('#status'),
  undoButton: document.querySelector('#undoButton'),
  redoButton: document.querySelector('#redoButton'),
  saveButton: document.querySelector('#saveButton'),
  pullButton: document.querySelector('#pullButton'),
  pushButton: document.querySelector('#pushButton'),
  settingsButton: document.querySelector('#settingsButton'),
  tabBar: document.querySelector('#tabBar'),
  tabs: document.querySelector('#tabs'),
  newTabButton: document.querySelector('#newTabButton'),
  editorPanel: document.querySelector('#editorPanel'),
  editor: document.querySelector('#editor'),
  currentFilename: document.querySelector('#currentFilename'),
  documentState: document.querySelector('#documentState'),
  languageLabel: document.querySelector('#languageLabel'),
  linkGistButton: document.querySelector('#linkGistButton'),
  fileHint: document.querySelector('#fileHint'),
  charCount: document.querySelector('#charCount'),
  emptyState: document.querySelector('#emptyState'),
  emptyAddButton: document.querySelector('#emptyAddButton'),

  settingsDialog: document.querySelector('#settingsDialog'),
  settingsForm: document.querySelector('#settingsForm'),
  managerTitle: document.querySelector('#managerTitleInput'),
  editorFontSize: document.querySelector('#editorFontSizeInput'),
  token: document.querySelector('#tokenInput'),
  gistEntryList: document.querySelector('#gistEntryList'),
  noEntries: document.querySelector('#noEntries'),
  addGistButton: document.querySelector('#addGistButton'),
  closeSettingsButton: document.querySelector('#closeSettingsButton'),
  cancelSettingsButton: document.querySelector('#cancelSettingsButton'),

  addGistDialog: document.querySelector('#addGistDialog'),
  addGistTitle: document.querySelector('#addGistTitle'),
  addGistForm: document.querySelector('#addGistForm'),
  localFileSection: document.querySelector('#localFileSection'),
  localFilename: document.querySelector('#localFilenameInput'),
  createLocalFileButton: document.querySelector('#createLocalFileButton'),
  gistUrl: document.querySelector('#gistUrlInput'),
  loadGistButton: document.querySelector('#loadGistButton'),
  gistFilePicker: document.querySelector('#gistFilePicker'),
  availableFiles: document.querySelector('#availableFiles'),
  addGistStatus: document.querySelector('#addGistStatus'),
  addSelectedButton: document.querySelector('#addSelectedButton'),
  closeAddGistButton: document.querySelector('#closeAddGistButton'),
  cancelAddGistButton: document.querySelector('#cancelAddGistButton'),

  openDialog: document.querySelector('#openDialog'),
  openFileList: document.querySelector('#openFileList'),
  openEmptyHint: document.querySelector('#openEmptyHint'),
  openAddGistButton: document.querySelector('#openAddGistButton'),
  closeOpenDialogButton: document.querySelector('#closeOpenDialogButton'),
  cancelOpenDialogButton: document.querySelector('#cancelOpenDialogButton')
};

const LIMITS = config.limits;
const MIN_EDITOR_FONT_SIZE = 8;
const MAX_EDITOR_FONT_SIZE = 72;

let settings = {
  title: config.app.defaultTitle,
  token: '',
  editorFontSize: config.editor.fontSize,
  entries: []
};

const documents = new Map();
let openTabs = [];
let activeDocumentId = null;
let isBusy = false;
let addGistResult = null;
let linkingDocumentId = null;
let returnToSettings = false;
let settingsDraft = null;
let historyTimer = null;
let historyDocumentId = null;
let editorView = null;
let suppressEditorChange = false;

function makeDocumentId(gistId, filename) {
  return `${gistId}/${filename}`;
}

function makeLocalDocumentId() {
  const uuid = window.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return `local:${uuid}`;
}

function getRemoteFilename(entry) {
  return entry.gistFilename || entry.filename;
}

function getDocumentStorageKey(documentId) {
  return `${StorageKeys.NOTE_PREFIX}${encodeURIComponent(documentId)}`;
}

function createEmptyDocument(entry) {
  return {
    id: entry.id,
    gistId: entry.gistId ?? null,
    gistFilename: entry.gistFilename ?? null,
    filename: entry.filename,
    text: '',
    baseContent: null,
    exists: false,
    initialized: !entry.gistId,
    loadingPromise: null,
    updatedAt: null,
    revision: 0,
    externalChange: false,
    history: {
      undo: [],
      redo: []
    }
  };
}

function loadDocument(entry) {
  const saved = LocalStore.get(getDocumentStorageKey(entry.id), null);
  const doc = createEmptyDocument(entry);

  if (!saved || typeof saved !== 'object') return doc;

  doc.text = typeof saved.text === 'string' ? saved.text : '';
  doc.baseContent = typeof saved.baseContent === 'string' ? saved.baseContent : null;
  doc.exists = Boolean(saved.exists);
  doc.initialized = !entry.gistId || Boolean(saved.initialized);
  doc.updatedAt = saved.updatedAt ?? null;
  doc.revision = Number.isSafeInteger(saved.revision) ? saved.revision : 0;
  doc.history = {
    undo: Array.isArray(saved.history?.undo)
      ? saved.history.undo.filter((value) => typeof value === 'string')
      : [],
    redo: Array.isArray(saved.history?.redo)
      ? saved.history.redo.filter((value) => typeof value === 'string')
      : []
  };

  return doc;
}

function readSettings() {
  settings.title = LocalStore.getString(StorageKeys.APP_TITLE, config.app.defaultTitle)
    .trim() || config.app.defaultTitle;
  settings.token = LocalStore.getString(StorageKeys.GITHUB_TOKEN).trim();

  const savedFontSize = Number(LocalStore.get(
    StorageKeys.EDITOR_FONT_SIZE,
    config.editor.fontSize
  ));

  settings.editorFontSize = Number.isFinite(savedFontSize)
    ? Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, Math.round(savedFontSize)))
    : config.editor.fontSize;

  const savedEntries = LocalStore.get(StorageKeys.GIST_FILES, []);

  settings.entries = Array.isArray(savedEntries)
    ? savedEntries
      .filter((entry) => entry && typeof entry.filename === 'string')
      .map((entry) => {
        const gistId = typeof entry.gistId === 'string' && entry.gistId
          ? entry.gistId
          : null;

        // Keep existing document IDs. Older Gist entries did not store an ID,
        // so derive their original ID to preserve their existing local cache.
        const id = typeof entry.id === 'string' && entry.id
          ? entry.id
          : (gistId
            ? makeDocumentId(gistId, entry.filename)
            : makeLocalDocumentId());

        return {
          id,
          gistId,
          gistFilename: gistId
            ? (typeof entry.gistFilename === 'string' && entry.gistFilename
              ? entry.gistFilename
              : entry.filename)
            : null,
          filename: entry.filename
        };
      })
      .slice(0, LIMITS.maxRegisteredFiles)
    : [];

  settings.entries.forEach((entry) => {
    documents.set(entry.id, loadDocument(entry));
  });

  const savedTabs = LocalStore.get(StorageKeys.OPEN_TABS, []);
  openTabs = Array.isArray(savedTabs)
    ? [...new Set(savedTabs)].filter((id) => documents.has(id)).slice(0, LIMITS.maxOpenTabs)
    : [];

  const savedActive = LocalStore.getString(StorageKeys.ACTIVE_TAB, '');
  activeDocumentId = openTabs.includes(savedActive)
    ? savedActive
    : (openTabs.at(-1) ?? null);
}

function persistSettings() {
  return [
    LocalStore.set(StorageKeys.APP_TITLE, settings.title),
    LocalStore.set(StorageKeys.GITHUB_TOKEN, settings.token),
    LocalStore.set(StorageKeys.EDITOR_FONT_SIZE, settings.editorFontSize),
    LocalStore.set(StorageKeys.GIST_FILES, settings.entries.map((entry) => ({
      id: entry.id,
      gistId: entry.gistId,
      gistFilename: entry.gistFilename,
      filename: entry.filename
    })))
  ].every(Boolean);
}

function persistDocument(doc) {
  return LocalStore.set(getDocumentStorageKey(doc.id), {
    id: doc.id,
    gistId: doc.gistId,
    gistFilename: doc.gistFilename,
    filename: doc.filename,
    text: doc.text,
    baseContent: doc.baseContent,
    exists: doc.exists,
    initialized: doc.initialized,
    updatedAt: doc.updatedAt,
    revision: doc.revision,
    history: doc.history
  });
}

function saveWorkspace() {
  let saved = true;

  documents.forEach((doc) => {
    saved = persistDocument(doc) && saved;
  });

  saved = LocalStore.set(StorageKeys.OPEN_TABS, openTabs) && saved;
  saved = LocalStore.set(StorageKeys.ACTIVE_TAB, activeDocumentId ?? '') && saved;
  return saved;
}

function setStatus(message, type = '') {
  elements.status.textContent = message;
  elements.status.className = `status${type ? ` ${type}` : ''}`;
}

function setDialogStatus(message, type = '') {
  elements.addGistStatus.textContent = message;
  elements.addGistStatus.className = `dialog-status${type ? ` ${type}` : ''}`;
}

function setBusy(value) {
  isBusy = value;
  const hasLinkedDocuments = settings.entries.some((entry) => entry.gistId);

  elements.pullButton.disabled = value || !hasLinkedDocuments;
  elements.pushButton.disabled = value || !hasLinkedDocuments;
  elements.loadGistButton.disabled = value;
  elements.addSelectedButton.disabled = value || !addGistResult;
  elements.settingsButton.disabled = value;
  elements.newTabButton.disabled = value;
  elements.emptyAddButton.disabled = value;
  elements.openAddGistButton.disabled = value;
  elements.addGistButton.disabled = value;
  elements.createLocalFileButton.disabled = value;
}

function byteSize(value) {
  return new Blob([value]).size;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isDocumentDirty(doc) {
  if (doc.baseContent === null && !doc.exists) {
    return doc.text.length > 0;
  }

  return doc.text !== doc.baseContent;
}

function currentDocument() {
  return activeDocumentId ? documents.get(activeDocumentId) ?? null : null;
}

function getEditorValue() {
  return editorView ? editorView.getValue() : elements.editor.value;
}

function setEditorValue(value) {
  if (getEditorValue() === value) return;

  if (editorView) {
    suppressEditorChange = true;
    editorView.setValue(value);
    suppressEditorChange = false;
  } else {
    elements.editor.value = value;
  }
}

function focusEditor() {
  if (editorView) {
    editorView.focus();
  } else {
    elements.editor.focus();
  }
}

function applyEditorFontSize() {
  document.documentElement.style.setProperty(
    '--editor-font-size',
    `${settings.editorFontSize}px`
  );

  if (editorView) editorView.refresh();
}

function languageForFilename(filename) {
  const extension = filename.includes('.')
    ? filename.split('.').at(-1).toLowerCase()
    : '';

  const languages = {
    js: ['text/javascript', 'JavaScript'],
    mjs: ['text/javascript', 'JavaScript'],
    cjs: ['text/javascript', 'JavaScript'],
    jsx: ['text/jsx', 'JavaScript JSX'],
    ts: ['text/typescript', 'TypeScript'],
    tsx: ['text/typescript', 'TypeScript'],
    json: ['application/json', 'JSON'],
    html: ['text/html', 'HTML'],
    htm: ['text/html', 'HTML'],
    xml: ['application/xml', 'XML'],
    svg: ['application/xml', 'SVG'],
    css: ['text/css', 'CSS'],
    scss: ['text/x-scss', 'SCSS'],
    less: ['text/x-less', 'Less'],
    md: [{ name: 'gfm', highlightFormatting: true }, 'Markdown'],
    markdown: [{ name: 'gfm', highlightFormatting: true }, 'Markdown'],
    py: ['text/x-python', 'Python'],
    pyw: ['text/x-python', 'Python'],
    sh: ['text/x-sh', 'Shell'],
    bash: ['text/x-sh', 'Shell'],
    zsh: ['text/x-sh', 'Shell'],
    yml: ['text/x-yaml', 'YAML'],
    yaml: ['text/x-yaml', 'YAML'],
    toml: ['text/x-properties', 'TOML'],
    ini: ['text/x-properties', 'INI'],
    tres: ['text/x-properties', 'Godot Resource'],
    tscn: ['text/x-properties', 'Godot Scene'],
    godot: ['text/x-properties', 'Godot Config'],
    sql: ['text/x-sql', 'SQL'],
    c: ['text/x-csrc', 'C'],
    h: ['text/x-csrc', 'C'],
    cpp: ['text/x-c++src', 'C++'],
    hpp: ['text/x-c++src', 'C++'],
    cs: ['text/x-csharp', 'C#'],
    java: ['text/x-java', 'Java'],
    go: ['text/x-go', 'Go'],
    rs: ['text/x-rustsrc', 'Rust'],
    php: ['application/x-httpd-php', 'PHP'],
    rb: ['text/x-ruby', 'Ruby'],
    lua: ['text/x-lua', 'Lua'],
    diff: ['text/x-diff', 'Diff'],
    patch: ['text/x-diff', 'Diff'],
    txt: [null, 'Plain text'],
    log: [null, 'Plain text']
  };

  return languages[extension] ?? [null, t('languagePlainText')];
}

function updateEditorMode(doc) {
  if (!editorView) return;

  const [mode] = languageForFilename(doc.filename);
  editorView.setOption('mode', mode);
}

function initializeEditor() {
  if (!window.CodeMirror) return false;

  try {
    editorView = window.CodeMirror.fromTextArea(elements.editor, {
      mode: null,
      theme: 'default',
      lineNumbers: true,
      lineWrapping: true,
      tabSize: config.editor.tabSize,
      indentUnit: config.editor.tabSize,
      indentWithTabs: false,
      viewportMargin: 10,
      spellcheck: false,
      autocorrect: 'off',
      autocapitalize: 'off',
      extraKeys: {
        'Ctrl-S': () => saveCurrent(),
        'Cmd-S': () => saveCurrent(),
        'Ctrl-Z': () => undo(),
        'Cmd-Z': () => undo(),
        'Ctrl-Y': () => redo(),
        'Cmd-Y': () => redo(),
        'Shift-Ctrl-Z': () => redo(),
        'Cmd-Shift-Z': () => redo(),
        Tab: (cm) => cm.replaceSelection(
          ' '.repeat(config.editor.tabSize),
          'end',
          '+input'
        )
      }
    });

    editorView.setSize('100%', '100%');
    return true;
  } catch (error) {
    console.error('CodeMirror initialization failed:', error);
    editorView = null;
    return false;
  }
}

function flushHistoryGroup() {
  if (historyTimer !== null) {
    window.clearTimeout(historyTimer);
    historyTimer = null;
  }

  if (historyDocumentId) {
    const doc = documents.get(historyDocumentId);
    if (doc) persistDocument(doc);
  }

  historyDocumentId = null;
}

function trimHistory(doc, stackName) {
  const stack = doc.history[stackName];
  let totalBytes = stack.reduce((total, value) => total + byteSize(value), 0);

  while (
    stack.length > LIMITS.maxHistoryEntries
    || (stack.length > 1 && totalBytes > LIMITS.maxHistoryBytes)
  ) {
    const removed = stack.shift();
    totalBytes -= byteSize(removed);
  }
}

function updateToolbarState() {
  const doc = currentDocument();
  const hasLinkedDocuments = settings.entries.some((entry) => entry.gistId);

  elements.undoButton.disabled = !doc || doc.history.undo.length === 0;
  elements.redoButton.disabled = !doc || doc.history.redo.length === 0;
  elements.saveButton.disabled = !doc;
  elements.pullButton.disabled = isBusy || !hasLinkedDocuments;
  elements.pushButton.disabled = isBusy || !hasLinkedDocuments;
}

function updateDocumentInfo(doc) {
  if (!doc) return;

  const dirty = isDocumentDirty(doc);
  const linked = Boolean(doc.gistId);
  const remoteMissing = linked && doc.initialized && !doc.exists;
  const canLink = !linked || remoteMissing;

  elements.currentFilename.textContent = doc.filename;

  elements.documentState.textContent = dirty
    ? t('modifiedLabel')
    : (linked
      ? (doc.exists
        ? t('syncedLabel')
        : (doc.initialized ? t('remoteMissingLabel') : t('loadingLabel')))
      : t('localOnlyLabel'));

  elements.documentState.className = `document-state${dirty ? ' is-dirty' : ''}`;

  elements.languageLabel.textContent = `${t('languageLabel')}: ${languageForFilename(doc.filename)[1]}`;

  elements.linkGistButton.hidden = !canLink;
  elements.linkGistButton.textContent = remoteMissing
    ? t('relinkGistButton')
    : t('linkGistButton');

  elements.fileHint.textContent = !linked
    ? t('localOnlyHint')
    : (doc.exists
      ? (dirty ? t('statusLocalDirty') : t('statusAllSynced'))
      : (doc.initialized ? t('remoteMissingHint') : t('loadingHint')));

  elements.charCount.textContent = `${formatBytes(byteSize(doc.text))} · ${doc.text.length.toLocaleString(getLocale())} chars`;
}

function renderTabs() {
  elements.tabs.replaceChildren();

  openTabs.forEach((id) => {
    const doc = documents.get(id);
    if (!doc) return;

    const tab = document.createElement('div');
    tab.className = `tab${id === activeDocumentId ? ' active' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(id === activeDocumentId));
    tab.dataset.documentId = id;

    const select = document.createElement('button');
    select.className = 'tab-select';
    select.type = 'button';
    select.dataset.action = 'activate';
    select.dataset.documentId = id;
    select.title = doc.filename;

    const label = document.createElement('span');
    label.className = 'tab-name';
    label.textContent = doc.filename;
    select.append(label);

    if (isDocumentDirty(doc)) {
      const dirtyMark = document.createElement('span');
      dirtyMark.className = 'tab-dirty-mark';
      dirtyMark.setAttribute('aria-label', t('modifiedLabel'));
      select.append(dirtyMark);
    }

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.type = 'button';
    close.dataset.action = 'close';
    close.dataset.documentId = id;
    close.textContent = '×';
    close.title = t('closeTabTitle', { name: doc.filename });
    close.setAttribute('aria-label', close.title);

    tab.append(select, close);
    elements.tabs.append(tab);
  });
}

function renderEditor() {
  const doc = currentDocument();
  const hasDocument = Boolean(doc);

  elements.editorPanel.hidden = !hasDocument;
  elements.emptyState.hidden = hasDocument;
  elements.tabBar.hidden = false;

  if (!doc) {
    setEditorValue('');
    elements.currentFilename.textContent = '';
    elements.documentState.textContent = '';
    elements.languageLabel.textContent = '';
    elements.linkGistButton.hidden = true;
    elements.fileHint.textContent = '';
    elements.charCount.textContent = '0 B';

    if (editorView) {
      editorView.setOption('mode', null);
      requestAnimationFrame(() => editorView.refresh());
    }

    updateToolbarState();
    return;
  }

  setEditorValue(doc.text);
  updateEditorMode(doc);
  updateDocumentInfo(doc);
  updateToolbarState();

  if (editorView) {
    requestAnimationFrame(() => editorView.refresh());
  }
}

function renderSettingsEntries() {
  elements.gistEntryList.replaceChildren();
  elements.noEntries.hidden = settings.entries.length > 0;

  settings.entries.forEach((entry) => {
    const doc = documents.get(entry.id);
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    const idCell = document.createElement('td');
    const actionCell = document.createElement('td');

    const name = document.createElement('span');
    name.className = 'entry-filename';
    name.textContent = entry.filename;
    nameCell.append(name);

    if (entry.gistId) {
      const link = document.createElement('a');
      link.className = 'entry-gist-id';
      link.href = `https://gist.github.com/${encodeURIComponent(entry.gistId)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = entry.gistId;
      link.title = getRemoteFilename(entry);
      idCell.append(link);
    } else {
      const localLabel = document.createElement('span');
      localLabel.className = 'local-only-label';
      localLabel.textContent = t('localOnlyLabel');
      idCell.append(localLabel);
    }

    const actions = document.createElement('div');
    actions.className = 'entry-actions';

    const remoteMissing = Boolean(entry.gistId && doc?.initialized && !doc.exists);

    if (!entry.gistId || remoteMissing) {
      const linkButton = document.createElement('button');
      linkButton.className = 'button button-small button-warm';
      linkButton.type = 'button';
      linkButton.dataset.action = 'link-entry';
      linkButton.dataset.documentId = entry.id;
      linkButton.textContent = remoteMissing
        ? t('relinkGistButton')
        : t('linkGistButton');
      actions.append(linkButton);
    }

    const remove = document.createElement('button');
    remove.className = 'icon-button entry-remove';
    remove.type = 'button';
    remove.dataset.action = 'remove-entry';
    remove.dataset.documentId = entry.id;
    remove.textContent = '×';
    remove.title = t('removeEntryTitle', { name: entry.filename });
    remove.setAttribute('aria-label', remove.title);
    actions.append(remove);

    actionCell.append(actions);
    row.append(nameCell, idCell, actionCell);
    elements.gistEntryList.append(row);
  });
}

function renderOpenFileList() {
  elements.openFileList.replaceChildren();
  elements.openEmptyHint.hidden = settings.entries.length > 0;

  settings.entries.forEach((entry) => {
    const doc = documents.get(entry.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'open-file-item';
    button.dataset.documentId = entry.id;

    const name = document.createElement('span');
    name.className = 'open-file-name';
    name.textContent = entry.filename;

    const id = document.createElement('span');
    id.className = 'open-file-id';
    id.textContent = entry.gistId
      ? `${entry.gistId} · ${getRemoteFilename(entry)}`
      : t('localOnlyLabel');

    const state = document.createElement('span');
    state.className = `open-file-state${doc && isDocumentDirty(doc) ? ' is-dirty' : ''}`;
    state.textContent = doc && isDocumentDirty(doc)
      ? t('modifiedLabel')
      : (entry.gistId
        ? (doc?.exists ? t('syncedLabel') : (doc?.initialized ? t('remoteMissingLabel') : ''))
        : t('localOnlyLabel'));

    button.append(name, id, state);
    elements.openFileList.append(button);
  });
}

function render() {
  renderTabs();
  renderEditor();
}

function applyTitle() {
  elements.appTitle.textContent = settings.title;
  document.title = settings.title;
}

function openSettings() {
  elements.managerTitle.value = settingsDraft?.title ?? settings.title;
  elements.editorFontSize.value = String(
    settingsDraft?.editorFontSize ?? settings.editorFontSize
  );
  elements.token.value = settingsDraft?.token ?? settings.token;

  renderSettingsEntries();
  elements.settingsDialog.showModal();
}

function saveSettings(event) {
  event.preventDefault();

  const title = elements.managerTitle.value.trim();
  const editorFontSize = Number(elements.editorFontSize.value);

  if (!title) {
    setStatus(t('errorTitleRequired'), 'error');
    elements.managerTitle.focus();
    return;
  }

  if (
    !Number.isInteger(editorFontSize)
    || editorFontSize < MIN_EDITOR_FONT_SIZE
    || editorFontSize > MAX_EDITOR_FONT_SIZE
  ) {
    setStatus(t('errorEditorFontSize'), 'error');
    elements.editorFontSize.focus();
    return;
  }

  settings.title = title;
  settings.editorFontSize = editorFontSize;
  settings.token = elements.token.value.trim();
  settingsDraft = null;

  if (!persistSettings()) {
    setStatus(t('statusSaveFailed'), 'error');
    return;
  }

  applyTitle();
  applyEditorFontSize();
  elements.settingsDialog.close();
  setStatus(t('statusSettingsSaved'), 'success');
  updateToolbarState();
}

function parseGistId(value) {
  const input = String(value ?? '').trim();
  if (!input) return null;

  let candidate = input;

  try {
    if (/^https?:\/\//i.test(input)) {
      const url = new URL(input);
      if (!/(^|\.)gist\.github\.com$/i.test(url.hostname)) return null;
      candidate = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
    } else if (input.includes('/')) {
      candidate = input.split(/[/?#]/).filter(Boolean).at(-1) ?? '';
    }
  } catch {
    return null;
  }

  return /^[a-f0-9]{20,64}$/i.test(candidate) ? candidate : null;
}

function openAddGistDialog(fromSettings = false, documentId = null) {
  returnToSettings = fromSettings;
  linkingDocumentId = documentId;

  if (fromSettings && elements.settingsDialog.open) {
    settingsDraft = {
      title: elements.managerTitle.value,
      token: elements.token.value,
      editorFontSize: Number(elements.editorFontSize.value) || settings.editorFontSize
    };
    elements.settingsDialog.close();
  }

  addGistResult = null;
  elements.gistUrl.value = '';
  elements.localFilename.value = '';
  elements.availableFiles.replaceChildren();
  elements.gistFilePicker.hidden = true;
  elements.localFileSection.hidden = Boolean(linkingDocumentId);
  elements.gistUrl.disabled = false;
  elements.loadGistButton.disabled = false;
  elements.addSelectedButton.disabled = true;

  elements.addGistTitle.textContent = linkingDocumentId
    ? t('linkGistTitle')
    : t('addGistTitle');
  elements.addSelectedButton.textContent = linkingDocumentId
    ? t('linkGistButton')
    : t('addSelectedButton');

  setDialogStatus('');
  elements.addGistDialog.showModal();
  elements.gistUrl.focus();
}

function closeAddGistDialog() {
  elements.addGistDialog.close();
  addGistResult = null;
  linkingDocumentId = null;

  if (returnToSettings) {
    returnToSettings = false;
    openSettings();
  }
}

function createLocalFile() {
  if (addGistResult || linkingDocumentId) return;

  const filename = elements.localFilename.value.trim();

  if (!filename) {
    setDialogStatus(t('errorLocalFilenameRequired'), 'error');
    elements.localFilename.focus();
    return;
  }

  const invalidFilenameCharacters = /[\\/:*?"<>|\u0000-\u001f]/;

  if (
    invalidFilenameCharacters.test(filename)
    || filename === '.'
    || filename === '..'
    || /[. ]$/.test(filename)
  ) {
    setDialogStatus(t('errorInvalidLocalFilename'), 'error');
    elements.localFilename.focus();
    return;
  }

  if (settings.entries.length >= LIMITS.maxRegisteredFiles) {
    setDialogStatus(
      t('statusFileLimit', { count: LIMITS.maxRegisteredFiles }),
      'error'
    );
    return;
  }

  const duplicate = settings.entries.some((entry) => (
    !entry.gistId
    && entry.filename.toLowerCase() === filename.toLowerCase()
  ));

  if (duplicate) {
    setDialogStatus(t('errorDuplicateLocalFilename'), 'error');
    elements.localFilename.focus();
    return;
  }

  const entry = {
    id: makeLocalDocumentId(),
    gistId: null,
    gistFilename: null,
    filename
  };

  const doc = createEmptyDocument(entry);
  doc.initialized = true;

  settings.entries.push(entry);
  documents.set(entry.id, doc);

  const settingsSaved = persistSettings();
  const documentSaved = persistDocument(doc);

  const openSlot = openTabs.length < LIMITS.maxOpenTabs;

  if (openSlot) {
    openTabs.push(entry.id);
    activeDocumentId = entry.id;
  }

  const workspaceSaved = saveWorkspace();
  const saved = settingsSaved && documentSaved && workspaceSaved;

  renderSettingsEntries();
  render();
  updateToolbarState();
  closeAddGistDialog();

  setStatus(
    !saved
      ? t('statusSaveFailed')
      : (openSlot
        ? t('statusLocalFileCreated', { name: filename })
        : t('statusLocalFileCreatedClosed', { name: filename })),
    saved ? 'success' : 'error'
  );
}

async function loadGistFiles() {
  const gistId = parseGistId(elements.gistUrl.value);

  if (!gistId) {
    setDialogStatus(t('errorGistIdRequired'), 'error');
    elements.gistUrl.focus();
    return;
  }

  addGistResult = null;
  elements.gistFilePicker.hidden = true;
  elements.availableFiles.replaceChildren();
  elements.localFileSection.hidden = true;
  elements.gistUrl.disabled = true;
  elements.loadGistButton.disabled = true;
  elements.addSelectedButton.disabled = true;
  setDialogStatus(t('statusPulling'));

  try {
    const gist = await GistService.readGist(
      gistId,
      settingsDraft?.token?.trim() || settings.token
    );

    if (!gist.files.length) {
      throw new Error(t('errorGistFilesEmpty'));
    }

    addGistResult = gist;
    elements.availableFiles.replaceChildren();

    gist.files.forEach((file) => {
      const label = document.createElement('label');
      label.className = 'gist-file-option';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = file.filename;
      checkbox.dataset.filename = file.filename;

      const tooLarge = file.size > LIMITS.maxDocumentBytes
        || (typeof file.content === 'string'
          && byteSize(file.content) > LIMITS.maxDocumentBytes);

      checkbox.disabled = file.truncated || file.content === null || tooLarge;

      const info = document.createElement('span');
      info.className = 'gist-file-info';

      const filename = document.createElement('strong');
      filename.textContent = file.filename;

      const metadata = document.createElement('small');
      metadata.textContent = file.truncated || file.content === null
        ? t('statusFileTruncated', { name: file.filename })
        : (tooLarge
          ? t('statusFileTooLarge', {
            size: formatBytes(LIMITS.maxDocumentBytes)
          })
          : formatBytes(file.size || byteSize(file.content)));

      info.append(filename, metadata);
      label.append(checkbox, info);
      elements.availableFiles.append(label);
    });

    elements.gistFilePicker.hidden = false;
    elements.addSelectedButton.disabled = false;

    setDialogStatus(
      t('statusGistLoaded', { count: gist.files.length }),
      'success'
    );
  } catch (error) {
    addGistResult = null;
    elements.localFileSection.hidden = Boolean(linkingDocumentId);

    setDialogStatus(
      error?.message || t('errorGistNotFound'),
      'error'
    );
  } finally {
    elements.gistUrl.disabled = false;
    elements.loadGistButton.disabled = false;
    elements.addSelectedButton.disabled = !addGistResult;
  }
}

function getGistFile(gist, filename) {
  return gist?.files?.find((file) => file.filename === filename) ?? null;
}

function initializeDocumentFromFile(doc, file, gist, preserveLocal = false) {
  if (!file) {
    doc.initialized = true;
    doc.updatedAt = gist.updatedAt;

    if (!preserveLocal) {
      doc.text = '';
      doc.history = { undo: [], redo: [] };
    }

    doc.baseContent = null;
    doc.exists = false;
    return;
  }

  // Validate the remote payload before marking the document initialized.
  // A failed first load must remain retryable when the tab is opened again.
  if (file.truncated || file.content === null) {
    throw new Error(t('statusFileTruncated', { name: file.filename }));
  }

  if (byteSize(file.content) > LIMITS.maxDocumentBytes) {
    throw new Error(t('statusFileTooLarge', {
      size: formatBytes(LIMITS.maxDocumentBytes)
    }));
  }

  doc.initialized = true;
  doc.updatedAt = gist.updatedAt;

  if (!preserveLocal) {
    doc.text = file.content;
    doc.history = { undo: [], redo: [] };
  }

  doc.baseContent = file.content;
  doc.exists = true;
}

function addSelectedGistFiles(event) {
  event.preventDefault();

  if (!addGistResult) {
    setDialogStatus(t('errorGistIdRequired'), 'error');
    return;
  }

  const selectedNames = [
    ...elements.availableFiles.querySelectorAll('input[type="checkbox"]:checked')
  ].map((input) => input.value);

  if (!selectedNames.length) {
    setDialogStatus(t('errorFilenameRequired'), 'error');
    return;
  }

  // Link an existing local document instead of creating a new document.
  if (linkingDocumentId) {
    if (selectedNames.length !== 1) {
      setDialogStatus(t('errorSelectOneGistFile'), 'error');
      return;
    }

    const entry = settings.entries.find((item) => item.id === linkingDocumentId);
    const doc = documents.get(linkingDocumentId);
    const remoteFilename = selectedNames[0];

    if (!entry || !doc || (entry.gistId && doc.exists)) {
      setDialogStatus(t('errorLocalDocumentUnavailable'), 'error');
      return;
    }

    const duplicate = settings.entries.some((item) => (
      item.id !== entry.id
      && item.gistId === addGistResult.id
      && getRemoteFilename(item) === remoteFilename
    ));

    if (duplicate) {
      setDialogStatus(t('errorGistFileAlreadyLinked'), 'error');
      return;
    }

    const file = getGistFile(addGistResult, remoteFilename);

    if (!file || file.truncated || file.content === null) {
      setDialogStatus(
        t('statusFileTruncated', { name: remoteFilename }),
        'error'
      );
      return;
    }

    if (byteSize(file.content) > LIMITS.maxDocumentBytes) {
      setDialogStatus(t('statusFileTooLarge', {
        size: formatBytes(LIMITS.maxDocumentBytes)
      }), 'error');
      return;
    }

    // Keep the local ID, filename, text and history.
    // Only attach the remote Gist identity and its current base content.
    entry.gistId = addGistResult.id;
    entry.gistFilename = remoteFilename;

    doc.gistId = addGistResult.id;
    doc.gistFilename = remoteFilename;
    doc.baseContent = file.content;
    doc.exists = true;
    doc.initialized = true;
    doc.updatedAt = addGistResult.updatedAt;

    const saved = persistSettings()
      && persistDocument(doc)
      && saveWorkspace();

    renderSettingsEntries();
    render();
    updateToolbarState();
    closeAddGistDialog();

    setStatus(
      saved
        ? t('statusLocalFileLinked', {
          name: doc.filename,
          remote: remoteFilename
        })
        : t('statusSaveFailed'),
      saved ? 'success' : 'error'
    );
    return;
  }

  // Register one or more files that already exist in a Gist.
  const additions = [];
  const duplicates = [];

  for (const filename of [...new Set(selectedNames)]) {
    const alreadyRegistered = settings.entries.some((entry) => (
      entry.gistId === addGistResult.id
      && getRemoteFilename(entry) === filename
    ));

    if (alreadyRegistered) {
      duplicates.push(filename);
      continue;
    }

    const file = getGistFile(addGistResult, filename);
    if (!file) continue;

    const id = makeDocumentId(addGistResult.id, filename);
    const entry = {
      id,
      gistId: addGistResult.id,
      gistFilename: filename,
      filename
    };
    const doc = createEmptyDocument(entry);

    try {
      initializeDocumentFromFile(doc, file, addGistResult);
    } catch (error) {
      setDialogStatus(error.message, 'error');
      return;
    }

    additions.push({ entry, doc });
  }

  if (!additions.length) {
    setDialogStatus(
      duplicates.length
        ? t('errorDuplicateEntry')
        : t('errorFilenameRequired'),
      'error'
    );
    return;
  }

  if (settings.entries.length + additions.length > LIMITS.maxRegisteredFiles) {
    setDialogStatus(
      t('statusFileLimit', { count: LIMITS.maxRegisteredFiles }),
      'error'
    );
    return;
  }

  additions.forEach(({ entry, doc }) => {
    settings.entries.push(entry);
    documents.set(entry.id, doc);
    persistDocument(doc);
  });

  if (!persistSettings()) {
    setDialogStatus(t('statusSaveFailed'), 'error');
    return;
  }

  const count = additions.length;
  const openSlots = Math.max(0, LIMITS.maxOpenTabs - openTabs.length);
  const opened = additions.slice(0, openSlots);

  opened.forEach(({ entry }) => openTabs.push(entry.id));
  if (opened.length) activeDocumentId = opened.at(-1).entry.id;

  const workspaceSaved = saveWorkspace();
  const statusMessage = opened.length < count
    ? t('statusFileAddedTabs', { count, opened: opened.length })
    : t('statusFileAdded', { count });

  renderSettingsEntries();
  render();
  updateToolbarState();
  closeAddGistDialog();

  setStatus(
    workspaceSaved ? statusMessage : t('statusSaveFailed'),
    workspaceSaved ? 'success' : 'error'
  );
}

function removeGistEntry(documentId) {
  const entry = settings.entries.find((item) => item.id === documentId);
  if (!entry) return;

  flushHistoryGroup();

  if (!window.confirm(t('removeEntryConfirm', { name: entry.filename }))) return;

  settings.entries = settings.entries.filter((item) => item.id !== documentId);
  documents.delete(documentId);
  LocalStore.remove(getDocumentStorageKey(documentId));

  if (openTabs.includes(documentId)) {
    openTabs = openTabs.filter((id) => id !== documentId);
  }

  if (activeDocumentId === documentId) {
    activeDocumentId = openTabs.at(-1) ?? null;
  }

  persistSettings();
  saveWorkspace();
  renderSettingsEntries();
  render();
  updateToolbarState();
  setStatus(t('statusEntryRemoved'), 'success');
}

function openFileChooser() {
  renderOpenFileList();
  elements.openDialog.showModal();
}

async function hydrateDocument(doc) {
  if (!doc.gistId || doc.initialized) return;
  if (doc.loadingPromise) return doc.loadingPromise;

  const startRevision = doc.revision;

  doc.loadingPromise = (async () => {
    try {
      const gist = await GistService.readGist(doc.gistId, settings.token);
      const file = getGistFile(gist, doc.gistFilename || doc.filename);

      // Preserve keystrokes entered while the first remote read was in flight.
      initializeDocumentFromFile(
        doc,
        file,
        gist,
        doc.revision !== startRevision
      );

      persistDocument(doc);

      if (activeDocumentId === doc.id) {
        render();
        setStatus(t('statusFileLoaded', { name: doc.filename }), 'success');
      }
    } catch (error) {
      // Keep the document uninitialized so a later open can retry a failed request.
      if (activeDocumentId === doc.id) {
        render();
        setStatus(error?.message || t('errorGistNotFound'), 'error');
      }
    }
  })();

  try {
    await doc.loadingPromise;
  } finally {
    doc.loadingPromise = null;
  }
}

async function openDocument(documentId) {
  const doc = documents.get(documentId);
  if (!doc) return;

  flushHistoryGroup();
  saveWorkspace();

  if (!openTabs.includes(documentId)) {
    if (openTabs.length >= LIMITS.maxOpenTabs) {
      setStatus(t('statusTabLimit', { count: LIMITS.maxOpenTabs }), 'warning');
      return;
    }

    openTabs.push(documentId);
  }

  activeDocumentId = documentId;
  elements.openDialog.close();

  render();
  saveWorkspace();

  if (doc.gistId && !doc.initialized) {
    setStatus(t('statusPulling'));
    await hydrateDocument(doc);
  }

  if (activeDocumentId === documentId) {
    focusEditor();
  }
}

function closeTab(documentId) {
  flushHistoryGroup();
  openTabs = openTabs.filter((id) => id !== documentId);

  if (activeDocumentId === documentId) {
    activeDocumentId = openTabs.at(-1) ?? null;
  }

  saveWorkspace();
  render();
}

function recordInput(doc, value) {
  if (value === doc.text) return;

  if (byteSize(value) > LIMITS.maxDocumentBytes) {
    setEditorValue(doc.text);
    setStatus(t('statusFileTooLarge', {
      size: formatBytes(LIMITS.maxDocumentBytes)
    }), 'error');
    return;
  }

  if (historyDocumentId !== doc.id || historyTimer === null) {
    flushHistoryGroup();
    doc.history.undo.push(doc.text);
    trimHistory(doc, 'undo');
    doc.history.redo = [];
    historyDocumentId = doc.id;
  }

  doc.text = value;
  doc.revision += 1;
  doc.externalChange = false;

  if (historyTimer !== null) window.clearTimeout(historyTimer);

  historyTimer = window.setTimeout(() => {
    historyTimer = null;
    historyDocumentId = null;
    persistDocument(doc);
    updateToolbarState();
  }, LIMITS.historyGroupDelayMs);

  const saved = persistDocument(doc);
  renderTabs();
  updateDocumentInfo(doc);
  updateToolbarState();

  if (saved) {
    setStatus(isDocumentDirty(doc) ? t('statusLocalDirty') : t('statusAllSynced'));
  } else {
    setStatus(t('statusSaveFailed'), 'error');
  }
}

function replaceDocumentText(doc, value) {
  doc.text = value;
  doc.revision += 1;
  doc.externalChange = false;

  setEditorValue(value);
  updateDocumentInfo(doc);
  renderTabs();
  updateToolbarState();
  persistDocument(doc);
  saveWorkspace();
}

function undo() {
  const doc = currentDocument();
  if (!doc) return;

  flushHistoryGroup();

  if (!doc.history.undo.length) {
    setStatus(t('historyUndoEmpty'));
    return;
  }

  doc.history.redo.push(doc.text);
  trimHistory(doc, 'redo');
  replaceDocumentText(doc, doc.history.undo.pop());
  setStatus(isDocumentDirty(doc) ? t('statusLocalDirty') : t('statusAllSynced'));
}

function redo() {
  const doc = currentDocument();
  if (!doc) return;

  flushHistoryGroup();

  if (!doc.history.redo.length) {
    setStatus(t('historyRedoEmpty'));
    return;
  }

  doc.history.undo.push(doc.text);
  trimHistory(doc, 'undo');
  replaceDocumentText(doc, doc.history.redo.pop());
  setStatus(isDocumentDirty(doc) ? t('statusLocalDirty') : t('statusAllSynced'));
}

function saveCurrent() {
  const doc = currentDocument();
  if (!doc) return;

  flushHistoryGroup();

  const saved = persistDocument(doc) && saveWorkspace();

  setStatus(
    saved
      ? (isDocumentDirty(doc) ? t('statusSaved') : t('statusAllSynced'))
      : t('statusSaveFailed'),
    saved ? 'success' : 'error'
  );
}

function insertTab() {
  if (editorView) {
    editorView.replaceSelection(
      ' '.repeat(config.editor.tabSize),
      'end',
      '+input'
    );
    return;
  }

  const editor = elements.editor;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const before = editor.value.slice(0, start);
  const after = editor.value.slice(end);
  const spaces = ' '.repeat(config.editor.tabSize);

  editor.setRangeText(spaces, start, end, 'end');
  recordInput(currentDocument(), `${before}${spaces}${after}`);
}

function onEditorKeydown(event) {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const modifier = isMac ? event.metaKey : event.ctrlKey;

  if (modifier && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveCurrent();
  } else if (modifier && event.key.toLowerCase() === 'z' && !event.shiftKey) {
    event.preventDefault();
    undo();
  } else if (
    (modifier && event.key.toLowerCase() === 'y')
    || (modifier && event.key.toLowerCase() === 'z' && event.shiftKey)
  ) {
    event.preventDefault();
    redo();
  } else if (event.key === 'Tab') {
    event.preventDefault();
    insertTab();
  }
}

async function fetchGists(gistIds) {
  const uniqueIds = [...new Set(gistIds.filter(Boolean))];

  const pairs = await Promise.all(uniqueIds.map(async (id) => [
    id,
    await GistService.readGist(id, settings.token)
  ]));

  return new Map(pairs);
}

function getRemoteContent(gist, filename) {
  const file = getGistFile(gist, filename);

  if (!file) {
    return { exists: false, content: null, file: null };
  }

  if (file.truncated || file.content === null) {
    throw new Error(t('statusFileTruncated', { name: filename }));
  }

  if (byteSize(file.content) > LIMITS.maxDocumentBytes) {
    throw new Error(t('statusFileTooLarge', {
      size: formatBytes(LIMITS.maxDocumentBytes)
    }));
  }

  return {
    exists: true,
    content: file.content,
    file
  };
}

async function pullAll() {
  if (isBusy) return;

  const linkedEntries = settings.entries.filter((entry) => entry.gistId);

  if (!linkedEntries.length) {
    setStatus(t('statusNoLinkedFiles'));
    return;
  }

  flushHistoryGroup();
  saveWorkspace();
  setBusy(true);
  setStatus(t('statusPulling'));

  const startRevisions = new Map(linkedEntries.map((entry) => [
    entry.id,
    documents.get(entry.id)?.revision ?? 0
  ]));

  try {
    const gists = await fetchGists(linkedEntries.map((entry) => entry.gistId));
    const incoming = [];
    const missing = [];

    for (const entry of linkedEntries) {
      const doc = documents.get(entry.id);
      const gist = gists.get(entry.gistId);
      const remote = getRemoteContent(gist, getRemoteFilename(entry));

      if (!remote.exists) {
        missing.push(entry.filename);
        doc.exists = false;
        doc.initialized = true;
        doc.updatedAt = gist.updatedAt;
        continue;
      }

      incoming.push({
        entry,
        doc,
        gist,
        content: remote.content
      });
    }

    for (const item of incoming) {
      if (item.doc.revision !== startRevisions.get(item.entry.id)) {
        throw new Error(t('errorLocalChangedDuringPull'));
      }
    }

    const localEdits = incoming.filter(({ doc }) => isDocumentDirty(doc));

    if (localEdits.length) {
      const names = localEdits.map(({ entry }) => entry.filename).join(', ');

      if (!window.confirm(t('statusPullConflict', { files: names }))) {
        setStatus(t('statusSyncCancelled'));
        return;
      }
    }

    incoming.forEach(({ doc, content, gist }) => {
      doc.text = content;
      doc.baseContent = content;
      doc.exists = true;
      doc.initialized = true;
      doc.updatedAt = gist.updatedAt;
      doc.revision += 1;
      doc.externalChange = false;
      doc.history = { undo: [], redo: [] };
    });

    const saved = saveWorkspace();
    render();

    let message = t('statusPullSuccess', { count: incoming.length });

    if (missing.length) {
      message += ` ${t('statusPullMissing', { files: missing.join(', ') })}`;
    }

    setStatus(saved ? message : t('statusSaveFailed'), saved ? 'success' : 'error');
  } catch (error) {
    setStatus(
      t('statusPullFailed', { error: error?.message || t('unknownError') }),
      'error'
    );
  } finally {
    setBusy(false);
    updateToolbarState();
  }
}

async function pushAll() {
  if (isBusy) return;

  const linkedEntries = settings.entries.filter((entry) => entry.gistId);

  if (!linkedEntries.length) {
    setStatus(t('statusNoLinkedFiles'));
    return;
  }

  if (!settings.token) {
    setStatus(t('errorTokenRequired'), 'error');
    return;
  }

  flushHistoryGroup();
  saveWorkspace();

  const dirtyEntries = linkedEntries.filter((entry) => {
    const doc = documents.get(entry.id);
    return doc && isDocumentDirty(doc);
  });

  if (!dirtyEntries.length) {
    setStatus(t('statusNoPushChanges'), 'success');
    return;
  }

  setBusy(true);
  setStatus(t('statusPushing'));

  try {
    const gists = await fetchGists(dirtyEntries.map((entry) => entry.gistId));
    const conflicts = [];
    const missing = [];
    const snapshots = new Map();

    for (const entry of dirtyEntries) {
      const doc = documents.get(entry.id);
      const gist = gists.get(entry.gistId);
      const remote = getRemoteContent(gist, getRemoteFilename(entry));

      if (!remote.exists) {
        missing.push(entry.filename);
        doc.exists = false;
        doc.initialized = true;
        doc.updatedAt = gist.updatedAt;
        continue;
      }

      if (remote.content !== doc.baseContent) {
        conflicts.push(entry.filename);
      }

      snapshots.set(entry.id, doc.text);
    }

    if (missing.length) {
      throw new Error(t('statusPushMissing', { files: missing.join(', ') }));
    }

    if (conflicts.length) {
      const names = conflicts.join(', ');

      if (!window.confirm(t('statusPushConflict', { files: names }))) {
        setStatus(t('statusSyncCancelled'));
        return;
      }
    }

    const grouped = new Map();

    dirtyEntries.forEach((entry) => {
      if (!grouped.has(entry.gistId)) grouped.set(entry.gistId, {});
      grouped.get(entry.gistId)[getRemoteFilename(entry)] = snapshots.get(entry.id);
    });

    const results = await Promise.all([...grouped.entries()].map(async ([gistId, files]) => [
      gistId,
      await GistService.writeFiles(gistId, settings.token, files)
    ]));

    const resultByGist = new Map(results);

    dirtyEntries.forEach((entry) => {
      const doc = documents.get(entry.id);
      const pushedText = snapshots.get(entry.id);

      doc.baseContent = pushedText;
      doc.exists = true;
      doc.initialized = true;
      doc.updatedAt = resultByGist.get(entry.gistId)?.updated_at ?? doc.updatedAt;
      doc.externalChange = false;
    });

    const saved = saveWorkspace();
    render();

    const hasNewerEdits = dirtyEntries.some((entry) => {
      const doc = documents.get(entry.id);
      return doc.text !== snapshots.get(entry.id);
    });

    setStatus(
      !saved
        ? t('statusSaveFailed')
        : (hasNewerEdits
          ? t('statusPushOutdated')
          : t('statusPushSuccess', { count: dirtyEntries.length })),
      !saved ? 'error' : (hasNewerEdits ? 'warning' : 'success')
    );
  } catch (error) {
    setStatus(
      t('statusPushFailed', { error: error?.message || t('unknownError') }),
      'error'
    );
  } finally {
    setBusy(false);
    updateToolbarState();
  }
}

function handleStorageChange(event) {
  if (!event.key?.startsWith(StorageKeys.NOTE_PREFIX)) return;

  let documentId;

  try {
    documentId = decodeURIComponent(event.key.slice(StorageKeys.NOTE_PREFIX.length));
  } catch {
    return;
  }

  const doc = documents.get(documentId);
  if (!doc || !event.newValue) return;

  let incoming;

  try {
    incoming = JSON.parse(event.newValue);
  } catch {
    return;
  }

  if (typeof incoming?.text !== 'string' || incoming.text === doc.text) return;

  if (isDocumentDirty(doc)) {
    doc.externalChange = true;

    if (activeDocumentId === doc.id) {
      setStatus(t('statusStorageChanged'), 'warning');
      elements.documentState.textContent = t('statusStorageChanged');
      elements.documentState.classList.add('is-warning');
    }

    return;
  }

  const entry = settings.entries.find((item) => item.id === doc.id);
  if (!entry) return;

  const updated = loadDocument(entry);
  documents.set(doc.id, updated);

  if (activeDocumentId === doc.id) render();
}

function bindEvents() {
  elements.undoButton.addEventListener('click', undo);
  elements.redoButton.addEventListener('click', redo);
  elements.saveButton.addEventListener('click', saveCurrent);
  elements.pullButton.addEventListener('click', pullAll);
  elements.pushButton.addEventListener('click', pushAll);
  elements.settingsButton.addEventListener('click', openSettings);
  elements.newTabButton.addEventListener('click', openFileChooser);
  elements.emptyAddButton.addEventListener('click', () => openAddGistDialog(false));

  elements.linkGistButton.addEventListener('click', () => {
    const doc = currentDocument();
    if (doc) openAddGistDialog(false, doc.id);
  });

  if (editorView) {
    editorView.on('change', () => {
      if (suppressEditorChange) return;

      const doc = currentDocument();
      if (doc) recordInput(doc, editorView.getValue());
    });

    editorView.on('blur', () => {
      flushHistoryGroup();

      const doc = currentDocument();
      if (doc) persistDocument(doc);
    });
  } else {
    elements.editor.addEventListener('input', () => {
      const doc = currentDocument();
      if (doc) recordInput(doc, elements.editor.value);
    });

    elements.editor.addEventListener('blur', () => {
      flushHistoryGroup();

      const doc = currentDocument();
      if (doc) persistDocument(doc);
    });

    elements.editor.addEventListener('keydown', onEditorKeydown);
  }

  elements.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const documentId = button.dataset.documentId;

    if (button.dataset.action === 'activate') openDocument(documentId);
    if (button.dataset.action === 'close') closeTab(documentId);
  });

  elements.settingsForm.addEventListener('submit', saveSettings);

  elements.closeSettingsButton.addEventListener('click', () => {
    settingsDraft = null;
    elements.settingsDialog.close();
  });

  elements.cancelSettingsButton.addEventListener('click', () => {
    settingsDraft = null;
    elements.settingsDialog.close();
  });

  elements.addGistButton.addEventListener('click', () => {
    openAddGistDialog(true);
  });

  elements.gistEntryList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const documentId = button.dataset.documentId;

    if (button.dataset.action === 'remove-entry') {
      removeGistEntry(documentId);
    }

    if (button.dataset.action === 'link-entry') {
      openAddGistDialog(true, documentId);
    }
  });

  elements.createLocalFileButton.addEventListener('click', createLocalFile);
  elements.loadGistButton.addEventListener('click', loadGistFiles);
  elements.addGistForm.addEventListener('submit', addSelectedGistFiles);
  elements.closeAddGistButton.addEventListener('click', closeAddGistDialog);
  elements.cancelAddGistButton.addEventListener('click', closeAddGistDialog);

  elements.localFilename.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter'
      && !addGistResult
      && !linkingDocumentId
    ) {
      event.preventDefault();
      createLocalFile();
    }
  });

  elements.gistUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadGistFiles();
    }
  });

  elements.openFileList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-document-id]');
    if (button) openDocument(button.dataset.documentId);
  });

  elements.closeOpenDialogButton.addEventListener('click', () => {
    elements.openDialog.close();
  });

  elements.cancelOpenDialogButton.addEventListener('click', () => {
    elements.openDialog.close();
  });

  elements.openAddGistButton.addEventListener('click', () => {
    elements.openDialog.close();
    openAddGistDialog(false);
  });

  window.addEventListener('storage', handleStorageChange);

  window.addEventListener('resize', () => {
    if (editorView) editorView.refresh();
  });

  window.addEventListener('pagehide', () => {
    flushHistoryGroup();
    saveWorkspace();
  });

  window.addEventListener('blur', () => {
    flushHistoryGroup();
    saveWorkspace();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushHistoryGroup();
      saveWorkspace();
    }
  });
}

async function restoreOpenTabs() {
  render();

  const toHydrate = openTabs
    .map((id) => documents.get(id))
    .filter((doc) => doc && doc.gistId && !doc.initialized);

  if (!toHydrate.length) return;

  const ids = [...new Set(toHydrate.map((doc) => doc.gistId))];
  const startRevisions = new Map(toHydrate.map((doc) => [doc.id, doc.revision]));

  try {
    const gists = await fetchGists(ids);
    const errors = [];

    for (const doc of toHydrate) {
      const gist = gists.get(doc.gistId);

      try {
        initializeDocumentFromFile(
          doc,
          getGistFile(gist, doc.gistFilename || doc.filename),
          gist,
          doc.revision !== startRevisions.get(doc.id)
        );

        persistDocument(doc);
      } catch (error) {
        errors.push(`${doc.filename}: ${error?.message || t('unknownError')}`);
      }
    }

    render();

    if (errors.length) {
      setStatus(errors.join(' · '), 'error');
    }
  } catch (error) {
    setStatus(error?.message || t('errorGistNotFound'), 'error');
  }
}

function init() {
  setLocale(LocalStore.getString(StorageKeys.LOCALE, config.i18n.defaultLocale));
  readSettings();
  applyTitle();
  applyEditorFontSize();

  const editorReady = initializeEditor();

  bindEvents();
  render();
  updateToolbarState();
  restoreOpenTabs();

  if (!editorReady) {
    setStatus(t('statusEditorFallback'), 'warning');
  } else if (!settings.entries.length || !openTabs.length) {
    setStatus(t('statusReady'));
  }
}

init();
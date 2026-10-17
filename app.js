(function () {
  const STORAGE_KEY = 'cv-editor.v1';
  const SECTION_TYPES = {
    publication: 'Publications (APA, structured)',
    presentation: 'Presentations (APA, structured)',
    dated: 'Dated rows (date + description)',
    teaching: 'Teaching',
    text: 'Paragraph',
    list: 'Simple list',
  };
  const STATUS_OPTIONS = [
    ['published', 'Published'],
    ['in-press', 'In press'],
    ['revision', 'Revision submitted'],
    ['submitted', 'Initial submission'],
    ['in-prep', 'In preparation'],
  ];

  // Field definitions per entry type: [key, label, kind, wide?]
  const FIELDS = {
    publication: [
      ['authors', 'Authors (APA, comma separated)', 'text', true],
      ['year', 'Year', 'text'],
      ['status', 'Status', 'status'],
      ['title', 'Title', 'area', true],
      ['venue', 'Journal', 'text', true],
    ],
    presentation: [
      ['authors', 'Authors', 'text', true],
      ['date', 'Date (e.g., 2026, February 26-28)', 'text', true],
      ['title', 'Title', 'area', true],
      ['kind', 'Type (e.g., Poster presentation)', 'text'],
      ['venue', 'Conference, location', 'text', true],
    ],
    dated: [
      ['date', 'Date', 'text'],
      ['lines', 'Description (one line per row)', 'lines', true],
    ],
    teaching: [
      ['role', 'Role', 'text'],
      ['term', 'Term', 'text'],
      ['institution', 'Institution', 'text', true],
      ['course', 'Course', 'text', true],
      ['rating', 'Overall rating (of 5.00)', 'text'],
      ['deptMean', 'Department mean', 'text'],
    ],
    text: [['text', 'Text', 'area', true]],
    list: [['text', 'Item', 'text', true]],
  };

  const clone = o => JSON.parse(JSON.stringify(o));
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k);
    return n;
  };

  // ---- state ----
  let cv = load();
  const openSections = new Set(['publications']);
  let previewTimer;
  let statusTimer;

  function valid(data) {
    return data && data.header && Array.isArray(data.sections) &&
      data.sections.every(s => FIELDS[s.type] && Array.isArray(s.entries) && typeof s.title === 'string');
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (valid(saved)) return saved;
    } catch (e) { /* fall through to seed */ }
    return clone(window.CV_SEED);
  }

  function save() {
    markEdited();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cv));
      flash('Saved in this browser');
    } catch (e) {
      flash('Could not save to browser storage; use "Save backup"');
    }
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
    scheduleFileWrite();
    scheduleGhPush();
  }

  function flash(msg) {
    const s = document.getElementById('status');
    s.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { s.textContent = ''; }, 2500);
  }

  // ---- backup tracking & linked file ----
  // localStorage is wiped by "clear cookies and site data", so the real copy is a
  // file: either a linked file (Chrome/Edge) or a downloaded JSON backup.
  const EDITED_KEY = 'cv-editor.editedAt';
  const BACKUP_KEY = 'cv-editor.backedUpAt';
  const CAN_LINK = typeof window.showSaveFilePicker === 'function';
  let fileHandle = null;       // FileSystemFileHandle once linked
  let fileState = 'none';      // none | needs-permission | ok | error
  let fileTimer;
  let lastSyncedAt = null;

  const lsGet = k => { try { return Number(localStorage.getItem(k)) || 0; } catch (e) { return 0; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } };
  let editedAt = lsGet(EDITED_KEY);
  let backedUpAt = lsGet(BACKUP_KEY);

  const isDirty = () => editedAt > backedUpAt;

  function markEdited() {
    editedAt = Date.now();
    lsSet(EDITED_KEY, editedAt);
    renderBackupStatus();
  }

  function markBackedUp(at = editedAt) {
    backedUpAt = Math.max(backedUpAt, at);
    lsSet(BACKUP_KEY, backedUpAt);
    renderBackupStatus();
  }

  const idb = {
    open: () => new Promise((resolve, reject) => {
      const req = indexedDB.open('cv-editor', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
    async get(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    },
    async set(key, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    },
  };

  function renderBackupStatus() {
    const node = document.getElementById('backup');
    const linkBtn = document.getElementById('btn-link');
    if (!node) return;
    let text;
    let level = 'ok';
    if (ghState === 'ok' && !isDirty()) {
      text = `Synced to GitHub (${gh.repo}@${gh.branch})` + (ghSyncedAt ? ` at ${ghSyncedAt.toLocaleTimeString()}` : '');
    } else if (ghState === 'syncing' || (ghState === 'ok' && isDirty())) {
      text = 'Syncing to GitHub...';
    } else if (ghState === 'error') {
      text = `GitHub sync failed: ${ghError}`;
      level = 'warn';
    } else if (fileState === 'ok') {
      text = `Auto-saving to ${fileHandle.name}` + (lastSyncedAt ? ` (last ${lastSyncedAt.toLocaleTimeString()})` : '');
    } else if (fileState === 'needs-permission') {
      text = `Backup file ${fileHandle.name} disconnected: click "Reconnect"`;
      level = 'warn';
    } else if (fileState === 'error') {
      text = 'Could not write the backup file; use "Save backup"';
      level = 'warn';
    } else if (isDirty()) {
      text = 'Edits only in this browser, not backed up';
      level = 'warn';
    } else {
      text = backedUpAt ? `Backed up ${new Date(backedUpAt).toLocaleString()}` : 'No edits yet';
    }
    node.textContent = text;
    node.dataset.level = level;
    renderGhStatus();
    if (CAN_LINK) {
      linkBtn.hidden = false;
      linkBtn.textContent = fileState === 'needs-permission' ? 'Reconnect backup file'
        : fileState === 'ok' ? 'Change backup file' : 'Link backup file';
    }
  }

  function scheduleFileWrite() {
    if (!fileHandle || fileState !== 'ok') return;
    clearTimeout(fileTimer);
    fileTimer = setTimeout(writeLinkedFile, 800);
  }

  async function writeLinkedFile() {
    if (!fileHandle) return;
    const at = editedAt;
    try {
      const w = await fileHandle.createWritable();
      await w.write(JSON.stringify(cv, null, 1));
      await w.close();
      lastSyncedAt = new Date();
      fileState = 'ok';
      markBackedUp(at);
    } catch (e) {
      fileState = 'error';
      renderBackupStatus();
    }
  }

  async function linkBackupFile() {
    try {
      if (fileHandle && fileState === 'needs-permission') {
        if ((await fileHandle.requestPermission({ mode: 'readwrite' })) === 'granted') {
          fileState = 'ok';
          await reconcileWithFile();
          return;
        }
      }
      const handle = await window.showSaveFilePicker({
        suggestedName: 'cv-data.json',
        types: [{ description: 'CV data', accept: { 'application/json': ['.json'] } }],
      });
      fileHandle = handle;
      fileState = 'ok';
      await idb.set('handle', handle).catch(() => {});
      await reconcileWithFile();
    } catch (e) {
      if (e.name !== 'AbortError') alert('Could not link the file: ' + e.message);
    }
  }

  // If the chosen file already holds a CV, the user decides which copy wins, so an
  // existing backup is never overwritten silently.
  async function reconcileWithFile() {
    let existing = null;
    try {
      const text = await (await fileHandle.getFile()).text();
      if (text.trim()) existing = JSON.parse(text);
    } catch (e) { existing = null; }
    if (valid(existing) && JSON.stringify(existing) !== JSON.stringify(cv)) {
      if (confirm(`${fileHandle.name} already contains a CV.\n\nOK = load it (replaces what is in the editor)\nCancel = overwrite the file with the editor's current CV`)) {
        cv = existing;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cv)); } catch (e) { /* ignore */ }
        renderEditor();
        renderPreview();
      }
    }
    await writeLinkedFile();
  }

  async function restoreLinkedFile() {
    if (!CAN_LINK) return;
    try {
      const handle = await idb.get('handle');
      if (!handle) return;
      fileHandle = handle;
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      fileState = perm === 'granted' ? 'ok' : 'needs-permission';
    } catch (e) { fileHandle = null; fileState = 'none'; }
    renderBackupStatus();
  }

  window.addEventListener('beforeunload', ev => {
    if (isDirty()) { ev.preventDefault(); ev.returnValue = ''; }
  });
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }

  // ---- GitHub sync ----
  // Commits the CV as JSON to a branch of a GitHub repo, so edits survive clearing
  // site data. Only the access token lives in the browser; re-enter it after a wipe
  // and the CV is pulled back from GitHub.
  const GH_KEY = 'cv-editor.github';
  const GH_DEFAULTS = { token: '', repo: '', branch: 'cv-data', path: 'cv-data.json' };
  const loadGh = () => {
    try { return { ...GH_DEFAULTS, ...JSON.parse(localStorage.getItem(GH_KEY)) }; } catch (e) { return { ...GH_DEFAULTS }; }
  };
  let gh = loadGh();
  let ghDraft = { ...gh };
  let ghState = gh.token && gh.repo ? 'ok' : 'none';   // none | ok | syncing | error
  let ghError = '';
  let ghSha = null;            // blob sha of the file as last seen on GitHub
  let ghSyncedAt = null;
  let ghTimer;
  let ghBusy = false;
  let ghAgain = false;

  class GhError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function ghApi(path, opts = {}) {
    const res = await fetch('https://api.github.com' + path, {
      ...opts,
      headers: {
        Authorization: `Bearer ${gh.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (res.status === 204) return null;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = res.status === 401 ? 'token rejected (expired or mistyped)'
        : res.status === 403 ? 'token lacks permission (needs Contents: read & write on this repo)'
        : body.message || `HTTP ${res.status}`;
      throw new GhError(res.status, hint);
    }
    return body;
  }

  const b64encode = text => {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
  const ghContentsPath = () => `/repos/${gh.repo}/contents/${gh.path.split('/').map(encodeURIComponent).join('/')}`;
  const serialize = () => JSON.stringify(cv, null, 1) + '\n';

  // Creates the data branch from the default branch if it does not exist yet.
  async function ghEnsureBranch() {
    const repo = await ghApi(`/repos/${gh.repo}`);
    try {
      await ghApi(`/repos/${gh.repo}/branches/${encodeURIComponent(gh.branch)}`);
    } catch (e) {
      if (e.status !== 404) throw e;
      const base = await ghApi(`/repos/${gh.repo}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
      await ghApi(`/repos/${gh.repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${gh.branch}`, sha: base.object.sha }),
      });
    }
    return repo;
  }

  async function ghGetRemote() {
    try {
      const f = await ghApi(`${ghContentsPath()}?ref=${encodeURIComponent(gh.branch)}`);
      return { sha: f.sha, text: b64decode(f.content) };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function ghPut() {
    const at = editedAt;
    const body = { message: 'Update CV data', content: b64encode(serialize()), branch: gh.branch };
    if (ghSha) body.sha = ghSha;
    try {
      const out = await ghApi(ghContentsPath(), { method: 'PUT', body: JSON.stringify(body) });
      ghSha = out.content.sha;
    } catch (e) {
      // Stale sha (file changed on GitHub, or we never saw it): refetch and retry once,
      // unless the remote holds different content, in which case the user decides.
      if (e.status !== 409 && e.status !== 422) throw e;
      const remote = await ghGetRemote();
      if (remote && remote.sha !== ghSha && remote.text !== serialize() && !(await ghResolve(remote))) return false;
      ghSha = remote ? remote.sha : null;
      if (ghSha) body.sha = ghSha; else delete body.sha;
      const out = await ghApi(ghContentsPath(), { method: 'PUT', body: JSON.stringify(body) });
      ghSha = out.content.sha;
    }
    ghSyncedAt = new Date();
    markBackedUp(at);
    return true;
  }

  // Remote differs from the editor: let the user pick which copy wins.
  // Returns true to overwrite GitHub with the editor, false if GitHub's copy was loaded.
  async function ghResolve(remote) {
    let data = null;
    try { data = JSON.parse(remote.text); } catch (e) { /* unreadable: overwrite */ }
    ghSha = remote.sha;
    if (!valid(data)) return true;
    const load = confirm(
      `GitHub already has a different copy of the CV (${gh.repo}@${gh.branch}).\n\n` +
      `OK = load the GitHub copy into the editor\nCancel = overwrite GitHub with what is in the editor\n\n` +
      `(Either way the other version stays in the repo's commit history.)`);
    if (!load) return true;
    cv = data;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cv)); } catch (e) { /* ignore */ }
    markBackedUp();
    renderEditor();
    renderPreview();
    ghSyncedAt = new Date();
    return false;
  }

  async function ghSyncNow() {
    if (ghBusy) { ghAgain = true; return; }
    ghBusy = true;
    clearTimeout(ghTimer);
    try {
      do {
        ghAgain = false;
        ghState = 'syncing';
        renderBackupStatus();
        await ghPut();
        ghState = 'ok';
        ghError = '';
      } while (ghAgain);
    } catch (e) {
      ghState = 'error';
      ghError = e.message === 'Failed to fetch' ? 'offline or blocked' : e.message;
    } finally {
      ghBusy = false;
      renderBackupStatus();
    }
  }

  function scheduleGhPush() {
    if (ghState === 'none') return;
    clearTimeout(ghTimer);
    ghTimer = setTimeout(ghSyncNow, 4000);
  }

  async function ghConnect() {
    const d = ghDraft;
    const repo = d.repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!d.token.trim() || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      alert('Enter a token and a repository as owner/name.');
      return;
    }
    gh = { token: d.token.trim(), repo, branch: d.branch.trim() || 'cv-data', path: d.path.trim() || 'cv-data.json' };
    ghDraft = { ...gh };
    ghState = 'syncing';
    renderBackupStatus();
    try {
      const info = await ghEnsureBranch();
      if (info.private === false && !confirm(
        `${gh.repo} is PUBLIC. Anyone on the internet could read your CV data ` +
        `(including your email and phone number), and every edit.\n\nSync to it anyway?`)) {
        throw new Error('cancelled: repository is public');
      }
      const remote = await ghGetRemote();
      ghSha = remote ? remote.sha : null;
      if (remote && remote.text !== serialize()) await ghResolve(remote);
      try { localStorage.setItem(GH_KEY, JSON.stringify(gh)); } catch (e) { /* ignore */ }
      ghState = 'ok';
      renderBackupStatus();
      if (!remote || remote.text !== serialize()) await ghSyncNow();
      else { ghSyncedAt = new Date(); markBackedUp(); }
    } catch (e) {
      ghState = 'error';
      ghError = e.message;
      gh = { ...GH_DEFAULTS };
    }
    renderBackupStatus();
    renderEditor();
  }

  function ghDisconnect() {
    if (!confirm('Disconnect GitHub sync and forget the token in this browser? Your data on GitHub is not touched.')) return;
    try { localStorage.removeItem(GH_KEY); } catch (e) { /* ignore */ }
    gh = { ...GH_DEFAULTS };
    ghDraft = { ...GH_DEFAULTS };
    ghState = 'none'; ghSha = null; ghError = '';
    renderBackupStatus();
    renderEditor();
  }

  // On page load with a saved connection: reconcile once (local edits made while offline win a
  // silent push; if there are none and GitHub differs, ask).
  async function ghStartup() {
    if (ghState !== 'ok') return;
    try {
      const remote = await ghGetRemote();
      ghSha = remote ? remote.sha : null;
      if (remote && remote.text === serialize()) { ghSyncedAt = new Date(); markBackedUp(); }
      else if (remote && !isDirty()) await ghResolve(remote);
      if (isDirty()) await ghSyncNow();
    } catch (e) {
      ghState = 'error';
      ghError = e.message === 'Failed to fetch' ? 'offline or blocked' : e.message;
    }
    renderBackupStatus();
  }

  function renderWelcome() {
    const node = document.getElementById('welcome');
    if (node) node.hidden = !(ghState === 'none' && !editedAt);
  }

  function renderGhStatus() {
    renderWelcome();
    const node = document.getElementById('gh-status');
    if (!node) return;
    node.textContent = ghState === 'error' ? ghError
      : ghState === 'ok' ? `Connected to ${gh.repo}@${gh.branch}:${gh.path}`
      : ghState === 'syncing' ? 'Working...' : 'Not connected';
    node.dataset.level = ghState === 'error' ? 'warn' : 'ok';
  }

  function githubCard() {
    const connected = ghState === 'ok' || ghState === 'syncing';
    const field = (key, label, type = 'text', placeholder = '') => el('label', { class: 'field wide' }, label,
      el('input', { type, value: ghDraft[key], placeholder, autocomplete: 'off', disabled: connected,
        oninput: ev => { ghDraft[key] = ev.target.value; } }));
    return el('details', { class: 'settings', open: !connected },
      el('summary', {}, 'GitHub backup (survives clearing cookies)'),
      el('div', { class: 'section-body grid' },
        el('p', { class: 'wide hint' },
          'Edits are committed to a branch of a GitHub repo a few seconds after you stop typing. ',
          'Use a PRIVATE repo and a fine-grained token limited to that repo with Contents: Read and write. ',
          'The token is stored in this browser only; after clearing site data, paste it again and your CV is pulled back.'),
        field('repo', 'Repository (owner/name)', 'text', 'yourname/your-private-repo'),
        field('token', 'Access token', 'password', 'github_pat_...'),
        field('branch', 'Branch (created if missing)'),
        field('path', 'File path'),
        el('span', { id: 'gh-status', class: 'wide ghstatus' }),
        connected
          ? el('button', { class: 'wide', onclick: ghSyncNow }, 'Sync now')
          : el('button', { class: 'wide primary', onclick: ghConnect }, 'Connect & sync'),
        connected ? el('button', { class: 'wide danger', onclick: ghDisconnect }, 'Disconnect') : null));
  }

  // ---- helpers ----
  const newId = () => 'sec-' + Math.random().toString(36).slice(2, 8);

  function blankEntry(type, sec) {
    switch (type) {
      case 'publication': return { authors: '', year: '', title: '', venue: '', status: sec.statuses ? sec.statuses[0] : 'published' };
      case 'presentation': return { authors: '', date: '', title: '', kind: 'Poster presentation', venue: '' };
      case 'dated': return { date: '', lines: [''] };
      case 'teaching': return { role: 'Instructor', term: '', institution: '', course: '', rating: '', deptMean: '' };
      default: return { text: '' };
    }
  }

  function move(list, i, delta) {
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  }

  function entryLabel(type, e) {
    const parts = {
      publication: [e.year, e.title],
      presentation: [e.date, e.title],
      dated: [e.date, (e.lines || [])[0]],
      teaching: [e.role, e.term, e.course],
      text: [e.text],
      list: [e.text],
    }[type];
    return parts.filter(Boolean).join(' · ') || '(empty entry)';
  }

  // ---- editor ----
  function renderEditor() {
    const root = document.getElementById('editor');
    const scroll = root.scrollTop;
    root.replaceChildren(githubCard(), settingsCard(), ...cv.sections.map(sectionCard), addSectionCard());
    root.scrollTop = scroll;
  }

  function textField(label, value, onInput, wide) {
    return el('label', { class: 'field' + (wide ? ' wide' : '') }, label,
      el('input', { type: 'text', value, oninput: ev => onInput(ev.target.value) }));
  }

  function settingsCard() {
    const h = cv.header;
    const set = key => v => { h[key] = v; save(); };
    return el('details', { class: 'settings' },
      el('summary', {}, 'Header & settings'),
      el('div', { class: 'section-body grid' },
        textField('Name', h.name, set('name'), true),
        textField('Contact line', h.contact, set('contact'), true),
        textField('Affiliation line', h.affiliation, set('affiliation'), true),
        textField('Bold this author in citations (e.g., "Lastname, F.")', h.boldAuthor, set('boldAuthor'), true)));
  }

  function fieldControl(sec, entry, [key, label, kind, wide]) {
    const cls = 'field' + (wide ? ' wide' : '');
    const update = v => { entry[key] = v; save(); refreshLabel(entry); };
    if (kind === 'status') {
      return el('label', { class: cls }, label,
        el('select', { onchange: ev => changeStatus(sec, entry, ev.target.value) },
          STATUS_OPTIONS.map(([v, t]) => el('option', { value: v, selected: entry.status === v }, t))));
    }
    if (kind === 'area' || kind === 'lines') {
      const value = kind === 'lines' ? (entry.lines || []).join('\n') : entry[key] || '';
      const area = el('textarea', {
        rows: kind === 'lines' ? Math.max(2, (entry.lines || []).length) : 2,
        oninput: ev => update(kind === 'lines' ? ev.target.value.split('\n') : ev.target.value),
      });
      area.value = value;
      return el('label', { class: cls }, label, area);
    }
    return el('label', { class: cls }, label,
      el('input', { type: 'text', value: entry[key] || '', oninput: ev => update(ev.target.value) }));
  }

  // The collapsed-card label is updated in place so typing never loses focus.
  const labels = new WeakMap();
  function refreshLabel(entry) {
    const node = labels.get(entry);
    if (node) node.textContent = node.dataset.type ? entryLabel(node.dataset.type, entry) : '';
  }

  function changeStatus(sec, entry, status) {
    entry.status = status;
    const dest = cv.sections.find(s => s.type === 'publication' && s.statuses && s.statuses.includes(status));
    if (dest && dest !== sec && !(sec.statuses && sec.statuses.includes(status))) {
      sec.entries.splice(sec.entries.indexOf(entry), 1);
      dest.entries.unshift(entry);
      openSections.add(dest.id);
      flash(`Moved to "${dest.title}"`);
    }
    save();
    renderEditor();
  }

  function entryCard(sec, i) {
    const entry = sec.entries[i];
    const label = el('span', { class: 'label', 'data-type': sec.type }, entryLabel(sec.type, entry));
    labels.set(entry, label);
    const act = (text, title, fn, extra) => el('button', { class: 'icon', title, 'aria-label': title, onclick: fn, ...extra }, text);
    return el('div', { class: 'entry' },
      el('div', { class: 'entry-head' }, label,
        act('↑', 'Move up', () => { move(sec.entries, i, -1); save(); renderEditor(); }, { disabled: i === 0 }),
        act('↓', 'Move down', () => { move(sec.entries, i, 1); save(); renderEditor(); }, { disabled: i === sec.entries.length - 1 }),
        act('✕', 'Delete entry', () => {
          if (!confirm('Delete this entry?')) return;
          sec.entries.splice(i, 1); save(); renderEditor();
        })),
      el('div', { class: 'grid' }, FIELDS[sec.type].map(f => fieldControl(sec, entry, f))));
  }

  function sectionCard(sec, idx) {
    const details = el('details', { class: 'section', open: openSections.has(sec.id) },
      el('summary', {}, sec.title || '(untitled)',
        el('span', { class: 'count' }, `${sec.entries.length} ${sec.entries.length === 1 ? 'entry' : 'entries'}${sec.hidden ? ' · hidden' : ''}`)),
      el('div', { class: 'section-body' },
        el('div', { class: 'section-tools' },
          el('label', { class: 'field' }, 'Section title',
            el('input', { type: 'text', value: sec.title, oninput: ev => { sec.title = ev.target.value; save(); } })),
          el('label', { class: 'field inline' },
            el('input', { type: 'checkbox', checked: !!sec.hidden, onchange: ev => { sec.hidden = ev.target.checked; save(); renderEditor(); } }),
            'Hide in export'),
          sec.type === 'dated' ? el('label', { class: 'field' }, 'Date column (in)',
            el('input', { type: 'number', min: '0.5', max: '3', step: '0.125', value: sec.dateWidth || 1.5, style: 'width:5em',
              oninput: ev => { sec.dateWidth = parseFloat(ev.target.value) || 1.5; save(); } })) : null,
          el('button', { title: 'Move section up', disabled: idx === 0, onclick: () => { move(cv.sections, idx, -1); save(); renderEditor(); } }, 'Section ↑'),
          el('button', { title: 'Move section down', disabled: idx === cv.sections.length - 1, onclick: () => { move(cv.sections, idx, 1); save(); renderEditor(); } }, 'Section ↓'),
          el('button', { class: 'danger', onclick: () => {
            if (!confirm(`Delete the section "${sec.title}" and its ${sec.entries.length} entries?`)) return;
            cv.sections.splice(idx, 1); save(); renderEditor();
          } }, 'Delete section')),
        sec.entries.map((_, i) => entryCard(sec, i)),
        el('div', { class: 'add-row' },
          el('button', { onclick: () => addEntry(sec, 'start') }, '+ Add entry at top'),
          el('button', { onclick: () => addEntry(sec, 'end') }, '+ Add entry at bottom'))));
    details.addEventListener('toggle', () => {
      if (details.open) openSections.add(sec.id); else openSections.delete(sec.id);
    });
    return details;
  }

  function addEntry(sec, where) {
    const entry = blankEntry(sec.type, sec);
    if (where === 'start') sec.entries.unshift(entry); else sec.entries.push(entry);
    openSections.add(sec.id);
    save();
    renderEditor();
  }

  function addSectionCard() {
    const title = el('input', { type: 'text', placeholder: 'New section title (e.g., GRANTS)' });
    const type = el('select', {}, Object.entries(SECTION_TYPES).map(([v, t]) => el('option', { value: v }, t)));
    return el('details', { class: 'settings' },
      el('summary', {}, '+ Add a section'),
      el('div', { class: 'section-body grid' },
        el('label', { class: 'field wide' }, 'Title', title),
        el('label', { class: 'field wide' }, 'Layout', type),
        el('button', { class: 'wide', onclick: () => {
          const sec = { id: newId(), title: title.value.trim().toUpperCase() || 'NEW SECTION', type: type.value, entries: [] };
          if (sec.type === 'dated') sec.dateWidth = 1.5;
          if (sec.type === 'publication') sec.statuses = ['published', 'in-press'];
          sec.entries.push(blankEntry(sec.type, sec));
          cv.sections.push(sec);
          openSections.add(sec.id);
          save();
          renderEditor();
        } }, 'Add section')));
  }

  // ---- preview ----
  function runsToNodes(runs) {
    return runs.map(r => {
      if (!r.bold && !r.italic) return document.createTextNode(r.text);
      let n = document.createTextNode(r.text);
      if (r.italic) n = el('i', {}, n);
      if (r.bold) n = el('b', {}, n);
      return n;
    });
  }

  function linesToNodes(lines) {
    return lines.flatMap((runs, i) => (i ? [el('br'), ...runsToNodes(runs)] : runsToNodes(runs)));
  }

  function blockToNode(b) {
    switch (b.type) {
      case 'title': return el('div', { class: 'title' }, b.text);
      case 'center': return el('div', { class: 'center' }, b.text);
      case 'heading': return el('div', { class: 'heading' }, b.text);
      case 'dated': {
        const pct = (b.dateWidth / 6.5) * 100;
        return el('table', {},
          el('colgroup', {}, el('col', { style: `width:${pct}%` }), el('col')),
          el('tbody', {}, b.rows.map(r => el('tr', { class: r.lines.length > 1 ? 'multi' : '' },
            el('td', {}, el('p', {}, r.date)),
            el('td', {}, r.lines.map(l => el('p', {}, l)))))));
      }
      default: return el('p', { class: b.hanging ? 'hanging' : '' }, linesToNodes(b.lines));
    }
  }

  function renderPreview() {
    const page = document.getElementById('preview');
    page.replaceChildren(...CVFormat.buildBlocks(cv).map(blockToNode));
    fitPreview();
  }

  function fitPreview() {
    const pane = document.getElementById('preview-pane');
    const pageWidth = 8.5 * 96;
    const zoom = Math.min(1, (pane.clientWidth - 32) / pageWidth);
    document.getElementById('preview').style.setProperty('--zoom', zoom);
  }

  // ---- toolbar ----
  function download(blob, name) {
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function stamp() {
    const d = new Date();
    return `${d.getMonth() + 1}.${d.getDate()}.${String(d.getFullYear()).slice(2)}`;
  }

  document.getElementById('btn-docx').addEventListener('click', async () => {
    try {
      const blob = await CVExport.toBlob(CVFormat.buildBlocks(cv));
      download(blob, `CV_${stamp()}.docx`);
    } catch (e) {
      alert('Export failed: ' + e.message);
    }
  });

  document.getElementById('btn-json').addEventListener('click', () => {
    download(new Blob([JSON.stringify(cv, null, 1)], { type: 'application/json' }), `cv-backup-${stamp()}.json`);
    markBackedUp();
  });

  const fileInput = document.getElementById('file-import');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!valid(data)) throw new Error('not a CV backup file');
      if (!confirm('Replace the current CV with this backup?')) return;
      cv = data;
      save();
      markBackedUp();
      renderEditor();
    } catch (e) {
      alert('Could not load backup: ' + e.message);
    }
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm('Discard all edits in this browser and restore the blank template? (Your GitHub copy is not touched until the next sync, which would overwrite it.)')) return;
    cv = clone(window.CV_SEED);
    save();
    renderEditor();
  });

  document.getElementById('btn-link').addEventListener('click', linkBackupFile);
  window.addEventListener('resize', fitPreview);
  renderEditor();
  renderPreview();
  renderBackupStatus();
  restoreLinkedFile();
  ghStartup();
})();

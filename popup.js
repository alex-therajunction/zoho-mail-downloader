/**
 * Popup UI — Start/Cancel, folder selection, progress.
 * Does not log email bodies.
 */

const el = {
  authStatus: document.getElementById('authStatus'),
  accountSelect: document.getElementById('accountSelect'),
  folderSelect: document.getElementById('folderSelect'),
  includeTrashSpam: document.getElementById('includeTrashSpam'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnStart: document.getElementById('btnStart'),
  btnCancel: document.getElementById('btnCancel'),
  progress: document.getElementById('progress'),
  progFolder: document.getElementById('progFolder'),
  progCount: document.getElementById('progCount'),
  progErrors: document.getElementById('progErrors'),
  progBar: document.getElementById('progBar'),
  progDetail: document.getElementById('progDetail'),
  lastRun: document.getElementById('lastRun'),
  lastRunStats: document.getElementById('lastRunStats'),
};

let metaFolders = [];
let running = false;

document.addEventListener('DOMContentLoaded', async () => {
  el.btnRefresh.addEventListener('click', () => loadMeta());
  el.btnStart.addEventListener('click', () => startDownload());
  el.btnCancel.addEventListener('click', () => cancelDownload());
  el.includeTrashSpam.addEventListener('change', () => rebuildFolderSelect());
  el.folderSelect.addEventListener('change', () => updateStartEnabled());

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'PROGRESS' && msg.progress) {
      showProgress(msg.progress);
    }
  });

  await restoreLastRun();
  await syncRunningState();
  await loadMeta();
});

async function syncRunningState() {
  try {
    const state = await send({ type: 'GET_STATE' });
    running = !!(state && state.running);
    setRunningUi(running);
    if (state && state.progress) showProgress(state.progress);
  } catch (_e) {
    /* ignore */
  }
}

async function loadMeta() {
  setAuth('Checking Zoho Mail session…', 'idle');
  el.btnRefresh.disabled = true;
  el.btnStart.disabled = true;

  try {
    const res = await send({ type: 'LOAD_META' });
    if (!res || !res.ok) {
      const auth = res && res.authRequired;
      setAuth(
        (res && res.error) ||
          'Could not load accounts. Open https://mail.zoho.com/zm/ and sign in.',
        'err'
      );
      if (auth) {
        el.accountSelect.innerHTML = '<option value="">Sign in required</option>';
        el.folderSelect.innerHTML = '<option value="">—</option>';
      }
      return;
    }

    metaFolders = res.folders || [];
    el.accountSelect.innerHTML = '';
    for (const a of res.accounts) {
      const opt = document.createElement('option');
      opt.value = a.accountId;
      opt.textContent = a.mailboxAddress + (a.displayName ? ` (${a.displayName})` : '');
      el.accountSelect.appendChild(opt);
    }
    el.accountSelect.disabled = false;

    rebuildFolderSelect();
    setAuth(`Signed in — ${res.accounts.length} account(s), ${metaFolders.length} folders`, 'ok');
  } catch (err) {
    setAuth(String(err.message || err), 'err');
  } finally {
    el.btnRefresh.disabled = false;
    updateStartEnabled();
  }
}

function rebuildFolderSelect() {
  const include = el.includeTrashSpam.checked;
  const filtered = include
    ? metaFolders
    : metaFolders.filter((f) => !isTrashOrSpam(f));

  const prev = el.folderSelect.value;
  el.folderSelect.innerHTML = '';

  const all = document.createElement('option');
  all.value = '__ALL__';
  all.textContent = include
    ? 'All folders (including Trash/Spam)'
    : 'All folders (exclude Trash/Spam)';
  el.folderSelect.appendChild(all);

  for (const f of filtered) {
    const opt = document.createElement('option');
    opt.value = f.folderId;
    const type = f.folderType ? ` [${f.folderType}]` : '';
    opt.textContent = `${f.folderName}${type}`;
    el.folderSelect.appendChild(opt);
  }

  el.folderSelect.disabled = false;
  if ([...el.folderSelect.options].some((o) => o.value === prev)) {
    el.folderSelect.value = prev;
  }
  updateStartEnabled();
}

function isTrashOrSpam(f) {
  const type = String(f.folderType || '').toLowerCase();
  const name = String(f.folderName || '').toLowerCase();
  return (
    type === 'trash' ||
    type === 'spam' ||
    name === 'trash' ||
    name === 'spam' ||
    name === 'junk'
  );
}

async function startDownload() {
  const accountId = el.accountSelect.value;
  if (!accountId) {
    setAuth('Select an account (sign in to Zoho Mail first).', 'err');
    return;
  }

  setRunningUi(true);
  el.progress.classList.remove('hidden');
  showProgress({
    phase: 'starting',
    folder: '—',
    current: 0,
    total: 0,
    errors: 0,
    detail: 'Starting…',
  });

  try {
    const res = await send({
      type: 'START_DOWNLOAD',
      options: {
        accountId,
        folderId: el.folderSelect.value || '__ALL__',
        includeTrashSpam: el.includeTrashSpam.checked,
        folders: metaFolders,
      },
    });

    if (!res || !res.ok) {
      if (res && res.cancelled) {
        setAuth('Download cancelled.', 'idle');
      } else if (res && res.authRequired) {
        setAuth(
          res.error ||
            'Not signed in. Open https://mail.zoho.com/zm/ and sign in.',
          'err'
        );
      } else {
        setAuth((res && res.error) || 'Download failed', 'err');
      }
    } else {
      setAuth(
        `Done — ${res.messagesDownloaded} saved` +
          (res.errors ? `, ${res.errors} errors` : '') +
          (res.zipFilename ? ` → ${res.zipFilename}` : ''),
        'ok'
      );
    }
    await restoreLastRun();
  } catch (err) {
    setAuth(String(err.message || err), 'err');
  } finally {
    setRunningUi(false);
  }
}

async function cancelDownload() {
  await send({ type: 'CANCEL_DOWNLOAD' });
  el.progDetail.textContent = 'Cancelling…';
}

function showProgress(p) {
  el.progress.classList.remove('hidden');
  el.progFolder.textContent = p.folder || '—';
  const total = p.total || 0;
  const current = p.current || 0;
  el.progCount.textContent = `${current} / ${total}`;
  el.progErrors.textContent = String(p.errors || 0);
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  el.progBar.style.width = `${pct}%`;
  el.progDetail.textContent = p.detail || p.phase || '';
}

function setRunningUi(isRunning) {
  running = isRunning;
  el.btnStart.disabled = isRunning || !el.accountSelect.value;
  el.btnCancel.disabled = !isRunning;
  el.btnRefresh.disabled = isRunning;
  el.accountSelect.disabled = isRunning;
  el.folderSelect.disabled = isRunning;
  el.includeTrashSpam.disabled = isRunning;
}

function updateStartEnabled() {
  if (running) return;
  el.btnStart.disabled = !el.accountSelect.value;
}

function setAuth(text, kind) {
  el.authStatus.textContent = text;
  el.authStatus.className = `status ${kind || 'idle'}`;
}

async function restoreLastRun() {
  try {
    const { lastRunStats } = await chrome.storage.local.get('lastRunStats');
    if (!lastRunStats) {
      el.lastRun.classList.add('hidden');
      return;
    }
    el.lastRun.classList.remove('hidden');
    el.lastRunStats.textContent = JSON.stringify(lastRunStats, null, 2);
  } catch (_e) {
    el.lastRun.classList.add('hidden');
  }
}

function send(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

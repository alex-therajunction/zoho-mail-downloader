
function finish(stats, result) {
  stats.finishedAt = new Date().toISOString();
  job.running = false;
  job.cancel = false;
  chrome.storage.local.set({ lastRunStats: stats }).catch(() => {});
  return Object.assign({ stats }, result);
}

function broadcastProgress(progress) {
  job.progress = progress;
  chrome.runtime.sendMessage({ type: 'PROGRESS', progress }).catch(() => {});
}

function isTrashOrSpam(folder) {
  const type = String(folder.folderType || '').toLowerCase();
  const name = String(folder.folderName || '').toLowerCase();
  if (TRASH_SPAM_TYPES.has(type)) return true;
  if (TRASH_SPAM_NAMES.has(name)) return true;
  return false;
}

async function listAllMessages(accountId, folder) {
  const out = [];
  let start = 0;
  for (;;) {
    if (job.cancel) break;
    const q = `folderId=${encodeURIComponent(folder.folderId)}&start=${start}&limit=${PAGE_LIMIT}`;
    const res = await apiGet(`/accounts/${accountId}/messages/view?${q}`);
    if (!res.ok) {
      throw new Error(res.error || `List failed for ${folder.folderName}`);
    }
    const batch = normalizeArray(res.data);
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    start += batch.length;
    await sleep(100);
  }
  return out;
}

/**
 * Unified API GET: try service worker fetch, fall back to content-script bridge.
 */
async function apiGet(path) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  // Prefer content-script bridge when a Zoho Mail tab is available (CSRF/session).
  const tab = await findZohoTab();
  if (tab) {
    const bridged = await fetchViaContentScript(tab.id, url);
    if (bridged) {
      if (bridged.authRequired) {
        return {
          ok: false,
          authRequired: true,
          status: bridged.status || 401,
          error:
            'Not signed in to Zoho Mail. Open https://mail.zoho.com/zm/ and sign in, then click Refresh.',
        };
      }
      return bridged;
    }
  }

  // Direct SW fetch with cookies
  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });

    if (res.status === 401 || res.status === 403) {
      // Inject / open and retry via content script
      const ensured = await ensureZohoTab();
      if (ensured) {
        const bridged = await fetchViaContentScript(ensured.id, url);
        if (bridged) return bridged;
      }
      return {
        ok: false,
        authRequired: true,
        status: res.status,
        error:
          'Not signed in to Zoho Mail. Open https://mail.zoho.com/zm/ and sign in, then click Refresh.',
      };
    }

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_e) {
      return { ok: false, status: res.status, error: `Non-JSON response (${res.status})` };
    }
    return interpretApiJson(json, res.status);
  } catch (err) {
    const ensured = await ensureZohoTab();
    if (ensured) {
      const bridged = await fetchViaContentScript(ensured.id, url);
      if (bridged) return bridged;
    }
    return { ok: false, error: String(err.message || err) };
  }
}

function interpretApiJson(json, httpStatus) {
  if (!json || typeof json !== 'object') {
    return { ok: false, status: httpStatus, error: 'Empty API response' };
  }

  const code = json.status && typeof json.status.code !== 'undefined' ? Number(json.status.code) : httpStatus;
  const desc = (json.status && json.status.description) || '';

  if (code === 401 || code === 403) {
    return {
      ok: false,
      authRequired: true,
      status: code,
      error:
        'Not signed in to Zoho Mail. Open https://mail.zoho.com/zm/ and sign in, then click Refresh.',
    };
  }

  if (code !== 200) {
    const moreInfo = (json.data && json.data.moreInfo) || '';
    const more =
      moreInfo ? ` — ${moreInfo}` : desc ? ` — ${desc}` : '';
    const authish = /invalid.?ticket|csrf|unauthorized|not.?authenticated/i.test(
      `${desc} ${moreInfo}`
    );
    return {
      ok: false,
      authRequired: authish || code === 400 && /ticket/i.test(moreInfo),
      status: code,
      error: `API status ${code}${more}`,
      data: json.data,
    };
  }

  return { ok: true, status: code, data: json.data };
}

async function fetchViaContentScript(tabId, url) {
  try {
    await ensureContentScript(tabId);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'ZOHO_FETCH',
      url,
      options: { method: 'GET', credentials: 'include' },
    });

    if (!response) return null;

    if (response.error && !response.json) {
      return { ok: false, error: response.error, status: response.status || 0 };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, authRequired: true, status: response.status };
    }

    if (response.json) {
      return interpretApiJson(response.json, response.status);
    }

    return {
      ok: false,
      status: response.status,
      error: `Unexpected response (${response.status})`,
    };
  } catch (_e) {
    return null;
  }
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ZOHO_PING' });
  } catch (_e) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  }
}

async function findZohoTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://mail.zoho.com/*', 'https://*.zoho.com/*'],
  });
  const preferred = tabs.find((t) => t.url && /mail\.zoho\.com/i.test(t.url));
  return preferred || tabs[0] || null;
}

async function ensureZohoTab() {
  let tab = await findZohoTab();
  if (tab) return tab;

  tab = await chrome.tabs.create({
    url: 'https://mail.zoho.com/zm/',
    active: false,
  });
  await waitForTabComplete(tab.id, 20000);
  return tab;
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = async () => {
      try {
        const t = await chrome.tabs.get(tabId);
        if (t.status === 'complete') return resolve(t);
      } catch (_e) {
        return resolve(null);
      }
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(check, 300);
    };
    check();
  });
}

function normalizeArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  // Some Zoho endpoints wrap lists
  if (Array.isArray(data.messages)) return data.messages;
  if (Array.isArray(data.folder)) return data.folder;
  return [];
}

function buildFilename(m) {
  const date = formatDate(m.receivedTime);
  const from = sanitizeFilenamePart(extractEmailOrName(m.fromAddress), 40) || 'unknown';
  const subject = sanitizeFilenamePart(m.subject, 60) || 'no-subject';
  return `${date}_${from}_${subject}.eml`;
}

function appendMessageId(filename, messageId) {
  const id = sanitizeFilenamePart(String(messageId), 24);
  if (filename.toLowerCase().endsWith('.eml')) {
    return `${filename.slice(0, -4)}_${id}.eml`;
  }
  return `${filename}_${id}.eml`;
}

function formatDate(ts) {
  let d;
  if (ts == null || ts === '') {
    d = new Date();
  } else {
    const n = Number(ts);
    d = Number.isFinite(n) ? new Date(n) : new Date(ts);
    if (isNaN(d.getTime())) d = new Date();
  }
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function extractEmailOrName(from) {
  if (!from) return 'unknown';
  const s = String(from);
  const m = s.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  return s.trim();
}

function sanitizeFilenamePart(s, maxLen) {
  let out = String(s || '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (out.length > maxLen) out = out.slice(0, maxLen).trim();
  return out.replace(/[. ]+$/g, '');
}

function sanitizePathSegment(s) {
  return sanitizeFilenamePart(s, 80) || 'folder';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Zoho Mail Downloader — service worker orchestration.
 * Uses session cookies; prefers in-page content-script fetch on 401/CSRF.
 * Does not log email bodies or message content.
 */


const API_BASE = 'https://mail.zoho.com/api';
const PAGE_LIMIT = 75;
const MIME_DELAY_MS = 220; // ~150–300ms between originalmessage calls
const TRASH_SPAM_TYPES = new Set(['trash', 'spam']);
const TRASH_SPAM_NAMES = new Set(['trash', 'spam', 'junk', 'deleted items']);

/** @type {{ running: boolean, cancel: boolean, progress: object|null }} */
let job = { running: false, cancel: false, progress: null };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  switch (msg.type) {
    case 'GET_STATE':
      sendResponse({
        running: job.running,
        progress: job.progress,
      });
      return false;

    case 'LOAD_META':
      handleLoadMeta(msg)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    case 'START_DOWNLOAD':
      if (job.running) {
        sendResponse({ ok: false, error: 'Already running' });
        return false;
      }
      startDownload(msg.options)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    case 'CANCEL_DOWNLOAD':
      job.cancel = true;
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

async function handleLoadMeta(_msg) {
  const accounts = await apiGet('/accounts');
  if (!accounts.ok) return accounts;

  const list = normalizeArray(accounts.data);
  if (!list.length) {
    return {
      ok: false,
      authRequired: true,
      error: 'No Zoho Mail accounts found. Open https://mail.zoho.com/zm/ and sign in.',
    };
  }

  const account = list[0];
  const accountId = String(account.accountId);
  const foldersRes = await apiGet(`/accounts/${accountId}/folders`);
  if (!foldersRes.ok) return foldersRes;

  const folders = normalizeArray(foldersRes.data).map((f) => ({
    folderId: String(f.folderId),
    folderName: f.folderName || f.path || String(f.folderId),
    folderType: f.folderType || '',
    path: f.path || '',
  }));

  return {
    ok: true,
    accounts: list.map((a) => ({
      accountId: String(a.accountId),
      mailboxAddress: a.mailboxAddress || a.primaryEmailAddress || a.accountName || String(a.accountId),
      displayName: a.displayName || a.accountDisplayName || '',
    })),
    folders,
  };
}

async function startDownload(options) {
  job.running = true;
  job.cancel = false;
  const startedAt = Date.now();
  const stats = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    accountId: options.accountId,
    foldersProcessed: 0,
    messagesListed: 0,
    messagesDownloaded: 0,
    errors: 0,
    errorSamples: [],
    cancelled: false,
    zipFilename: null,
  };

  try {
    const accountId = String(options.accountId);
    let folders = options.folders || [];
    if (!folders.length) {
      const fr = await apiGet(`/accounts/${accountId}/folders`);
      if (!fr.ok) throw new Error(fr.error || 'Failed to load folders');
      folders = normalizeArray(fr.data).map((f) => ({
        folderId: String(f.folderId),
        folderName: f.folderName || f.path || String(f.folderId),
        folderType: f.folderType || '',
      }));
    }

    const includeTrashSpam = !!options.includeTrashSpam;
    const selectedFolderId = options.folderId || '__ALL__';

    if (selectedFolderId !== '__ALL__') {
      folders = folders.filter((f) => f.folderId === selectedFolderId);
    } else if (!includeTrashSpam) {
      folders = folders.filter((f) => !isTrashOrSpam(f));
    }

    if (!folders.length) {
      throw new Error('No folders selected');
    }

    // Collect message metadata first so we know N/M
    const allMessages = [];
    for (const folder of folders) {
      if (job.cancel) break;
      broadcastProgress({
        phase: 'listing',
        folder: folder.folderName,
        current: allMessages.length,
        total: allMessages.length,
        errors: stats.errors,
        detail: `Listing ${folder.folderName}…`,
      });

      const msgs = await listAllMessages(accountId, folder);
      for (const m of msgs) {
        allMessages.push({
          messageId: String(m.messageId),
          subject: m.subject || '(no subject)',
          fromAddress: m.fromAddress || m.sender || 'unknown',
          receivedTime: m.receivedTime || m.sentDateInGMT || null,
          folderName: folder.folderName,
          folderId: folder.folderId,
        });
      }
      stats.foldersProcessed += 1;
      stats.messagesListed = allMessages.length;
    }

    if (job.cancel) {
      stats.cancelled = true;
      return finish(stats, { ok: false, cancelled: true, error: 'Cancelled' });
    }

    const total = allMessages.length;
    if (total === 0) {
      return finish(stats, { ok: false, error: 'No messages found in selected folders' });
    }

    const zip = new JSZip();
    const usedNames = new Map(); // folderName -> Set of filenames

    for (let i = 0; i < allMessages.length; i++) {
      if (job.cancel) {
        stats.cancelled = true;
        break;
      }

      const m = allMessages[i];
      broadcastProgress({
        phase: 'downloading',
        folder: m.folderName,
        current: i + 1,
        total,
        errors: stats.errors,
        detail: `Fetching ${i + 1}/${total}`,
      });

      try {
        const mimeRes = await apiGet(
          `/accounts/${accountId}/messages/${m.messageId}/originalmessage`
        );
        if (!mimeRes.ok) {
          throw new Error(mimeRes.error || `HTTP ${mimeRes.status}`);
        }
        const content =
          mimeRes.data && typeof mimeRes.data.content === 'string'
            ? mimeRes.data.content
            : null;
        if (!content) {
          throw new Error('Missing MIME content');
        }

        const baseName = buildFilename(m);
        const folderKey = sanitizePathSegment(m.folderName) || 'folder';
        if (!usedNames.has(folderKey)) usedNames.set(folderKey, new Set());
        const set = usedNames.get(folderKey);
        let filename = baseName;
        if (set.has(filename)) {
          filename = appendMessageId(baseName, m.messageId);
        }
        set.add(filename);

        zip.file(`${folderKey}/${filename}`, content);
        stats.messagesDownloaded += 1;
      } catch (err) {
        stats.errors += 1;
        if (stats.errorSamples.length < 8) {
          stats.errorSamples.push({
            messageId: m.messageId,
            folder: m.folderName,
            error: String(err.message || err),
          });
        }
      }

      await sleep(MIME_DELAY_MS);
    }

    if (job.cancel && stats.messagesDownloaded === 0) {
      return finish(stats, { ok: false, cancelled: true, error: 'Cancelled' });
    }

    broadcastProgress({
      phase: 'zipping',
      folder: '—',
      current: stats.messagesDownloaded,
      total,
      errors: stats.errors,
      detail: 'Building zip…',
    });

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const zipFilename = `zoho-mail-${stamp}.zip`;
    stats.zipFilename = zipFilename;

    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({
        url,
        filename: zipFilename,
        saveAs: true,
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    broadcastProgress({
      phase: 'done',
      folder: '—',
      current: stats.messagesDownloaded,
      total,
      errors: stats.errors,
      detail: stats.cancelled ? 'Cancelled (partial zip saved)' : 'Download started',
    });

    return finish(stats, {
      ok: true,
      cancelled: stats.cancelled,
      messagesDownloaded: stats.messagesDownloaded,
      errors: stats.errors,
      zipFilename,
    });
  } catch (err) {
    const authRequired = /sign in|401|not signed|auth/i.test(String(err.message || err));
    return finish(stats, {
      ok: false,
      authRequired,
      error: String(err.message || err),
    });
  }
}

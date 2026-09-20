/**
 * Content-script bridge: same-origin fetches against mail.zoho.com so session
 * cookies and CSRF headers work. Does not log email bodies.
 */
(function () {
  'use strict';

  if (window.__zohoMailDownloaderBridge) return;
  window.__zohoMailDownloaderBridge = true;

  function cookieValue(name) {
    const parts = (';.cookie || '').split(';');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].trim();
      const eq = p.indexOf('=');
      if (eq < 0) continue;
      if (p.slice(0, eq) === name) {
        return decodeURIComponent(p.slice(eq + 1));
      }
    }
    return null;
  }

  /** Zoho Mail UI sends X-ZCSRF-TOKEN: zmrcsr=<zmcsr cookie>. */
  function zohoCsrfHeaders() {
    const headers = { Accept: 'application/json' };
    const zmcsr =
      cookieValue('zmcsr') ||
      cookieValue('CT_CSRF_TOKEN') ||
      cookieValue('ZW_CSRF_TOKEN') ||
      cookieValue('CSRF_TOKEN');
    if (zmcsr) {
      headers['X-ZCSRF-TOKEN'] = 'zmrcsr=' + zmcsr;
    }
    return headers;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === 'ZOHO_PING') {
      sendResponse({ ok: true, hasCsrf: !!cookieValue('zmcsr') });
      return false;
    }

    if (message.type !== 'ZOHO_FETCH') return false;

    (async () => {
      try {
        const { url, options } = message;
        const method = ((options && options.method) || 'GET').toUpperCase();
        const opts = Object.assign(
          { credentials: 'include', redirect: 'follow', method },
          options || {}
        );

        // Merge CSRF; never force Content-Type on GET (Zoho returns INVALID_TICKET).
        const baseHeaders = zohoCsrfHeaders();
        const extra = (options && options.headers) || {};
        opts.headers = Object.assign({}, baseHeaders, extra);
        if (method === 'GET' || method === 'HEAD') {
          delete opts.headers['Content-Type'];
          delete opts.headers['content-type'];
        }

        const res = await fetch(url, opts);
        const status = res.status;
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_e) {
          /* non-JSON */
        }

        sendResponse({
          ok: res.ok,
          status,
          json,
          text: json ? undefined : text.slice(0, 500),
          error: null,
          csrfAttached: !!opts.headers['X-ZCSRF-TOKEN']
        });
      } catch (err) {
        sendResponse({
          ok: false,
          status: 0,
          json: null,
          text: null,
          error: String(err && err.message ? err.message : err)
        });
      }
    })();

    return true;
  });
})();

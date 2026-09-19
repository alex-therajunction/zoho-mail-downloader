/**
 * Content-script bridge: same-origin fetches against mail.zoho.com so session
 * cookies and CSRF headers work. Does not log email bodies.
 */
(function () {
  'use strict';

  if (window.__zohoMailDownloaderBridge) return;
  window.__zohoMailDownloaderBridge = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === 'ZOHO_PING') {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type !== 'ZOHO_FETCH') return false;

    (async () => {
      try {
        const { url, options } = message;
        const opts = Object.assign({ credentials: 'include', redirect: 'follow' }, options || {});
        opts.headers = Object.assign(
          {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          (options && options.headers) || {}
        );

        const res = await fetch(url, opts);
        const status = res.status;
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_e) {
          /* non-JSON (rare for these endpoints) */
        }

        sendResponse({
          ok: res.ok,
          status,
          json,
          text: json ? undefined : text.slice(0, 500),
          error: null
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

    return true; // async sendResponse
  });
})();

# Zoho Mail Downloader

Chrome Manifest V3 extension that downloads emails from [Zoho Mail](https://mail.zoho.com/zm/) as `.eml` files packed into a zip. It uses your **signed-in browser session** (no OAuth client setup).

## Install (Load unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `zoho-mail-downloader`
5. Pin the extension if you like

If you cloned from GitHub, first run `./scripts/assemble-jszip.sh` so `lib/jszip.min.js` exists.

## Usage

1. Sign in at [https://mail.zoho.com/zm/](https://mail.zoho.com/zm/) and leave a Zoho Mail tab open.
2. Open the extension popup → **Refresh** (loads accounts/folders).
3. Choose **All folders** (Trash/Spam excluded by default) or a single folder.
4. Optionally check **All including Trash/Spam**.
5. Click **Start**. When finished, Chrome prompts to save a zip of `.eml` files.
6. **Cancel** stops after the current message (partial zip may still be saved if any messages were fetched).

Zip layout: `{folderName}/{YYYY-MM-DD_from_subject}.eml` (messageId appended on name collisions).

## Rate limiting

The extension waits ~150–300 ms between `originalmessage` requests to avoid hammering Zoho. Large mailboxes can take a long time.

## Mailbox size warning

Thousands of messages mean a large zip and a long run. Keep the Zoho Mail tab open; do not clear site data mid-export. If Chrome sleeps the service worker on very long runs, re-open the popup to check progress / last-run stats.

## Privacy

- No OAuth app registration, no telemetry, no remote logging.
- Email bodies are written only into the zip you download; they are not logged to the console.
- Last-run **stats** (counts, sample error ids) are stored in `chrome.storage.local`.

## Auth notes

See [BUILD_NOTES.md](BUILD_NOTES.md) for session/CSRF caveats.

## Vendored JSZip

JSZip 3.10.1 is vendored. On GitHub it may be stored as `lib/jszip-parts/*.bin.txt`; run `./scripts/assemble-jszip.sh` to produce `lib/jszip.min.js`.

## License

MIT (JSZip is MIT/GPLv3 dual — see `lib/jszip.min.js` header).

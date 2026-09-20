# Zoho Mail Downloader

Chrome Manifest V3 extension that downloads emails from [Zoho Mail](https://mail.zoho.com/zm/) as `.eml` files packed into a zip. It uses your **signed-in browser session** (no OAuth client setup).

## Install from a Release (recommended)

1. Open the [latest release](https://github.com/alex-therajunction/zoho-mail-downloader/releases/latest)
2. Download `zoho-mail-downloader-vX.Y.Z.zip`
3. Unzip → Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `zoho-mail-downloader` folder

## Install from source (Load unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `zoho-mail-downloader`
5. Pin the extension if you like

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

## License

MIT (JSZip is MIT/GPLv3 dual — see `lib/jszip.min.js` header).

## Vendored JSZip

The repo stores JSZip as gzip+base64url split parts under `lib/jszip-b64/` (for GitHub upload size limits). After clone, run:

```bash
./scripts/assemble-jszip.sh
```

This writes `lib/jszip.min.js` (required for Load unpacked). If that file is already present (>50KB), the script exits successfully without rewriting it.


## Publishing a release

GitHub Actions (`.github/workflows/release.yml`) builds the Load-unpacked zip and publishes a Release using `GITHUB_TOKEN`.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Or: Actions → **Release extension zip** → Run workflow → version `v0.1.0`.

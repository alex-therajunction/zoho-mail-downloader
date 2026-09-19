# Build notes — Zoho Mail Downloader

## Auth / session caveats

- Official Zoho Mail REST APIs document **OAuth** (`Authorization: Zoho-oauthtoken …`). This extension intentionally uses the **browser session** instead (`credentials: 'include'`), so no client id/secret is required.
- Cookie-only `fetch` from a Manifest V3 **service worker** may return **401/403** because Zoho often expects same-origin context and CSRF-related cookies/headers that the mail UI already has.
- **Preferred path:** a content script on `mail.zoho.com` performs the GETs in-page and posts JSON back to the background worker. The SW still tries direct fetch and falls back to the bridge (injecting the script or opening `https://mail.zoho.com/zm/` if needed).
- User must be signed into Zoho Mail in Chrome. Regional hosts (`mail.zoho.eu`, etc.) may need matching `host_permissions` if you are not on `.com` — current manifest targets `mail.zoho.com` and `*.zoho.com`.
- API success is gated on JSON `status.code === 200` (not only HTTP 200).

## Response shapes handled

| Endpoint | Expected |
|----------|----------|
| `GET /api/accounts` | `data[]` with `accountId`, `mailboxAddress` / `primaryEmailAddress` |
| `GET /api/accounts/{id}/folders` | `data[]` with `folderId`, `folderName`, `folderType` (`Inbox`, `Spam`, `Trash`, …) |
| `GET …/messages/view?folderId&start&limit` | `data[]` messages with `messageId`, `subject`, `fromAddress`, `receivedTime` |
| `GET …/messages/{messageId}/originalmessage` | `data.content` = full MIME string → saved as `.eml` |

Trash/Spam exclusion uses `folderType` and common folder names when type is missing.

## Packaging

- JSZip **3.10.1** vendored at `lib/jszip.min.js` (no CDN at runtime).
- `importScripts('lib/jszip.min.js')` in the service worker.
- Zip download via `URL.createObjectURL` + `chrome.downloads.download` (`saveAs: true`).

## Not included

- OAuth client credentials, telemetry, or body logging.
- Automated live API tests (require a real signed-in Zoho session in Chrome).


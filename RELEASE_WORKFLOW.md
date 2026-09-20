# Release workflow (pending install)

The GitHub connector cannot create files under `.github/workflows/` without the OAuth **workflow** scope.

Once a token with `workflow` + `contents` is available, this repo will get `.github/workflows/release.yml` which:

- Triggers on `v*` tags or **Actions → Release extension zip → Run workflow**
- Assembles JSZip, builds `zoho-mail-downloader-vX.Y.Z.zip`
- Publishes a GitHub Release with that zip (Load-unpacked ready)

Until then, the workflow source lives on Alex’s computer at `/workspace/zoho-mail-downloader/.github/workflows/release.yml`.

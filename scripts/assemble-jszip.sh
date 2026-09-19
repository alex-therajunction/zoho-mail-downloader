#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/lib/jszip.min.js"
if [[ -f "$OUT" && $(wc -c < "$OUT") -gt 50000 ]]; then
  echo "Already present: $OUT ($(wc -c < "$OUT") bytes)"
  exit 0
fi
if [[ -d "$ROOT/lib/jszip-b64" ]]; then
  python3 - "$ROOT" <<'PY'
import base64, gzip, sys
from pathlib import Path
root = Path(sys.argv[1])
b64 = "".join(p.read_text().strip() for p in sorted((root / "lib/jszip-b64").glob("*.txt")))
data = gzip.decompress(base64.urlsafe_b64decode(b64))
(root / "lib/jszip.min.js").write_bytes(data)
print(f"Wrote {root / 'lib/jszip.min.js'} ({len(data)} bytes)")
PY
  exit 0
fi
if [[ -d "$ROOT/lib/jszip-parts" ]]; then
  cat "$ROOT"/lib/jszip-parts/*.bin.txt > "$OUT"
  echo "Wrote $OUT ($(wc -c < "$OUT") bytes)"
  exit 0
fi
echo "No JSZip sources found" >&2
exit 1

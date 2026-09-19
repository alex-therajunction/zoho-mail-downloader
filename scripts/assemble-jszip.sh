#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/lib/jszip.min.js"
cat "$ROOT"/lib/jszip-parts/*.bin.txt > "$OUT"
echo "Wrote $OUT ($(wc -c < "$OUT") bytes)"

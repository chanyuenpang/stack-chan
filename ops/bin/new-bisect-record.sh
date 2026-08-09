#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE="$REPO_ROOT/ops/templates/bisect-record.template.md"
OUTPUT_DIR="$REPO_ROOT/docs/bisect"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "[new-bisect-record] template not found: $TEMPLATE" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

round_arg="${1:-}"
device_id="${2:-unknown-device}"

if [[ -n "$round_arg" ]]; then
  round_id="$round_arg"
else
  round_id="R$(date +%Y%m%d)-01"
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
out="$OUTPUT_DIR/${timestamp}-${round_id}.md"

cp "$TEMPLATE" "$out"

iso_time="$(date +%Y-%m-%dT%H:%M:%S%z)"
iso_time="${iso_time:0:22}:${iso_time:22:2}"

sed -i \
  -e "s|RYYYYMMDD-XX|${round_id}|g" \
  -e "s|YYYY-MM-DDTHH:mm:ss+08:00|${iso_time}|g" \
  -e "s|- device_id: ``|- device_id: ${device_id}|g" \
  "$out"

echo "$out"

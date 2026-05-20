#!/usr/bin/env bash
set -euo pipefail

PORT=8765

echo "Stopping Codex Usage Dashboard on port ${PORT} ..."

if ! command -v lsof >/dev/null 2>&1; then
    echo "[FAIL] lsof not found. Install lsof or stop the dashboard with Ctrl+C in the terminal where it is running."
    echo "       To avoid killing unrelated processes, this script only uses lsof to find listeners on tcp:${PORT}."
    exit 1
fi

pids="$(lsof -ti "tcp:${PORT}" || true)"

if [[ -z "$pids" ]]; then
    echo "No process found on tcp:${PORT}."
    exit 0
fi

# Avoid broad process matching: only terminate PIDs reported by lsof for tcp:8765.
while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid"
    echo "Stopped process $pid"
done <<< "$pids"

echo "Done."

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================"
echo "  Codex Usage Dashboard Installer"
echo "============================================"
echo

if ! command -v python3 >/dev/null 2>&1; then
    echo "[FAIL] python3 not found. Please install Python 3.10+ and rerun this script."
    exit 1
fi
echo "[OK] Python found: $(python3 --version)"

if ! command -v node >/dev/null 2>&1; then
    echo "[FAIL] node not found. Please install Node.js and rerun this script."
    exit 1
fi
echo "[OK] Node.js found: $(node --version)"

if ! command -v npm >/dev/null 2>&1; then
    echo "[FAIL] npm not found. Please install npm and rerun this script."
    exit 1
fi
echo "[OK] npm found: $(npm --version)"

echo
echo "---- Step 1/3: Checking ccusage (Codex log parser) ----"
if command -v ccusage >/dev/null 2>&1; then
    echo "[OK] ccusage found: $(command -v ccusage)"
else
    echo "[..] ccusage not found. Trying: npm install -g ccusage"
    echo "     This script will not use sudo. If global npm install is not writable, install ccusage manually or configure npm prefix."
    if npm install -g ccusage; then
        echo "[OK] ccusage installed"
    else
        echo "[WARN] ccusage install failed. Please run 'npm install -g ccusage' after fixing npm permissions, then rerun if needed."
    fi
fi

echo
echo "---- Step 2/3: Installing codex-usage-dashboard ----"
cd "$SCRIPT_DIR"
python3 -m pip install --force-reinstall --no-deps .
echo "[OK] codex-usage-dashboard installed"

echo
echo "---- Step 3/3: Installing ccusage-codex wrapper ----"
scripts_dir="$(python3 -c 'import sysconfig; print(sysconfig.get_path("scripts"))')"
install -m 755 "$SCRIPT_DIR/ccusage-codex" "$scripts_dir/ccusage-codex"
echo "[OK] Wrapper installed to $scripts_dir/ccusage-codex"

echo
echo "============================================"
echo "  Installation complete!"
echo "  Run ./start.sh to launch the dashboard."
echo "============================================"

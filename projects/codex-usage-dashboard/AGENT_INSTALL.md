# Agent Installation Guide for Codex Usage Dashboard

You are helping a user install Codex Usage Dashboard from a local zip package. Follow these steps in order. Do not skip steps. Do not generate mock data.

## Prerequisites Check

Run these checks first and report the results to the user:

```bash
python --version        # Need 3.10+
node --version          # Need Node.js
npm --version           # Need npm
```

### If Python is missing

Windows:
```powershell
winget install Python.Python.3.13 --accept-package-agreements --accept-source-agreements --silent
```

macOS:
```bash
brew install python@3.13
```

After installing Python, **refresh your shell** or open a new terminal before continuing.

### If Node.js is missing

Windows:
```powershell
winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
```

macOS:
```bash
brew install node
```

After installing Node.js, **refresh your shell** or open a new terminal before continuing.

## Installation Steps

### Quick install on macOS / Linux

The zip now includes Linux/macOS scripts. From the extracted folder:

```bash
chmod +x *.sh ccusage-codex
./install.sh
```

This checks `python3`, `node`, and `npm`, installs the Python package, and installs the bundled `ccusage-codex` wrapper into the Python scripts directory.

### Step 1: Install ccusage (Codex session log parser)

```bash
npm install -g ccusage
```

This parses local Codex session logs at `~/.codex/sessions/`. Without it, the dashboard cannot read Codex usage data.

### Step 2: Install codex-usage-dashboard

Navigate to the directory where this file is located (the extracted zip folder), then run:

Windows:
```powershell
python -m pip install .
```

macOS / Linux:
```bash
python3 -m pip install .
```

If pip is not available, try `python -m ensurepip --upgrade` first.

### Step 3: Install the ccusage-codex compatibility wrapper

The dashboard internally calls `ccusage-codex`, but the current version of ccusage renamed this to `ccusage codex`. A wrapper script bridges the two.

**Windows:**

1. Find the Python Scripts directory:
```powershell
python -c "import sysconfig; print(sysconfig.get_path('scripts'))"
```

2. Copy `ccusage-codex.cmd` from this zip folder into that Scripts directory:
```powershell
copy ccusage-codex.cmd "<scripts_dir>\ccusage-codex.cmd"
```

**macOS / Linux:**

This repository now includes the shell wrapper `ccusage-codex`. You can install it manually:

1. Find the Python scripts directory:
```bash
python3 -c "import sysconfig; print(sysconfig.get_path('scripts'))"
```

2. Install the wrapper script into that directory:
```bash
install -m 755 ccusage-codex "<scripts_dir>/ccusage-codex"
```

Replace `<scripts_dir>` with the actual path from the previous command.

### Step 4: Verify installation

```bash
codex-usage --no-open
```

You should see output like `Codex Usage Dashboard: http://127.0.0.1:8765`. Press Ctrl+C to stop.

## Launching

Just run:

```bash
codex-usage
```

This starts a local web server and opens the dashboard in the browser. Everything (usage stats, period selection, session browsing) is in the web UI.

- **Windows users** can double-click `start.bat` instead.
- **macOS / Linux users** can run `./start.sh` to launch and `./stop.sh` to stop the process listening on port 8765.
- The server only binds to `127.0.0.1` (localhost). Press Ctrl+C to stop.

## Data Source Notes

- The dashboard reads **local files only**: `~/.codex/sessions/` (Codex session logs) or `~/.cc-switch/cc-switch.db` (CC Switch database).
- Default mode prefers Codex session logs, falls back to CC Switch. You can switch in the web UI.
- If neither data source exists on the user's machine, there is no data to display. **Do not generate fake data.**
- Cost figures are **estimates**, not provider invoices.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `codex-usage` not found | Make sure Python Scripts dir is in PATH. Try `python -m codex_usage_dashboard.cli` as alternative. |
| `ccusage-codex` failed | Verify `ccusage-codex` wrapper is in the Scripts dir. Run `ccusage codex daily --json` to test directly. |
| No data shown | Check that `~/.codex/sessions/` or `~/.cc-switch/cc-switch.db` exists. No local data = no report. |
| Period filter not working | Ensure ccusage is up to date: `npm update -g ccusage`. |

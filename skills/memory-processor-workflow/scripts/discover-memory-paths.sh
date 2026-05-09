#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCLAW_DIR="$(cd "${SKILL_DIR}/../.." && pwd)"
WORKSPACE_GLOB="${OPENCLAW_DIR}/workspace*"
PROJECTS_DIR="${OPENCLAW_DIR}/.projects"
OUTPUT_PATH="${SKILL_DIR}/todo.json"
TMP_PATH="${OUTPUT_PATH}.tmp"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

export SKILL_DIR WORKSPACE_GLOB PROJECTS_DIR OUTPUT_PATH TMP_PATH

python3 <<'PY'
import json
import os
from pathlib import Path

skill_dir = Path(os.environ['SKILL_DIR'])
workspace_glob = os.environ['WORKSPACE_GLOB']
projects_dir = Path(os.environ['PROJECTS_DIR'])
output_path = Path(os.environ['OUTPUT_PATH'])
tmp_path = Path(os.environ['TMP_PATH'])

items = []
seen = set()

for workspace_dir in sorted(Path(os.path.dirname(workspace_glob)).glob(os.path.basename(workspace_glob))):
    if not workspace_dir.is_dir():
        continue
    workspace_memory = next((candidate for candidate in (
        workspace_dir / 'MEMORY.md',
        workspace_dir / 'memory.md',
    ) if candidate.is_file()), None)
    if workspace_memory is None:
        continue
    resolved = str(workspace_memory.resolve())
    if resolved in seen:
        continue
    seen.add(resolved)
    items.append({
        'source': workspace_dir.name,
        'memory_path': resolved,
        'kind': 'workspace'
    })

if projects_dir.is_dir():
    project_memories = sorted(
        list(projects_dir.glob('*/MEMORY.md')) +
        list(projects_dir.glob('*/memory.md')),
        key=lambda memory: (str(memory.parent), memory.name != 'MEMORY.md')
    )
    seen_projects = set()
    for memory in project_memories:
        if not memory.is_file():
            continue
        project_key = str(memory.parent.resolve())
        if project_key in seen_projects:
            continue
        seen_projects.add(project_key)
        resolved = str(memory.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        items.append({
            'source': memory.parent.name,
            'memory_path': resolved,
            'kind': 'project'
        })

payload = {
    'generatedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
    'skill': 'memory-processor-workflow',
    'count': len(items),
    'items': items,
}

tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
os.replace(tmp_path, output_path)
print(output_path)
PY

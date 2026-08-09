#!/usr/bin/env python3
"""Backfill metadata drafts for historical exp-pkg candidate directories.

This tool is intentionally non-destructive:
- never overwrites existing metadata.json
- generates draft suggestions only
- writes per-candidate metadata.backfill.json and/or centralized JSONL review file
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess
from dataclasses import dataclass
from typing import Any

APP_DESC_MARKER = b"esp_app_desc"
SEMVER_RE = re.compile(r"\b(\d+\.\d+\.\d+)\b")
DATE_TAG_RE = re.compile(r"\b(20\d{6})\b")


@dataclass
class CandidateContext:
    dir_path: pathlib.Path
    dir_name: str
    firmware_path: pathlib.Path | None
    has_metadata_json: bool
    stat_mtime_iso: str
    inferred_version_from_name: str | None
    inferred_tag_from_name: str | None


def _run_git(args: list[str], cwd: pathlib.Path) -> str | None:
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            return None
        return proc.stdout.strip()
    except Exception:
        return None


def _fmt_ts(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _extract_first_ascii_near(blob: bytes, marker: bytes, max_scan: int = 4096) -> str | None:
    idx = blob.find(marker)
    if idx < 0:
        return None
    segment = blob[idx : idx + max_scan]
    strings = re.findall(rb"[ -~]{4,}", segment)
    decoded = [s.decode("ascii", errors="ignore") for s in strings]
    for s in decoded:
        if SEMVER_RE.search(s):
            return s
    if decoded:
        return decoded[0]
    return None


def _sha256_prefix(path: pathlib.Path, prefix_len: int = 12) -> str | None:
    try:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()[:prefix_len]
    except Exception:
        return None


def _collect_candidate_context(candidate_dir: pathlib.Path) -> CandidateContext:
    st = candidate_dir.stat()
    firmware = candidate_dir / "stack-chan.bin"
    firmware_path = firmware if firmware.exists() else None
    metadata_json = candidate_dir / "metadata.json"

    name = candidate_dir.name
    ver_match = SEMVER_RE.search(name)
    date_match = DATE_TAG_RE.search(name)

    return CandidateContext(
        dir_path=candidate_dir,
        dir_name=name,
        firmware_path=firmware_path,
        has_metadata_json=metadata_json.exists(),
        stat_mtime_iso=_fmt_ts(st.st_mtime),
        inferred_version_from_name=ver_match.group(1) if ver_match else None,
        inferred_tag_from_name=date_match.group(1) if date_match else None,
    )


def _guess_from_firmware(firmware_path: pathlib.Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "file_size": None,
        "sha256_prefix": None,
        "app_desc_hint": None,
        "version_from_app_desc": None,
    }
    try:
        blob = firmware_path.read_bytes()
        result["file_size"] = len(blob)
        result["sha256_prefix"] = _sha256_prefix(firmware_path)
        hint = _extract_first_ascii_near(blob, APP_DESC_MARKER)
        result["app_desc_hint"] = hint
        if hint:
            m = SEMVER_RE.search(hint)
            if m:
                result["version_from_app_desc"] = m.group(1)
    except Exception:
        pass
    return result


def _infer_confidence(ctx: CandidateContext, fw: dict[str, Any], git_hint: str | None) -> tuple[str, list[str]]:
    notes: list[str] = []
    score = 0

    if ctx.inferred_version_from_name:
        score += 1
        notes.append(f"目录名包含版本号 {ctx.inferred_version_from_name}")
    else:
        notes.append("目录名未解析出标准版本号")

    if fw.get("version_from_app_desc"):
        score += 2
        notes.append(f"固件 app_desc 解析到版本 {fw['version_from_app_desc']}")
    elif fw.get("app_desc_hint"):
        score += 1
        notes.append("固件包含 app_desc 片段，但未稳定提取版本")
    else:
        notes.append("未从固件中提取到可靠 app_desc 信息")

    if git_hint:
        score += 1
        notes.append("git 历史可定位候选目录最近提交")
    else:
        notes.append("git 历史未能定位该目录提交")

    if score >= 4:
        return "high", notes
    if score >= 2:
        return "medium", notes
    return "low", notes


def _build_draft(ctx: CandidateContext, repo_root: pathlib.Path) -> dict[str, Any]:
    fw = _guess_from_firmware(ctx.firmware_path) if ctx.firmware_path else {
        "file_size": None,
        "sha256_prefix": None,
        "app_desc_hint": None,
        "version_from_app_desc": None,
    }

    rel_dir = ctx.dir_path.relative_to(repo_root)
    git_log = _run_git(["log", "-n", "1", "--format=%H %cI %s", "--", str(rel_dir)], cwd=repo_root)
    git_head = _run_git(["rev-parse", "HEAD"], cwd=repo_root)

    confidence, notes = _infer_confidence(ctx, fw, git_log)
    inferred_version = fw.get("version_from_app_desc") or ctx.inferred_version_from_name

    draft = {
        "candidate": {
            "name": ctx.dir_name,
            "path": str(rel_dir),
        },
        "metadata_draft": {
            "backfilled": True,
            "version": inferred_version,
            "generated_at": _fmt_ts(dt.datetime.now(tz=dt.timezone.utc).timestamp()),
            "source": "ops/bin/backfill_candidate_metadata.py",
            "firmware": {
                "path": "stack-chan.bin" if ctx.firmware_path else None,
                "size": fw.get("file_size"),
                "sha256_prefix": fw.get("sha256_prefix"),
                "app_desc_hint": fw.get("app_desc_hint"),
            },
            "timestamps": {
                "candidate_dir_mtime": ctx.stat_mtime_iso,
            },
            "git": {
                "head": git_head,
                "latest_touch_commit": git_log,
            },
            "provenance": {
                "confidence": confidence,
                "notes": notes,
            },
        },
        "review": {
            "safe_to_apply_directly": confidence == "high" and not ctx.has_metadata_json,
            "has_existing_metadata_json": ctx.has_metadata_json,
            "do_not_overwrite_notice": "此文件为建议稿，禁止直接覆盖已有 metadata.json",
        },
    }
    return draft


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill metadata draft for exp-pkg/candidate-* directories")
    parser.add_argument("--repo-root", default=".", help="Repository root (default: current directory)")
    parser.add_argument("--exp-pkg", default="exp-pkg", help="exp-pkg directory relative to repo root")
    parser.add_argument(
        "--jsonl-out",
        default="exp-pkg/backfill-review.jsonl",
        help="Centralized jsonl output path (relative to repo root)",
    )
    parser.add_argument(
        "--write-per-candidate",
        action="store_true",
        help="Also write metadata.backfill.json into each candidate directory",
    )
    parser.add_argument(
        "--skip-existing-backfill",
        action="store_true",
        help="Skip candidate if metadata.backfill.json already exists",
    )
    args = parser.parse_args()

    repo_root = pathlib.Path(args.repo_root).resolve()
    exp_pkg = (repo_root / args.exp_pkg).resolve()
    jsonl_out = (repo_root / args.jsonl_out).resolve()

    if not exp_pkg.exists() or not exp_pkg.is_dir():
        raise SystemExit(f"exp-pkg dir not found: {exp_pkg}")

    candidate_dirs = sorted([p for p in exp_pkg.iterdir() if p.is_dir() and p.name.startswith("candidate-")])

    jsonl_out.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    with jsonl_out.open("w", encoding="utf-8") as f_jsonl:
        for cdir in candidate_dirs:
            ctx = _collect_candidate_context(cdir)

            per_file = cdir / "metadata.backfill.json"
            if args.skip_existing_backfill and per_file.exists():
                continue

            draft = _build_draft(ctx, repo_root)
            f_jsonl.write(json.dumps(draft, ensure_ascii=False) + "\n")
            count += 1

            if args.write_per_candidate:
                per_file.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"backfill draft generated: {count} candidates")
    print(f"jsonl: {jsonl_out}")
    if args.write_per_candidate:
        print("per-candidate metadata.backfill.json: enabled")
    else:
        print("per-candidate metadata.backfill.json: disabled")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

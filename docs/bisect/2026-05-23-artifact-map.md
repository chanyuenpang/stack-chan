# 候选产物 ↔ 提交映射核对表（artifact-map）

- date: `2026-05-23`
- scope: `force-ota 回退链路 / bisect 准备（不触发真机）`
- sources:
  - `docs/bisect/2026-05-23-r1_2.0.46plus_dialog_bisect-draft.md`
  - `exp-pkg/*/metadata.backfill.json`
  - `exp-pkg/*/release-notes.md`（如存在）
  - `git log --oneline --decorate --graph --all`

> 说明：当前映射以“产物目录名 + backfill 元数据 + 提交时间线”做核对，未从 bin 内提取 app_desc，故存在 artifact-only 情况。

## 核对表

| candidate 名称 | 推定版本 | 推定对应提交或提交范围 | 证据来源 | 置信度 | artifact-only? |
|---|---:|---|---|---|---|
| `candidate-release-2.0.46` | 2.0.46 | **范围：** `52b784a`（bump 2.0.46）→ `d80215f`（OTA release 2.0.46），可能含 `c19ca3f` | `metadata.backfill.json` 显示 version=2.0.46、firmware sha256_prefix=`b8b847d9cd6a`；git 历史含 `52b784a`/`d80215f`；但 `latest_touch_commit` 为空且 app_desc 缺失 | low | 是 |
| `candidate-inject-prompt-hardening-2.0.46` | 2.0.46 | **更可能：** `d80215f`（chore: OTA release firmware 2.0.46 (inject-prompt hardening)）；语义上可能关联 `c19ca3f` | `metadata.backfill.json` version=2.0.46，firmware sha256_prefix=`b8b847d9cd6a`；`latest_touch_commit` 指向 `d07630b`（后续批处理触达，不代表产物生成提交）；目录语义“inject-prompt-hardening”与 `d80215f/c19ca3f`一致 | medium | 是（在 commit 映射闭环前统一按 artifact-only） |
| `candidate-rollback-to-248-2.0.48` | 2.0.48 | **范围：** `d07630b`（bump-build 到 2.0.48）→ `561384a`（OTA release 2.0.48）；“rollback-to-248”语义偏向 `561384a` 后的回退操作产物 | `metadata.backfill.json` version=2.0.48、sha256_prefix=`d0314bf394b4`；git 有明确 2.0.48 提交点 `d07630b`/`561384a`；但 `latest_touch_commit` 为空，目录创建与具体 commit 未闭环 | low | 是 |
| `candidate-revert-voice-fix-2.0.51` | 2.0.51 | **候选范围：** `84bf29b`（voice chain fix）→ `0f66193`（revert 到 pre-57337db）；目录名“revert-voice-fix”与 `0f66193` 信息最贴近 | `metadata.backfill.json` version=2.0.51、sha256_prefix=`766a493bfd2a`；git 顶部两条为 voice fix/revert；但 `latest_touch_commit` 为空、无 release-notes、无 app_desc | low | 是 |

## 交叉观察（对 bisect 有用）

1. `candidate-release-2.0.46` 与 `candidate-inject-prompt-hardening-2.0.46` 的固件 `sha256_prefix` 同为 `b8b847d9cd6a`，说明它们极可能是同一二进制在不同命名语境下的产物目录。
2. 与对话回归相关的核心提交链在 git 上清晰（`57337db`、`84bf29b`、`0f66193`），但 candidate 目录到 commit 的“生成时刻证据”不完整（多处 `latest_touch_commit` 为空）。
3. 因 app_desc 未提取、release-notes 缺失（上述 4 个目录均无），当前 4 个 candidate 均应维持 `artifact-only` 标记（含 `candidate-inject-prompt-hardening-2.0.46`，直到 commit 映射闭环）。

## 建议的后续核验（文档层）

- 若需提升置信度：补一轮“目录创建时间 ↔ git reflog/历史脚本执行日志”对齐；
- 若需去掉 artifact-only：需要可复核的 build provenance（如构建脚本产生日志、manifest、或可解析的 app_desc/version 字段）。

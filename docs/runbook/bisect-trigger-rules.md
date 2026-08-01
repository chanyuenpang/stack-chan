# Bisect Trigger Rules（最小可执行版）

本规则用于 OTA/固件定位时，统一判断“是否进入 bisect、是否可复用 candidate、是否必须重建”。

## 1) 什么时候必须进入 bisect

满足任一条件即进入 bisect：

1. 同一测试协议（`test_protocol_id`）下，**同设备**稳定复现失败（`result=bad` 且 `repro_count >= 2`）。
2. 新候选包上线后出现回归，且无法通过配置/环境变更解释。
3. 已有结论互相冲突（同一 commit 或同一 artifact 出现 good/bad 混杂，且不是明确 flake）。
4. 关键路径故障（启动失败、无法连接、核心能力不可用）且影响发布判断。

## 2) 什么时候可以直接复用已有 candidate

同时满足以下条件可复用：

1. `commit_sha` 与 `build_fingerprint` 完全一致；
2. `test_protocol_id` 一致；
3. 目标设备族一致（同 `device_id` 规则域，或已验证可跨同族复现）；
4. 最近记录结论明确且非 `flake`；
5. 依赖环境未变化（关键配置、OTA 源、网络前提一致）。

> 任何一项不满足，默认不复用，转入“重建或 bisect”。

## 3) 什么时候必须重新 build

满足任一条件必须重新 build：

1. 只有 `commit_sha` 相同，但 `artifact_id_or_path` 丢失或不可追溯；
2. `build_fingerprint` 缺失或与记录不一致；
3. 构建参数（目标板、profile、编译选项）不确定；
4. 产物损坏、下载失败、签名校验不通过；
5. 需要引入额外观测（如日志开关）而现有包不满足。

## 4) 记录要求（执行时）

每次判断都要落一条 bisect record，至少包含：

- `round_id`
- `timestamp`
- `device_id`
- `commit_sha`
- `artifact_id_or_path`
- `version_string_ref`
- `build_fingerprint`
- `test_protocol_id`
- `result`（good/bad/skip/flake）
- `evidence`
- `repro_count`
- `notes`

可使用脚本快速生成：

```bash
ops/bin/new-bisect-record.sh [ROUND_ID] [DEVICE_ID]
```

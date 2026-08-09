# Bisect Record Template

> 用于记录每一轮 OTA/固件 bisect 观察结果。建议每轮创建一条独立记录。

## Metadata

- round_id: `RYYYYMMDD-XX`
- timestamp: `YYYY-MM-DDTHH:mm:ss+08:00`
- device_id: ``
- commit_sha: ``
- artifact_id_or_path: ``
- version_string_ref: ``
- build_fingerprint: ``
- test_protocol_id: ``

## Result

- result: `good | bad | skip | flake`
- repro_count: `0`
- evidence:
  - ``
- notes:
  - ``

## Optional Context

- trigger_reason: ``
- candidate_reuse_source: ``
- rebuild_reason: ``
- operator: ``

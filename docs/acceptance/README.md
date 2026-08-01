# 验收记录入口（OTA + 真机 + 回退）

本目录用于沉淀三段式验收记录，统一采用四段式结构：

- Before（前态）
- Action（动作）
- After（后态）
- Conclusion（结论）

## 模板位置

- `ops/templates/ota-device-rollback-acceptance.template.md`

## 生成一份新的验收记录骨架

```bash
./ops/bin/new-acceptance-record.sh [name] [device_id] [current_version] [target_version]
```

示例：

```bash
./ops/bin/new-acceptance-record.sh ota-release-r12 dev-001 v1.2.3 v1.2.4
```

生成路径：

- `docs/acceptance/YYYYMMDD-HHMMSS-<name>.md`

## 最小使用流程

1. 生成骨架文件
2. 在 `场景 A/B/C` 中按 Before/Action/After/Conclusion 补全事实
3. 填写执行命令、关键日志/证据、PASS/FAIL 判定
4. 若命中“停止边界”，立即停止并在结论中说明
5. 填写“最终总结”并归档

## 最小验证（仅模板流程验证）

- 本入口仅创建记录文件，不会执行 OTA、不会控制真机、不会触发回退。
- 可以通过以下命令自测：

```bash
./ops/bin/new-acceptance-record.sh smoke dev-xyz v0.0.1 v0.0.2
ls docs/acceptance/*.md
```

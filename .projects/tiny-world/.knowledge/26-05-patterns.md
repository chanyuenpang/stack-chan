# tiny-world - 26-05 Patterns

### [KN-20260507-004] tiny-world facility NPC temporary 修复

- **计数**: 1
- **标签**: facility, npc, temporary, godot, 修复记录
- **发现时间**: 2026-05-07
- **更新时间**: 2026-05-07

#### 内容
2026-05-06 tiny-world 设施 NPC 最终 MCP 验证完成并推送。修复 `role_container.gd`：按 `temp_id` 生成 independent temporary NPC，避免原始 `role_id` 阻断并避免污染 UNIQUE NPC；修复 `facility_panel.gd`：优先借用 `facility_entity` 上运行时 `RoleContainer`，避免面板重载 asset config 显示原始 NPC。MCP 验证通过：Task1 temporary NPC 独立生成，Task2 面板显示 temporary NPC 且交谈启动，Task3 关闭重开不丢失不重复且 0 SCRIPT/PARSE ERROR。Commit `30b9864c25d5ab80914bf1a6c1dffcdf426f3626` 已 push `origin/main`。

---

### [KN-20260510-003] tiny-world/GDScript 修改验证流程

- **计数**: 2
- **标签**: gdscript, 验证, godot, 编译检查
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
涉及 .gd 修改时必须执行 Godot headless compile/check，并在 tiny-world 计划中前置 Code→编译检查→MCP/启动 smoke test→提交推送完整验证链路。

---

### [KN-20260510-004] tiny-world UI 架构重构完成

- **计数**: 1
- **标签**: ui, 重构, 架构, lifecycle
- **发现时间**: 2026-05-10
- **更新时间**: 2026-05-10

#### 内容
tiny-world UI 框架全量重构完成。commit 6392b0f4 推送到 origin/main。47 文件 +2085/-974 行。核心变更：UIView lifecycle（ACTIVE/Closing/DISPOSED）、UIRuntime request_close 统一入口、transition per-view 幂等、dialogue 单实例、ConfirmDialog proxy 废弃、UIInputGateway 为唯一输入路由、panel ESC _input 删除、runtime_close_delegate/runtime_managed/force_close_from_runtime 清零、legacy add_child fallback 清零、Facility/NPC UI 迁移到 runtime 生命周期。Godot headless PASS、MCP smoke PASS、ingame dialogue 三条真实路径 PASS、ingame UI 回归 PASS、架构契约审查 PASS。

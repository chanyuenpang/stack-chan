# Workflow Kit Project Truth

## 项目级规则

- `workflow-kit` 当前以 SkillForge 静态 MVP 验证为主；任何 fixture 验证通过都只代表 static-only 文件与内容检查通过，不代表真实模型回放、生成器、UI/runtime、CI、跨平台或跨模型已经完成。
- canonical fixture 根目录保持为 `fixtures/<fixture-id>/` 扁平结构；当前 required files 为 8 个：`README.md`、`workflow-source.yaml`、`skill-spec.yaml`、`generation-run.yaml`、`skill-manifest.yaml`、`replay-cases.yaml`、`validation-result.yaml`、`skill/SKILL.md`。
- profile 是兼容透传字段，不是阻断规则：`skill-manifest.yaml` 顶层 `profile` 优先，其次读取 `skill/SKILL.md` frontmatter `metadata.profile`；当前 validator 不校验 enum、不因冲突报错。
- `validate:fixtures` 是多正例 JSON artifact 入口；`validate:all` 是本地 aggregate 入口，输出人类可读汇总并继续跑 matrix，不提供 suite JSON contract。
- `validate:contracts` 是静态 MVP 的最小 contract gate：它重新执行 3 个 single fixture JSON 命令、`validate:fixtures`、`validate:all`、`validate:fixture:matrix`，只锁关键 JSON 字段、profile 映射与 stdout markers，不锁完整 JSON 快照、对象键顺序、`generatedAt` 或全文 stdout 排版。
- `.github/workflows/ci-minimal-gate.yml` 是当前唯一已落地的自动化门禁：触发于 `pull_request` 与 `push` 到 `main`，使用单个 `ubuntu-latest` job 运行 `pnpm install`、`pnpm --silent validate:all` 与 `pnpm --silent validate:contracts`；它只证明 Linux static validation minimal gate 已接入，不证明 runtime replay、schema engine、cross-platform 或 cross-model 已完成。

## 重要索引

- [`features/skillforge-fixture-profiles.md`](features/skillforge-fixture-profiles.md)：SkillForge fixture profile 分层、`release-notes-assistant` standard fixture、验证入口、contract test 锚点、最小 CI gate 与已知边界。

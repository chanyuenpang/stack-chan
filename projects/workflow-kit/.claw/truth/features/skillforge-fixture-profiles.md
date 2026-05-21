# SkillForge Fixture Profiles 与 Release Notes Standard Fixture

## 结论

SkillForge Phase 2 的 fixture profile 目前用于表达样本复杂度与报告透传，不是 validator 的阻断规则；`fixtures/release-notes-assistant` 是首个 `standard` profile 正例，用来覆盖带 `templates/`、`examples/` 附属材料的静态 skill 结构。

## 长期行为 / 规则

- fixture 根目录继续使用 `fixtures/<fixture-id>/` 扁平路径，不按 `fixtures/simple/` 或 `fixtures/standard/` 分层迁移。
- 每个完整 fixture 的 required files 固定为 8 个：`README.md`、`workflow-source.yaml`、`skill-spec.yaml`、`generation-run.yaml`、`skill-manifest.yaml`、`replay-cases.yaml`、`validation-result.yaml`、`skill/SKILL.md`。
- profile 当前最小文档契约为 `simple`、`standard`、`advanced-reserved`，但 validator 只透传，不校验 enum，也不新增 warning/error/blocking rule。
- profile 读取优先级：`skill-manifest.yaml` 顶层 `profile` 优先，其次 `skill/SKILL.md` frontmatter `metadata.profile`；两者冲突时 manifest 归一化结果优先，但当前不是失败条件。
- `release-notes-assistant` 的长期定位是 static-only standard fixture：主题为把公开、虚构或合成 changelog、PR 摘要、版本变更列表整理成中文 release notes。
- `release-notes-assistant` 的输出章节约定包含 `highlights`、`breaking changes`、`migration notes`、`known limitations`、`upgrade checklist`。
- `standard` fixture 可以有非敏感公开附属材料；当前锚点为 `templates/release-notes-template.md` 与 `examples/synthetic-changelog.md`。
- `validate:contracts` 已成为当前 static MVP 的最小 contract gate：single-fixture JSON 需要继续满足 top-level 字段、`fixture/path/id/version/entry/profile`、`summary`、`status === "passed"`、`summary.total === checks.length`、`reportVersion === "0.1.0"`、`ruleSetVersion === "skillforge-static-mvp-0.1.0"`、`metadata.validator === "skillforge-static-mvp"`、`metadata.format === "json"`，以及 profile 映射 `meeting:null`、`study-card:simple`、`release-notes:standard`。
- `validate:fixtures` 的当前 multi-fixture contract 也被最小脚本锁定：`kind === "multi-fixture-validation-report"`、`summary.totalFixtures === 3`、`summary.passedFixtures === 3`、`summary.failedFixtures === 0`、`summary.totalChecks === 45`、`summary.errors === 0`、`fixtures.length === 3`，且 `id -> profile` 映射必须正确。
- `validate:all` 与 `validate:fixture:matrix` 的 contract 只锁稳定 stdout marker：`validate:all` 需要继续出现 `fixtures passed 3/3`、`totalChecks=45`、`blockingFailures=0`、`warnings=0`、`errors=0` 与 matrix 成功行；matrix 需要继续包含 6 个 `✓ ...` case 行与最终 `Fixture matrix passed: 6/6 cases.`。
- `.github/workflows/ci-minimal-gate.yml` 把当前 static gate 接入最小 GitHub Actions 自动化：`pull_request` 与 `push to main` 触发，单个 `ubuntu-latest` job 顺序运行 `pnpm install`、`pnpm --silent validate:all` 与 `pnpm --silent validate:contracts`；`permissions` 仅 `contents: read`，并以 `concurrency` 按 `workflow + PR head ref / git ref` 取消旧运行。
- replay 诚实性仍是核心边界：`replay-cases.yaml` 中 `observed: null`、`passed: null` 表示未执行真实模型回放，不得写成通过。
- `15 checks / 45 totalChecks` 是当前 static MVP baseline，不是长期冻结语义；若后续 validator 合法增加规则数量，应同步更新 contract test 与文档，而不是误把 baseline 当不可变协议。
- 当前 contract test 刻意不锁完整 JSON 快照、对象键顺序、空白格式、`generatedAt`、全文 stdout 排版；未来如要收紧 contract，应先确认不会把易变展示细节误当稳定语义。
- 权限与依赖边界保持保守：不联网、不读本地文件、不写文件、不外发、不调用外部服务、不执行破坏性操作；`dependencies.noneDeclared: true`。

## 关联代码

### 主锚点

- `fixtures/release-notes-assistant/`：首个 `standard` profile 正例 fixture，含 8 个 required files 和 `templates/`、`examples/` 附属材料。
- `docs/validator-contract.md`：validator CLI contract、multi-fixture report contract、profile passthrough 字段与当前 3 个 positive fixture 期望。
- `docs/phase-2-schema-and-fixtures.md`：Phase 2 profile 分层、fixture contract、`release-notes-assistant` standard fixture 设计边界。

### 关联锚点

| 路径 | 作用 |
| ---- | ---- |
| `fixtures/release-notes-assistant/skill-manifest.yaml` | `fixtureId: release-notes-assistant`、`fixtureVersion`、`profile: standard`、入口与权限声明。 |
| `fixtures/release-notes-assistant/skill/SKILL.md` | release notes assistant skill 正文、frontmatter、触发说明、边界与静态检查清单。 |
| `fixtures/release-notes-assistant/replay-cases.yaml` | 2 positive + 1 edge + 2 negative replay case 设计；`observed` / `passed` 保持 `null`。 |
| `fixtures/release-notes-assistant/templates/release-notes-template.md` | standard profile 附属发布说明模板。 |
| `fixtures/release-notes-assistant/examples/synthetic-changelog.md` | standard profile 附属合成 changelog 示例。 |
| `scripts/validate-fixture.mjs` | 单 fixture 静态验证 CLI：`validate:fixture <fixture-path>`。 |
| `scripts/validate-fixtures.mjs` | 多 fixture 静态验证 CLI：默认扫描完整 `fixtures/*`。 |
| `scripts/validate-all.mjs` | 本地 aggregate 入口：顺序运行 positive fixtures 与 fixture matrix，并打印 human-readable summary。 |
| `scripts/validate-fixture-matrix.mjs` | 独立 matrix gate，验证正/反例规则断言。 |
| `scripts/test-validator-contracts.mjs` | Phase 2E 最小 contract test 入口；重新执行 single/multi fixture JSON、aggregate stdout 与 matrix stdout 关键 contract。 |
| `.github/workflows/ci-minimal-gate.yml` | Phase 2F 最小 Linux GitHub Actions gate；把 aggregate static validation 与 contract validation 接入 PR / main 自动化门禁。 |
| `src/skillforge/validator.mjs` | 静态验证主逻辑。 |
| `src/skillforge/reporter.mjs` | 单 fixture / multi fixture report 输出结构。 |
| `src/skillforge/loader.mjs` | fixture 文件读取与 profile 来源解析的调查入口之一。 |
| `src/skillforge/rules.mjs` | 静态 MVP rule registry 与七维检查语义。 |

## 真实验证链路

1. `package.json`：定义 `validate`、`validate:fixture`、`validate:fixtures`、`validate:all`、`validate:fixture:matrix` 脚本入口。
2. `scripts/validate-fixture.mjs`：接收单个 fixture 路径，输出单 fixture JSON report。
3. `src/skillforge/loader.mjs` / `src/skillforge/validator.mjs`：读取 fixture required files、profile 字段与内容，执行静态规则。
4. `src/skillforge/reporter.mjs`：组装 `fixture.profile`、`summary`、`checks`、`findings` 等报告字段。
5. `scripts/validate-fixtures.mjs`：默认扫描 `fixtures/*` 的完整 fixture 根目录，复用单 fixture validator，输出 `kind: "multi-fixture-validation-report"`。
6. `scripts/validate-all.mjs`：消费 `validate:fixtures` JSON stdout，打印 `fixtures passed 3/3`、`totalChecks`、`blockingFailures` 等人类可读汇总，再运行 `validate:fixture:matrix`。
7. `scripts/test-validator-contracts.mjs`：重新调用 `pnpm --silent validate:fixture` / `validate:fixtures` / `validate:all` / `validate:fixture:matrix`，把稳定 JSON contract 与 stdout marker 固化成最小脚本化 gate。
8. `.github/workflows/ci-minimal-gate.yml`：在 GitHub Actions `ubuntu-latest` 上复用 `validate:all` 与 `validate:contracts`，把本地 static gate 提升为最小 PR / main 自动化门禁。

## 不要改错的位置

- 不要把 profile 当作当前 blocking rule；`simple | standard | advanced-reserved` 是文档契约和报告透传，不是 enum 校验。
- 不要把 `validate:all` 当作机器可消费 suite JSON；需要 multi-fixture JSON 的下游应调用 `validate:fixtures`。
- 不要把 `validate:contracts` 误解为完整测试框架或 schema engine；它只是当前 static MVP 的最小 contract gate。
- 不要把 `15 / 45` baseline 当成永远不可变的产品协议；它是当前规则数量锚点，合法演进时必须连同 contract test 一起更新。
- 不要把 `.github/workflows/ci-minimal-gate.yml` 误解为完整流水线；它只覆盖 Linux static gate，不包含 runtime replay、schema engine、Windows/macOS matrix 或 cross-model 验证。
- 不要把静态验证通过解读成 runtime replay、生成器、CI、跨平台或跨模型已经完成。
- 不要把 `release-notes-assistant` 的附属示例扩展成真实私有仓库、内部 issue、客户信息、token、私有 host/IP 或本地路径材料。
- 不要把 `replay-cases.yaml` 的 pending case 填成 `passed: true`，除非有独立真实模型回放证据。

## 验证标准

后续修改 fixture profile、`release-notes-assistant` 或 validator contract 时，至少复核：

```bash
pnpm --silent validate:fixture fixtures/release-notes-assistant --format json
pnpm --silent validate:fixtures
pnpm --silent validate:all
pnpm --silent validate:contracts
git diff --check
```

预期静态状态：当前默认 positive fixture 数量为 3，profile 覆盖 `meeting:null`、`study-card:simple`、`release-notes:standard`；`release-notes-assistant` 单 fixture 应报告 `profile=standard` 且 blocking failures 为 0。

## 关键检索词

- `release-notes-assistant`
- `profile: standard`
- `fixture.profile`
- `validate:fixture fixtures/release-notes-assistant`
- `validate:fixtures`
- `validate:all`
- `validate:contracts`
- `multi-fixture-validation-report`
- `observed: null`
- `passed: null`
- `templates/release-notes-template.md`
- `examples/synthetic-changelog.md`
- `skillforge-static-mvp-0.1.0`
- `ci-minimal-gate.yml`
- `ubuntu-latest`

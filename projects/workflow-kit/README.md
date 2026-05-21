# SkillForge

SkillForge turns reusable workflow experience into verifiable AI skills; this repository currently contains a **static MVP** for validating one fixture, not a complete skill generator.

![Status: Static MVP](https://img.shields.io/badge/status-Static%20MVP-blue)
![Acceptance: PASS_WITH_RISK](https://img.shields.io/badge/acceptance-PASS_WITH_RISK-orange)
![Static validation: passing](https://img.shields.io/badge/static%20validation-passing-brightgreen)

Current static validation result: `passed=true`, `15/15` checks passed (`P0=5`, `P1=8`, `P2=2`), with `blockingFailures=0`, `warnings=0`, and `errors=0`.

## Why

AI skills are useful only when their trigger, boundaries, dependencies, privacy assumptions, and replay claims can be reviewed. SkillForge is an attempt to make that review explicit and reproducible.

The current MVP is deliberately small: it validates one public fixture, `fixtures/meeting-summary-assistant`, using a static rule set and emits a JSON report. This helps separate documented evidence from unsupported claims.

## What it does today

The static MVP checks whether the fixture is internally consistent and safe enough to use as a baseline example. It covers these dimensions:

- **Structure**: expected files, manifest linkage, `SKILL.md` entry, and required metadata.
- **Trigger**: actionable description/trigger wording for the skill.
- **Boundary**: conservative permission boundaries such as no network, no external messages, no file writes, and no destructive actions by default.
- **Dependency**: declared dependency shape and absence of hidden runtime assumptions in the fixture.
- **Replay honesty**: prevents claiming replay success when no observed runtime result exists.
- **Privacy**: scans for high-confidence secrets, private paths, and sensitive evidence; reports are redacted.
- **Compatibility**: records compatibility assumptions without claiming cross-platform or cross-model proof.

## Quick Start

### Prerequisites

- Node.js available in the shell.
- `pnpm` available in the shell.
- Run commands from the repository root.

### Run the static fixture validator

```bash
cd /home/yankeeting/.openclaw/projects/workflow-kit
pnpm --silent validate:fixture fixtures/meeting-summary-assistant --format json
```

Expected summary from the latest rerun:

```text
passed=true
total checks=15
by severity: P0=5, P1=8, P2=2
blockingFailures=0
warnings=0
errors=0
```

The command writes a JSON validation report to stdout. A passing result means the current fixture passed the static validator only.

## Repository layout

```text
workflow-kit/
├── README.md
├── package.json
├── scripts/
│   └── validate-fixture.mjs
├── src/
│   └── skillforge/
│       ├── loader.mjs
│       ├── normalize.mjs
│       ├── reporter.mjs
│       ├── rules.mjs
│       └── validator.mjs
├── fixtures/
│   └── meeting-summary-assistant/
│       ├── README.md
│       ├── workflow-source.yaml
│       ├── skill-spec.yaml
│       ├── generation-run.yaml
│       ├── skill-manifest.yaml
│       ├── replay-cases.yaml
│       ├── validation-result.yaml
│       └── skill/
│           └── SKILL.md
└── docs/
    ├── acceptance-result.md
    ├── static-mvp-validation-report.md
    ├── roadmap.md
    └── optimization/
        └── round-10.md
```

> Note: `docs/roadmap.md` records the project roadmap, pending capabilities, and staged path beyond the static MVP.

## Current capabilities

- Validates a single fixture: `fixtures/meeting-summary-assistant`.
- Runs a static rule set: `skillforge-static-mvp-0.1.0`.
- Emits a stable JSON report for the fixture validation command.
- Covers 15 static checks across structure, trigger, boundary, dependency, replay, privacy, and compatibility.
- Fails high-priority static risks such as missing core metadata, high-confidence secret/path leaks, and forged replay pass claims.
- Redacts sensitive evidence in validation findings.
- Provides documented validation evidence for the current static MVP state.

## Non-goals and boundaries

This repository is intentionally not claiming more than the static MVP proves:

- Static validation passing **does not mean model replay passed**.
- This is **not** a complete skill generator.
- There is **no UI**.
- There is **no real model replay runner** in the current MVP.
- It does **not** prove cross-platform compatibility across Linux/macOS/Windows.
- It does **not** prove cross-model compatibility.
- It does **not** perform batch scanning, automatic repair, publishing, or external messaging.

## Validation evidence

Primary evidence files:

- [`docs/static-mvp-validation-report.md`](docs/static-mvp-validation-report.md) — reproducible static validation evidence for the positive fixture, including command, environment, rule set, summary, and known risks.
- [`docs/acceptance-result.md`](docs/acceptance-result.md) — MVP documentation/design acceptance result, currently `PASS_WITH_RISK`, with static MVP updates and pending runtime/cross-platform risks.

Related context:

- [`fixtures/meeting-summary-assistant/README.md`](fixtures/meeting-summary-assistant/README.md) — explains the public, fictional fixture.
- [`docs/optimization/round-10.md`](docs/optimization/round-10.md) — final optimization round and Go/No-Go framing for the static MVP path.

Historical reference commits:

- `1ed85b5 feat: implement SkillForge static MVP validator`
- `2ffa600 docs: define SkillForge MVP design`

## Roadmap

See [`docs/roadmap.md`](docs/roadmap.md) for planned next steps. The current expected direction is to keep the static MVP honest while adding evidence only when runtime replay, cross-platform checks, or broader generation capabilities are actually implemented.

## Development notes

Main entry points:

- `scripts/validate-fixture.mjs` — CLI entry for `pnpm --silent validate:fixture ...`.
- `src/skillforge/loader.mjs` — loads fixture files for validation.
- `src/skillforge/normalize.mjs` — normalizes fixture data before rules inspect it.
- `src/skillforge/rules.mjs` — static MVP rule definitions and checks.
- `src/skillforge/validator.mjs` — validation orchestration.
- `src/skillforge/reporter.mjs` — JSON report construction and output shaping.

Development rules for this MVP:

- Keep claims tied to evidence.
- Keep fixture data public or fictional.
- Do not treat `expected` replay data as `observed` runtime evidence.
- Keep static checks deterministic and JSON output machine-readable.
- When expanding scope, document the new evidence boundary before advertising the capability.

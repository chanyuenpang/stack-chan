# SkillForge

SkillForge turns reusable workflow experience into verifiable AI skills; this repository currently contains a **static MVP** for validating fixtures statically, not a complete skill generator.

![Status: Static MVP](https://img.shields.io/badge/status-Static%20MVP-blue)
![Acceptance: PASS_WITH_RISK](https://img.shields.io/badge/acceptance-PASS_WITH_RISK-orange)
![Static validation: passing](https://img.shields.io/badge/static%20validation-passing-brightgreen)

Current static validation result: `passed=true`, `15/15` checks passed (`P0=5`, `P1=8`, `P2=2`), with `blockingFailures=0`, `warnings=0`, and `errors=0`.

## Why

AI skills are useful only when their trigger, boundaries, dependencies, privacy assumptions, and replay claims can be reviewed. SkillForge is an attempt to make that review explicit and reproducible.

The current MVP is deliberately small: it validates public/fictional fixtures using a static rule set and emits JSON reports. `fixtures/meeting-summary-assistant` remains the baseline `validate` fixture, and Phase 2A adds `fixtures/study-card-assistant` plus a minimal multi-fixture entry. This helps separate documented evidence from unsupported claims.

## What it does today

The static MVP checks whether each fixture is internally consistent and safe enough to use as a static example. It covers these dimensions:

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
pnpm --silent validate
```

`validate` runs the current positive fixture validation and writes a JSON report to stdout, which makes it suitable for saved artifacts. The equivalent explicit command is `pnpm --silent validate:fixture fixtures/meeting-summary-assistant --format json`.

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

### Run all positive fixtures

```bash
pnpm --silent validate:fixtures
```

`validate:fixtures` writes a multi-fixture JSON report to stdout. With no explicit paths it scans complete direct child fixture directories under `fixtures/*`; in the current tree it reports `totalFixtures=2`, `passedFixtures=2`, and `failedFixtures=0`. You can also pass explicit paths, for example:

```bash
pnpm --silent validate:fixtures fixtures/meeting-summary-assistant fixtures/study-card-assistant --format json
```

This is still static validation only; it does not run model replay and does not replace the local aggregate validation gate.

### Run the local aggregate gate

```bash
pnpm --silent validate:all
```

`validate:all` is the Phase 2B local aggregate entry. It runs `validate:fixtures` first, parses that JSON report, prints a compact human-readable suite summary, then runs the independent fixture matrix entry. Both stages run even if the first stage fails; the aggregate exits non-zero if either child stage exits non-zero or if the `validate:fixtures` JSON stdout cannot be parsed.

The matrix remains available as its own sub-entry:

```bash
pnpm --silent validate:fixture:matrix
```

The matrix command copies the positive fixture into temporary directories, mutates those copies into representative counterexamples, and cleans them up before exit. It currently covers the positive baseline, missing description/trigger, secret/token leakage, private paths, forged replay pass claims, and all-source missing `compatibility` checklist coverage.

### CLI contract

- `validate` / `validate:fixture <fixture-path> --format json` writes a single fixture JSON report to stdout; use it when a machine-readable validation artifact is needed.
- `validate:fixtures [fixture-path ...] [--format json]` writes a multi-fixture JSON report with `kind=multi-fixture-validation-report`; with no paths it scans complete `fixtures/*` direct child fixture directories.
- Exit `0` means the requested validation passed; exit `1` means validation completed but blocking rules or fixture failures occurred; exit `2` is reserved for CLI usage errors.
- Diagnostics use stable `checks[].id` rule IDs and sanitized `evidence`; `metadata.generatedAt` is runtime metadata and should not be snapshot-tested.
- `validate:fixture:matrix` writes a human-readable matrix summary to stdout and exits `0` only when every matrix case meets its expected exit code, JSON parseability, and target rule assertions.
- `validate:all` writes a human-readable aggregate summary to stdout, does not emit suite JSON, and exits `0` only when both `validate:fixtures` and `validate:fixture:matrix` pass. It preserves `validate:fixtures` as the JSON artifact entry and keeps the matrix independently runnable.

### Checklist aggregation semantics

`SF-P1-STRUCTURE-SEVEN-DIMENSION-CHECKLIST` does **not** require a single file to list the seven dimensions exactly once. The validator normalizes supported checklist sources and checks their union: `workflowSource`, `skillSpec`, `generationRun`, `skillManifest`, `replayCases`, `validationResult`, nested validation checks, and the `skill/SKILL.md` body checklist. A dimension is considered covered when any supported source provides its canonical name; a missing-dimension failure requires that dimension to be absent from all supported sources.

## Repository layout

```text
workflow-kit/
├── README.md
├── package.json
├── scripts/
│   ├── validate-fixture.mjs
│   ├── validate-fixtures.mjs
│   └── validate-fixture-matrix.mjs
├── src/
│   └── skillforge/
│       ├── loader.mjs
│       ├── normalize.mjs
│       ├── reporter.mjs
│       ├── rules.mjs
│       └── validator.mjs
├── fixtures/
│   ├── meeting-summary-assistant/
│   │   ├── README.md
│   │   ├── workflow-source.yaml
│   │   ├── skill-spec.yaml
│   │   ├── generation-run.yaml
│   │   ├── skill-manifest.yaml
│   │   ├── replay-cases.yaml
│   │   ├── validation-result.yaml
│   │   └── skill/
│   │       └── SKILL.md
│   └── study-card-assistant/
│       └── ... same required fixture files
└── docs/
    ├── acceptance-result.md
    ├── static-mvp-validation-report.md
    ├── roadmap.md
    └── optimization/
        └── round-10.md
```

> Note: `docs/roadmap.md` records the project roadmap, pending capabilities, and staged path beyond the static MVP.

## Current capabilities

- Validates the baseline fixture: `fixtures/meeting-summary-assistant`.
- Provides a minimal multi-positive fixture entry for the current two simple fixtures: `fixtures/meeting-summary-assistant` and `fixtures/study-card-assistant`.
- Runs a static rule set: `skillforge-static-mvp-0.1.0`.
- Emits a stable JSON report for the fixture validation command.
- Provides a local aggregate validation entry (`validate:all`) that runs positive fixtures and the independent 6/6 fixture matrix gate.
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

- [`docs/static-mvp-validation-report.md`](docs/static-mvp-validation-report.md) — reproducible static validation evidence for the positive fixtures and multi-fixture entry, including command, environment, rule set, summary, and known risks.
- [`docs/acceptance-result.md`](docs/acceptance-result.md) — MVP documentation/design acceptance result, currently `PASS_WITH_RISK`, with static MVP updates and pending runtime/cross-platform risks.

Related context:

- [`fixtures/meeting-summary-assistant/README.md`](fixtures/meeting-summary-assistant/README.md) — explains the public, fictional baseline fixture.
- [`fixtures/study-card-assistant/README.md`](fixtures/study-card-assistant/README.md) — explains the public/fictional/synthetic study-card fixture.
- [`docs/optimization/round-10.md`](docs/optimization/round-10.md) — final optimization round and Go/No-Go framing for the static MVP path.

Historical reference commits:

- `1ed85b5 feat: implement SkillForge static MVP validator`
- `2ffa600 docs: define SkillForge MVP design`

## Roadmap

See [`docs/roadmap.md`](docs/roadmap.md) for planned next steps. The current expected direction is to keep the static MVP honest while adding evidence only when runtime replay, cross-platform checks, or broader generation capabilities are actually implemented.

## Development notes

Main entry points:

- `scripts/validate-fixture.mjs` — CLI entry for `pnpm --silent validate:fixture ...`.
- `scripts/validate-fixtures.mjs` — CLI entry for `pnpm --silent validate:fixtures ...`.
- `scripts/validate-fixture-matrix.mjs` — local positive/negative fixture matrix using temporary copies.
- `scripts/validate-all.mjs` — local aggregate entry that runs `validate:fixtures` and then `validate:fixture:matrix`.
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

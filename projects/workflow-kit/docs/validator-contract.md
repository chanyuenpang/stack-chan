# SkillForge Validator Contract

This document describes the current SkillForge static MVP validator contract as implemented in this repository. It is intended for developers integrating with, testing, or extending the validator without overstating capabilities that do not exist yet.

## Status and scope

| Item | Contract |
| --- | --- |
| Status | Static MVP validator contract. |
| Rule set | `skillforge-static-mvp-0.1.0`. |
| Report version | `0.1.0`. |
| Primary fixture path | Any supplied fixture directory. Current positive fixtures include `fixtures/meeting-summary-assistant`, `fixtures/study-card-assistant`, and `fixtures/release-notes-assistant`; `pnpm validate` remains the single baseline alias for `meeting-summary-assistant`. |
| Validator mode | Static file/content validation only. |
| In scope | Required fixture files, Skill frontmatter, entry path, trigger wording, conservative boundaries, dependency declarations, replay honesty claims, privacy scans, checklist coverage, and JSON report shape. |
| Out of scope | Model replay execution, skill generation, automatic repair, publishing, UI, batch product workflow, cross-model proof, cross-platform proof, or runtime behavior guarantees. |

A passing report means the fixture passed the current static checks. It does **not** mean a model replay ran, a generator produced the skill, or a UI/runtime integration was verified.

## CLI contract

Run commands from the repository root.

| Command | Args / flags | stdout | stderr | Exit code |
| --- | --- | --- | --- | --- |
| `pnpm validate` | Package alias for the current positive baseline: `pnpm validate:fixture fixtures/meeting-summary-assistant --format json`. | Writes one JSON validation report to stdout. Use this when a machine-readable artifact is needed. | Same as `validate:fixture`. | Same as `validate:fixture`: `0` when `report.summary.passed === true`, `1` for completed validation with blocking failure/error or fallback error report, `2` for CLI usage errors. |
| `pnpm validate:fixture <fixture-path> [--format json]` | Required positional `<fixture-path>`. Optional `--format json`; `--json` is accepted as a JSON shortcut. `--help`/`-h` prints usage. JSON is the default and only supported output format. | On successful CLI parsing, writes one JSON report. If validation throws, writes a fallback JSON report with `status: "failed"`. Help text is printed to stdout for `--help`/`-h`. | CLI usage errors print a short error message and, for missing/unknown args, usage text. Normal validation should not write diagnostics to stderr. | `0` when `report.summary.passed === true`; `1` when validation completes but static blocking failure/error exists, or fallback error report is emitted; `2` for CLI usage errors such as missing fixture path, unknown argument, or unsupported format. |
| `pnpm validate:fixtures [fixture-path ...] [--format json]` | Optional one or more fixture directories. Optional `--format json`; `--json` is accepted as a JSON shortcut. `--help`/`-h` prints usage. JSON is the default and only supported output format. With no paths, scans `fixtures/*` direct child directories, ignores hidden/non-directory/incomplete fixture roots, and sorts discovered paths lexicographically. With explicit paths, validates only those directories in user-supplied order. | On successful CLI parsing, writes one multi-fixture JSON report with `kind: "multi-fixture-validation-report"`. Help text is printed to stdout for `--help`/`-h`. | CLI usage errors print a short error message. Normal validation should not write diagnostics to stderr. | `0` when every included fixture report passes; `1` when at least one fixture fails validation or no scan-eligible fixture is found; `2` for CLI usage errors such as unknown argument, unsupported format, or explicit path that does not exist / is not a directory. |
| `pnpm validate:all` | No public args/flags. Phase 2B local aggregate entry that runs `scripts/validate-fixtures.mjs` and then `scripts/validate-fixture-matrix.mjs` in sequence. The matrix stage still runs even if the positive fixture stage exits non-zero. | Writes a human-readable aggregate suite summary to stdout. It parses the `validate:fixtures` JSON stdout and prints compact fields such as `fixtures passed 3/3`, `totalChecks`, `blockingFailures`, `warnings`, and `errors`, then prints the matrix stdout under a stage heading. It does **not** emit a suite JSON contract. | Child stderr is summarized/preserved. If the `validate:fixtures` stdout is not parseable JSON, stdout/stderr snippets are printed for diagnosis. | `0` only when `validate:fixtures` exits `0`, its stdout parses as JSON, and `validate:fixture:matrix` exits `0`; `1` if either child exits non-zero or the positive fixture JSON cannot be parsed; `2` for aggregate CLI usage errors such as unsupported arguments. |
| `pnpm validate:fixture:matrix` | No public args/flags. Uses the baseline fixture, copies it to temp directories, mutates representative cases, and invokes `scripts/validate-fixture.mjs` with JSON output internally. | Human-readable case summary lines, for example `✓ positive baseline: exit=0, passed=true, failedRules=-`, followed by `Fixture matrix passed: N/N cases.` when all assertions pass. | Matrix-level failures print `Fixture matrix failed: X/N cases failed.`; unexpected child stderr is reported as a case assertion error. | `0` when every matrix case has expected exit code, parseable JSON, expected pass/fail status, and expected target rule failures; `1` when any matrix assertion or matrix runtime error fails. |

### CLI usage error example: exit 2

```bash
pnpm validate:fixture --format yaml
```

Expected behavior:

```text
Unsupported format: yaml. Only json is supported.
# exits 2
```

For missing path or unknown arguments, the CLI also prints usage help.

## Standalone preflight CLI contract

The Phase 3 preflight CLI is intentionally separate from the static validator command family. It produces a `runtime-preflight-result` artifact and is not part of `pnpm validate`, `pnpm validate:all`, or `pnpm validate:contracts`.

| Command | Args / flags | stdout | stderr | Exit code |
| --- | --- | --- | --- | --- |
| `pnpm validate:preflight <fixture-path> [--format json]` | Required positional `<fixture-path>`. Optional `--format json`; `--json` is accepted as a JSON shortcut. `--help`/`-h` prints usage. JSON is the default and only supported output format. | On successful CLI parsing, writes one preflight JSON artifact with `kind: "runtime-preflight-result"`. If preflight execution throws, writes a fallback preflight JSON report with `status: "failed"`. Help text is printed to stdout for `--help`/`-h`. | CLI usage errors print a short error message and, for missing/unknown args, usage text. Normal preflight validation should not write diagnostics to stderr. | `0` when `report.summary.passed === true`; `1` when preflight completes with blocking failure/error or fallback error report is emitted; `2` for CLI usage errors such as missing fixture path, unknown argument, or unsupported format. |

Notes:

- This CLI internally reuses the existing `loadFixture()` and `validateFixture()` chain before running `validatePreflight()`; it does not introduce a second raw fixture parsing pipeline.
- `summary.totalChecks` in the preflight artifact counts preflight checks only, not static validator checks or runtime replay cases.
- A passing preflight artifact still does **not** mean runtime replay ran. It only means the fixture passes the current standalone runtime-readiness gate.

## Standalone runtime draft CLI contract

The Phase 3 runtime draft CLI is intentionally separate from the static validator, preflight CLI, and runtime contract test entrypoints. It is a thin standalone entry for the current single-fixture, single-case runtime skeleton wiring and does not claim that provider-backed runtime replay exists.

Current coverage is intentionally narrow:

- the standalone CLI already exists;
- orchestration only covers `static validation -> preflight -> single-case selection -> provider adapter seam -> dry-run/null-runner runtime skeleton -> runtime draft artifact`;
- the provider adapter seam is contract-first only: it freezes adapter-facing input/output boundaries without enabling provider-backed execution;
- provider-backed selection wiring has been tightened only as an internal lineage: selection now flows on the single path `adapter -> runner -> observed mapper -> report`, which unifies truth propagation but does not open provider-backed execution;
- transcript evidence is currently provider-less and draft-only;
- `dry-run`, `null-runner`, and a future provider-backed mode are currently treated as separate mode slots, but only the first two are reachable today;
- the provider-backed slot is reserved/unimplemented and is not exposed as a user-selectable CLI mode;
- provider-backed reserved-slot fields remain contract-tightened placeholders only: fields such as provider execution metadata, provider transcript bits, persistence handles, and provider evidence availability must currently remain `false`, `null`, `"none"`, or other explicit reserved values rather than implying provider execution;
- it is a draft execution surface, not a formal validation gate;
- it is not transcript-capable runtime replay.

| Command | Args / flags | stdout | stderr | Exit code |
| --- | --- | --- | --- | --- |
| `pnpm validate:runtime:draft <fixture-path> [--case-id <id> \| --case-index <n>] [--mode dry-run\|null-runner] [--format json]` | Required positional `<fixture-path>`. Optional `--case-id <id>` or `--case-index <n>` for single-case selection. Optional `--mode dry-run\|null-runner`; default is `dry-run`. Optional `--format json`; `--json` is accepted as a JSON shortcut. `--help`/`-h` prints usage. JSON is the default and only supported output format. Provider-backed mode remains reserved/unimplemented and is intentionally not exposed as a CLI flag. | On successful CLI parsing, writes one runtime draft JSON artifact with `kind: "runtime-replay-report"`. If orchestration throws, writes a fallback runtime draft JSON artifact with `status: "failed"`. Help text is printed to stdout for `--help`/`-h`. | CLI usage errors print a short error message and, for missing/unknown args, usage text. Normal runtime draft execution should not write diagnostics to stderr. | `0` when the CLI successfully completes the current static -> preflight -> single-case runtime skeleton orchestration and emits a runtime draft artifact, even if the artifact summary is non-passing because the case is `blocked`, `dry-run`, or `not-executed`; `1` when runtime draft orchestration itself throws and a fallback error artifact is emitted; `2` for CLI usage errors such as missing fixture path, mutually exclusive `--case-id` / `--case-index`, unknown argument, unsupported mode, unsupported format, or invalid case index value. |

Notes:

- This CLI currently reuses `loadFixture()`, `validateFixture()`, `validatePreflight()`, provider adapter seam contracts, and `runRuntimeCaseSkeleton()` through the runtime draft orchestrator; it does not introduce provider execution, transcript persistence, sandbox enforcement, multi-case orchestration, or a separate raw fixture parsing pipeline.
- The provider adapter seam is a contract-first integration seam only. It exists so future provider-backed work has a stable boundary, not because provider-backed replay is already available.
- The orchestration scope stops at preflight plus the current single-case dry/null runtime skeleton. It does not perform provider-backed runtime replay and should not be interpreted as a production runtime gate.
- If preflight does not pass, the runtime draft flow should collapse that outcome into an honest runtime `blocked` state rather than preserving a misleading pseudo-executional `preflight-failed` runtime label.
- CLI success does **not** mean runtime passed. In the current draft phase, the emitted artifact must remain honest about `blocked`, `dry-run`, and `not-executed` outcomes.
- The current draft runtime artifact contract is intentionally non-executional: top-level `status` is constrained to `draft` or `blocked`, `summary.passed` must remain `false`, `cases[].status` is constrained to `blocked | error | dry-run | not-executed`, and `observed` stays a stub-shaped truth mapping output rather than execution proof.
- The current provider adapter result is only a more realistic intermediate truth payload. It normalizes one adapter result into the current `cases[].observed`, `rawResponse`, `providerExecution`, and `transcriptAvailability` slots so those four views stay same-source and same-claim.
- That same-source propagation is intentionally restricted to the internal lineage `adapter -> runner -> observed mapper -> report`; this tightening prevents downstream layers from inventing alternate provider-backed selection sources, but it still does not mean provider-backed execution is available.
- In the currently reachable draft flows, case outcomes should remain within `blocked | dry-run | not-executed`; the reserved `error` slot exists only for orchestration/runtime skeleton error reporting and must not be interpreted as provider execution.
- Phase 3 transcript evidence is currently limited to provider-less draft evidence for a single selected case. When emitted, `transcriptRef` is only an in-report draft transcript artifact ref and must not be interpreted as transcript persistence, provider transcript support, or a reusable transcript registry.
- Any emitted transcript evidence must continue to declare `providerTranscript=false` and must not claim provider execution.
- Provider-backed reserved-slot fields must remain honest in the emitted artifact: `summary.passed` stays `false`; `rawResponse` remains same-source passthrough rather than proof of a real provider call; `providerExecution` stays reserved/unimplemented for true provider-backed execution; `transcriptAvailability` stays non-provider/non-persistent; provider transcript handles stay unavailable; persistence stays reserved/unimplemented; and provider evidence availability must not be set true.
- Multi-case aggregate transcript collection is not supported; transcript evidence, if present, is per selected case only.
- Provider execution, provider transcript capture, transcript capture/persistence, sandbox enforcement, scoring, and multi-case aggregate orchestration remain unimplemented.
- The implementation-prep checklist for future provider-backed work is documented separately in `docs/phase-3-provider-backed-slot-contract-checklist.md`; that checklist is preparation only and must not be read as provider integration already being complete.
- This entrypoint is intentionally not wired into `pnpm validate`, `pnpm validate:all`, `pnpm validate:contracts`, `pnpm validate:preflight`, or `pnpm validate:preflight:contracts`.
- The default validate family therefore remains static/preflight-only and does not expose runtime/provider-backed execution paths.

## Standalone runtime contract test entry

The current Phase 3 runtime contract test entry is also intentionally separate from both static and preflight contract suites.

| Command | Args / flags | stdout | stderr | Exit code |
| --- | --- | --- | --- | --- |
| `pnpm validate:runtime:contracts` | No public args/flags. Runs `scripts/test-runtime-contracts.mjs` as a minimal standalone contract suite. | Human-readable case summary lines such as `✓ runtime replay report skeleton top-level contract`, followed by `Runtime contract tests passed: N/N cases.` when all assertions pass. | Node assertion/runtime errors only when a runtime contract assertion fails unexpectedly. | `0` when every runtime contract assertion passes; `1` when any runtime contract assertion or script runtime error fails. |

Current scope:

- validates the `runtime-replay-report` skeleton top-level contract and `kind === runtime-replay-report`;
- validates single-case selector stability for default first case, `caseId`, and `caseIndex` selection;
- validates that `dry-run` / `null-runner` results never masquerade as `passed` runtime execution;
- validates blocked-case summary/check alignment and `blockedCases` accounting;
- validates that `pendingCapabilities`, sandbox declaration-only metadata, lineage references, reserved provider-backed mode semantics, and runtime report notes stay explicit about unimplemented provider transcript support, transcript persistence, scoring, and sandbox enforcement.

Intentional limits:

- no real provider execution;
- no provider-backed runtime replay;
- no provider transcript support;
- no transcript persistence;
- no multi-case aggregate transcript evidence;
- no sandbox enforcement verification;
- no integration into `pnpm validate:contracts` or `pnpm validate:preflight:contracts`;
- no claim that passing runtime contract tests means runtime replay is implemented.

## Multi-fixture report contract

`validate:fixtures` is the Phase 2A minimal multi-positive static validation entry. It directly validates each fixture with the existing single fixture validator and does **not** change the single fixture report contract described below.

Top-level multi-fixture fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reportVersion` | string | Yes | Same report contract version family as the single fixture report. |
| `ruleSetVersion` | string | Yes | Current static MVP rule set version. |
| `kind` | string | Yes | Always `multi-fixture-validation-report`. |
| `status` | string | Yes | `passed` only when every included fixture passes. |
| `summary` | object | Yes | Aggregated counts across included fixture reports. |
| `fixtures` | array | Yes | One compact entry per validated fixture. Each entry includes `path`, `id`, `version`, `entry`, `profile`, `status`, `summary`, and `findings`. `profile` is emitted as a compatibility field and may be `null`. |
| `failures` | array | Yes | Compact failure/warning records derived from failed or warning findings; evidence is reused from the already-sanitized single fixture report. |
| `metadata` | object | Yes | Includes `generatedAt`, `validator`, `format`, and `runner`. |

`summary` contains:

- `passed`
- `totalFixtures`
- `passedFixtures`
- `failedFixtures`
- `totalChecks`
- `blockingFailures`
- `warnings`
- `errors`
- `byStatus`
- `bySeverity`

Default scan mode only includes `fixtures/*` direct child directories that look like complete fixture roots by required files. Explicit path mode is stricter about CLI path validity but still lets the single fixture validator report structural failures for existing directories that are incomplete.

Exit codes:

- `0`: all included fixtures passed.
- `1`: at least one included fixture failed validation, or scan mode found no eligible fixtures.
- `2`: CLI usage error, unsupported format, unknown argument, or explicit path does not exist / is not a directory.

`validate:all` is the Phase 2B local aggregate entry. It consumes `validate:fixtures` as the multi-positive JSON artifact producer, prints only a human-readable suite summary, then runs the independent positive/negative matrix gate. Downstream tools that need the multi-fixture JSON report should keep calling `validate:fixtures` directly.

## Minimal contract test entry

Phase 2E adds a lightweight contract-test script without introducing a test framework or changing validator semantics:

```bash
pnpm --silent validate:contracts
```

Current scope:

- reruns the three documented positive single-fixture JSON commands;
- reruns `validate:fixtures` and asserts the current multi-fixture JSON contract;
- reruns `validate:all` and asserts only stable aggregate stdout markers;
- reruns `validate:fixture:matrix` and asserts only stable case-summary markers;
- locks the current lightweight schema-gate baseline for `skill-manifest.yaml` and `replay-cases.yaml` via the increased positive check counts.

Intentional limits:

- no full JSON snapshotting;
- no assertion on `generatedAt` values;
- no assertion on object key order, whitespace, or full stdout layout;
- current `17` checks per positive fixture and `51` total checks are treated as the lightweight-schema prototype baseline, so if the validator contract intentionally evolves those constants should be updated together with the docs.

### Positive fixture profiles

The current default positive fixture scan covers three complete fixture roots and therefore exercises the profile passthrough field across the minimal documented range now in use:

| Fixture | Expected `fixture.profile` | Notes |
| --- | --- | --- |
| `fixtures/meeting-summary-assistant` | `null` | Legacy baseline; no profile declaration. |
| `fixtures/study-card-assistant` | `simple` | Required files only; no attached resources. |
| `fixtures/release-notes-assistant` | `standard` | Includes `templates/` and `examples/` attachments while remaining static-only and side-effect-free. |

These profile values are still passthrough-compatible fields. The lightweight schema prototype only performs a compatibility enum check for `simple | standard | advanced-reserved` and does not add a blocking profile rule.

A passing `validate:fixtures` report should currently have `summary.totalFixtures=3` and `summary.passedFixtures=3`. This still does not imply runtime replay, cross-platform, cross-model, or CI success.

## JSON report top-level fields

`validate:fixture` writes a single JSON object to stdout. The actual report contains more fields than the smaller compatibility subset exposed through `metadata.contract.topLevelFields` / `JSON_REPORT_CONTRACT`.

| Field | Type | Required | Stability | Notes |
| --- | --- | --- | --- | --- |
| `reportVersion` | string | Yes | Stable for this contract version | Current value: `0.1.0`. |
| `ruleSetVersion` | string | Yes | Stable for current static MVP unless overridden by internal options | Current default: `skillforge-static-mvp-0.1.0`. |
| `fixture` | object | Yes | Stable shape | Fixture identity and entry metadata. |
| `status` | string | Yes | Stable | `"passed"` when `summary.passed` is true, otherwise `"failed"`. |
| `summary` | object | Yes | Stable shape, values runtime-generated | Aggregates check counts and pass/fail status. |
| `checks` | array | Yes | Stable shape | Sorted by `id`; contains one result per emitted static check. |
| `errors` | array | Yes | Stable shape | Non-rule validation/CLI fallback errors. Empty on clean validation. |
| `metadata` | object | Yes | Stable shape, values runtime-generated | Includes `generatedAt`, validator name, format, and compatibility contract metadata. |
| `rules` | object | Yes | Compatibility alias | Alias for rule counts (`total`, `P0`, `P1`, `P2`) kept for the T2/basic compatibility contract. |
| `findings` | array | Yes | Compatibility alias | Alias subset of `checks` whose `status` is `fail`, `warn`, or `error`. |
| `generatedAt` | string | Yes | Runtime-generated compatibility alias | Top-level timestamp matching `metadata.generatedAt`; do not snapshot-test. |

## Field contracts

### `fixture`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string or null | Yes | Safe path relative to current working directory when possible; otherwise basename only. |
| `id` | string or null | Yes | Normalized fixture id when available. |
| `version` | string or null | Yes | Normalized fixture version when available. |
| `entry` | string or null | Yes | Expected static MVP entry is `skill/SKILL.md`. |
| `profile` | string or null | Yes | Phase 2C compatibility passthrough field. Read from `skill-manifest.yaml` top-level `profile` first, then `skill/SKILL.md` frontmatter `metadata.profile`; no enum validation or blocking rule is applied. Current fixtures emit `null` for `meeting-summary-assistant` and `simple` for `study-card-assistant`. |

### `summary`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `passed` | boolean | Yes | True only when there are no `errors` and no blocking `P0`/`P1` checks with `fail` or `error` status. |
| `total` | number | Yes | Number of entries in `checks`. Current positive baseline is `17` after adding two lightweight schema P1 checks for manifest/replay-cases. |
| `byStatus` | object | Yes | Count map keyed by check status, for example `pass`, `fail`, `warn`, `error`. |
| `bySeverity` | object | Yes | Count map keyed by severity, for example `P0`, `P1`, `P2`. |
| `blockingFailures` | number | Yes | Count of `P0`/`P1` checks with `fail` or `error` status. |
| `warnings` | number | Yes | Count of checks whose status is `warn`. |
| `errors` | number | Yes | Count of entries in `errors`. |

### `checks[]`

Each check is a rule result enriched with the rule registry metadata.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | Yes | Stable rule id from the registry. Current set now includes `SF-P1-STRUCTURE-MANIFEST-SCHEMA-MINIMAL` and `SF-P1-STRUCTURE-REPLAY-CASES-SCHEMA-MINIMAL`. |
| `dimension` | string | Yes | One of `structure`, `trigger`, `boundary`, `dependency`, `replay`, `privacy`, `compatibility`. |
| `severity` | string | Yes | `P0`, `P1`, or `P2`. |
| `status` | string | Yes | Current statuses include `pass`, `fail`, `warn`, and `error`. |
| `message` | string | Yes | Human-readable diagnostic summary. |
| `evidence` | array | Yes | Evidence objects; details are sanitized/truncated. |
| `closeCondition` | string | Yes | Rule-specific remediation condition copied from the rule registry. |

### `checks[].evidence[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | string | Yes | Relative fixture/source hint such as `skill/SKILL.md`, `skill-spec.yaml`, or `.`. |
| `detail` | string | Yes | Sanitized evidence detail. Private paths, secrets, and internal IPs are redacted; values are truncated to 500 characters. |

### `errors[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | Yes | Error code/name, defaulting to `VALIDATION_ERROR`, `VALIDATION_EXCEPTION`, or `CLI_ERROR` depending on path. |
| `message` | string | Yes | Sanitized error message. |
| `file` | string | No | Optional source file hint when available. |
| `ruleId` | string | No | Optional related rule id when available. |

### `metadata`

| Field | Type | Required | Stability | Notes |
| --- | --- | --- | --- | --- |
| `generatedAt` | string | Yes | Runtime-generated | ISO timestamp; do not snapshot-test. |
| `validator` | string | Yes | Stable | Current value: `skillforge-static-mvp`. |
| `format` | string | Yes | Stable | Current value: `json` for the CLI. |
| `contract` | object | Yes | Compatibility metadata | Contains the smaller compatibility contract advertised to downstream tooling. |
| `contract.topLevelFields` | string[] | Yes | Stable compatibility subset | Current subset: `fixture`, `status`, `summary`, `rules`, `findings`, `generatedAt`. |
| `contract.findingFields` | string[] | Yes | Stable compatibility subset | Current subset: `id`, `severity`, `dimension`, `message`, `evidence`, `closeCondition`. |


## Phase 2 profile compatibility field

Phase 2C emits `fixture.profile` as a compatible passthrough field in single-fixture reports and in `validate:fixtures` compact fixture entries. The minimal documented enum remains `simple | standard | advanced-reserved`, but the validator currently does not enforce that enum, does not emit profile warnings/errors, and does not add any blocking profile rule.

Recommended declaration locations remain `skill-manifest.yaml` top-level `profile` as the primary declaration and `skill/SKILL.md` frontmatter `metadata.profile` as a redundant/compatibility declaration. If both exist and differ, manifest wins by normalization precedence; this is not a validation failure. Existing top-level fields and existing `fixture` field semantics remain unchanged.

## Rule registry fields

Rules are defined by the static MVP registry and copied into check results where applicable.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | Yes | Stable rule identifier, for example `SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK`. |
| `dimension` | string | Yes | Canonical review dimension. |
| `severity` | string | Yes | `P0`, `P1`, or `P2`. |
| `scope` | string | Yes in registry | Human-readable scope of files/data the rule covers. Not currently copied into `checks[]`. |
| `description` | string | Yes in registry | Human-readable rule intent. Not currently copied into `checks[]`. |
| `evidence` | string[] | Yes in registry | Examples of evidence the rule considers. Check results contain concrete `checks[].evidence[]` objects instead. |
| `closeCondition` | string | Yes | Remediation condition; copied into each check result. |

## Severity semantics

| Severity | Meaning | Blocking? | Report effect |
| --- | --- | --- | --- |
| `P0` | High-priority safety, privacy, replay honesty, dependency, or compatibility risk. | Yes | `fail` or `error` makes `summary.passed=false`, increments `blockingFailures`, and exits `1`. |
| `P1` | Required static MVP structure/contract correctness. | Yes | `fail` or `error` makes `summary.passed=false`, increments `blockingFailures`, and exits `1`. |
| `P2` | Diagnostic quality or future-improvement warning/backlog. | No | `warn` increments `warnings` but does not by itself fail the report. |

`summary.passed` is derived from actual rule outcomes and top-level validation errors; it is not an independently authored success flag.

## Checklist aggregation semantics

`SF-P1-STRUCTURE-SEVEN-DIMENSION-CHECKLIST` checks the **union** of supported checklist sources. It does **not** require a single file to list the seven dimensions exactly once.

Supported sources:

- `workflowSource`
- `skillSpec`
- `generationRun`
- `skillManifest`
- `replayCases`
- `validationResult`
- nested `validation checks` from `validationResult.validation.checks`
- `skill/SKILL.md` body checklist lines

A dimension is covered when any supported source provides its canonical name. Canonical dimensions are:

```text
structure, trigger, boundary, dependency, replay, privacy, compatibility
```

Aliases, misspellings, and non-canonical casing are not counted toward canonical coverage.

## Privacy evidence and redaction

Evidence details are sanitized before entering reports. Current redaction behavior includes:

- private filesystem paths are replaced with `<redacted-path>`;
- secret/token/password/key assignments keep the key context but replace the value with `<redacted-secret>`;
- internal IPs are replaced with `<redacted-internal-ip>`;
- evidence detail strings are truncated to 500 characters.

Examples:

```json
{ "file": "README.md", "detail": "token: <redacted-secret>" }
```

```json
{ "file": "README.md", "detail": "Private example: <redacted-path>/.ssh/id_rsa" }
```

Redaction is a report-safety measure, not a guarantee that arbitrary sensitive data can be safely committed. Fixtures should use fictional/public data before validation.

## Examples

### Passing report, shortened

```json
{
  "reportVersion": "0.1.0",
  "ruleSetVersion": "skillforge-static-mvp-0.1.0",
  "fixture": {
    "path": "fixtures/meeting-summary-assistant",
    "id": "meeting-summary-assistant",
    "version": "0.1.0",
    "entry": "skill/SKILL.md"
  },
  "status": "passed",
  "summary": {
    "passed": true,
    "total": 17,
    "byStatus": { "pass": 17 },
    "bySeverity": { "P0": 5, "P1": 10, "P2": 2 },
    "blockingFailures": 0,
    "warnings": 0,
    "errors": 0
  },
  "checks": [
    {
      "id": "SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK",
      "dimension": "privacy",
      "severity": "P0",
      "status": "pass",
      "message": "No high-confidence secret, private path, or internal IP pattern found.",
      "evidence": [{ "file": ".", "detail": "privacy scan completed" }],
      "closeCondition": "Remove or redact the sensitive value with a stable placeholder and rerun validation without high-confidence privacy findings."
    }
  ],
  "errors": [],
  "metadata": {
    "generatedAt": "2026-05-21T04:40:00.000Z",
    "validator": "skillforge-static-mvp",
    "format": "json",
    "contract": {
      "topLevelFields": ["fixture", "status", "summary", "rules", "findings", "generatedAt"],
      "findingFields": ["id", "severity", "dimension", "message", "evidence", "closeCondition"]
    }
  },
  "rules": { "total": 17, "P0": 5, "P1": 10, "P2": 2 },
  "findings": [],
  "generatedAt": "2026-05-21T04:40:00.000Z"
}
```

### Blocking failure report, shortened

```json
{
  "reportVersion": "0.1.0",
  "ruleSetVersion": "skillforge-static-mvp-0.1.0",
  "fixture": {
    "path": "tmp/private-path-case",
    "id": "meeting-summary-assistant",
    "version": "0.1.0",
    "entry": "skill/SKILL.md"
  },
  "status": "failed",
  "summary": {
    "passed": false,
    "total": 17,
    "byStatus": { "pass": 16, "fail": 1 },
    "bySeverity": { "P0": 5, "P1": 10, "P2": 2 },
    "blockingFailures": 1,
    "warnings": 0,
    "errors": 0
  },
  "checks": [
    {
      "id": "SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK",
      "dimension": "privacy",
      "severity": "P0",
      "status": "fail",
      "message": "High-confidence private data pattern found.",
      "evidence": [
        { "file": "README.md", "detail": "Private examples: <redacted-path>/.ssh/id_rsa" }
      ],
      "closeCondition": "Remove or redact the sensitive value with a stable placeholder and rerun validation without high-confidence privacy findings."
    }
  ],
  "errors": [],
  "rules": { "total": 17, "P0": 5, "P1": 10, "P2": 2 },
  "findings": [
    {
      "id": "SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK",
      "dimension": "privacy",
      "severity": "P0",
      "status": "fail"
    }
  ],
  "generatedAt": "2026-05-21T04:40:00.000Z"
}
```

### Matrix human-readable output

`validate:fixture:matrix` is not a JSON-reporting command. It validates its internal child reports, then prints human-readable lines such as:

```text
✓ positive baseline: exit=0, passed=true, failedRules=-
✓ private path: exit=1, passed=false, failedRules=SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK
Fixture matrix passed: 6/6 cases.
```

Use `validate:fixture` for machine-readable report integration.

## Compatibility notes

- `metadata.generatedAt` and top-level `generatedAt` are runtime-generated; do not snapshot-test exact values.
- `rules` and `findings` are compatibility aliases for the basic/T2 report contract. Prefer `checks` for full rule result detail.
- `metadata.contract.topLevelFields` lists a compatibility subset, not every field currently emitted.
- The actual report fields are more complete than `JSON_REPORT_CONTRACT`: current reports also include `reportVersion`, `ruleSetVersion`, `checks`, `errors`, and `metadata`.
- The contract documents current behavior only. New runtime replay, generation, UI, repair, publishing, or broader fixture capabilities should not be inferred until implemented and documented.

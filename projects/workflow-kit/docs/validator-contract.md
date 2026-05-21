# SkillForge Validator Contract

This document describes the current SkillForge static MVP validator contract as implemented in this repository. It is intended for developers integrating with, testing, or extending the validator without overstating capabilities that do not exist yet.

## Status and scope

| Item | Contract |
| --- | --- |
| Status | Static MVP validator contract. |
| Rule set | `skillforge-static-mvp-0.1.0`. |
| Report version | `0.1.0`. |
| Primary fixture path | Any supplied fixture directory, with the repository baseline fixture at `fixtures/meeting-summary-assistant`. |
| Validator mode | Static file/content validation only. |
| In scope | Required fixture files, Skill frontmatter, entry path, trigger wording, conservative boundaries, dependency declarations, replay honesty claims, privacy scans, checklist coverage, and JSON report shape. |
| Out of scope | Model replay execution, skill generation, automatic repair, publishing, UI, batch product workflow, cross-model proof, cross-platform proof, or runtime behavior guarantees. |

A passing report means the fixture passed the current static checks. It does **not** mean a model replay ran, a generator produced the skill, or a UI/runtime integration was verified.

## CLI contract

Run commands from the repository root.

| Command | Args / flags | stdout | stderr | Exit code |
| --- | --- | --- | --- | --- |
| `pnpm validate:fixture <fixture-path> [--format json]` | Required positional `<fixture-path>`. Optional `--format json`; `--json` is accepted as a JSON shortcut. `--help`/`-h` prints usage. JSON is the default and only supported output format. | On successful CLI parsing, writes one JSON report. If validation throws, writes a fallback JSON report with `status: "failed"`. Help text is printed to stdout for `--help`/`-h`. | CLI usage errors print a short error message and, for missing/unknown args, usage text. Normal validation should not write diagnostics to stderr. | `0` when `report.summary.passed === true`; `1` when validation completes but static blocking failure/error exists, or fallback error report is emitted; `2` for CLI usage errors such as missing fixture path, unknown argument, or unsupported format. |
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

### `summary`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `passed` | boolean | Yes | True only when there are no `errors` and no blocking `P0`/`P1` checks with `fail` or `error` status. |
| `total` | number | Yes | Number of entries in `checks`. |
| `byStatus` | object | Yes | Count map keyed by check status, for example `pass`, `fail`, `warn`, `error`. |
| `bySeverity` | object | Yes | Count map keyed by severity, for example `P0`, `P1`, `P2`. |
| `blockingFailures` | number | Yes | Count of `P0`/`P1` checks with `fail` or `error` status. |
| `warnings` | number | Yes | Count of checks whose status is `warn`. |
| `errors` | number | Yes | Count of entries in `errors`. |

### `checks[]`

Each check is a rule result enriched with the rule registry metadata.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | Yes | Stable rule id from the registry. |
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
    "total": 15,
    "byStatus": { "pass": 15 },
    "bySeverity": { "P0": 5, "P1": 8, "P2": 2 },
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
  "rules": { "total": 15, "P0": 5, "P1": 8, "P2": 2 },
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
    "total": 15,
    "byStatus": { "pass": 14, "fail": 1 },
    "bySeverity": { "P0": 5, "P1": 8, "P2": 2 },
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
  "rules": { "total": 15, "P0": 5, "P1": 8, "P2": 2 },
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

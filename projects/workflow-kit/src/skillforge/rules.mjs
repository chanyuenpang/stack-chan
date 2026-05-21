export const DIMENSIONS = Object.freeze([
  "structure",
  "trigger",
  "boundary",
  "dependency",
  "replay",
  "privacy",
  "compatibility",
]);

export const SEVERITIES = Object.freeze(["P0", "P1", "P2"]);

export const RULES = Object.freeze([
  {
    id: "SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK",
    dimension: "privacy",
    severity: "P0",
    scope: "skill package, fixture metadata, replay artifacts, validation report",
    description:
      "High-confidence private data or credential patterns must not appear in committed SkillForge fixtures or reports.",
    evidence: [
      "secret/token/key/password literals with concrete values",
      "private filesystem paths such as /home/<user>, /Users/<user>, or workspace internals",
      "private hostnames, internal IPs, personal account identifiers, or chat/user IDs",
    ],
    closeCondition:
      "Remove or redact the sensitive value with a stable placeholder and rerun validation without high-confidence privacy findings.",
  },
  {
    id: "SF-P0-BOUNDARY-DEFAULT-ALLOW-EXTERNAL-OR-DESTRUCTIVE",
    dimension: "boundary",
    severity: "P0",
    scope: "skill/SKILL.md frontmatter and boundary declarations",
    description:
      "Skills must not default-allow outbound messaging, file writes, network access, shell execution, or destructive actions.",
    evidence: [
      "toolBoundary declares broad/default allow for write/edit/delete/exec/web/network/message tools",
      "permissionBoundary allows external side effects without explicit user approval",
      "destructive operations are permitted by default or hidden behind vague wording",
    ],
    closeCondition:
      "Change boundaries to deny-by-default or approval-required with explicit narrow scopes for any side-effecting tool.",
  },
  {
    id: "SF-P0-REPLAY-PASSED-WITHOUT-OBSERVED-EVIDENCE",
    dimension: "replay",
    severity: "P0",
    scope: "replay transcript and validation result",
    description:
      "Replay status must not be reported as passed unless observed replay evidence exists and supports the pass.",
    evidence: [
      "report marks replay.passed=true while replay.observed is absent or false",
      "pass result is inferred from expected behavior instead of captured transcript/events",
      "observed failures are overwritten by a synthetic passed status",
    ],
    closeCondition:
      "Provide observed replay evidence for the pass, or mark replay as not observed/not passed with the real failure reason.",
  },
  {
    id: "SF-P0-DEPENDENCY-PRIVATE-OR-SECRET-REFERENCE",
    dimension: "dependency",
    severity: "P0",
    scope: "dependency declarations, examples, scripts, and fixture metadata",
    description:
      "Dependencies must not require private repositories, private local paths, unpublished internal packages, or embedded secrets.",
    evidence: [
      "file:, git+ssh:, or absolute path dependency pointing to a private location",
      "dependency URL contains credentials or tokens",
      "fixture requires internal services/accounts unavailable to reviewers",
    ],
    closeCondition:
      "Replace the dependency with a public, pinned, reproducible source or document it as unsupported backlog without secrets.",
  },
  {
    id: "SF-P0-COMPATIBILITY-REPORT-FORGES-RESULTS",
    dimension: "compatibility",
    severity: "P0",
    scope: "JSON validation report",
    description:
      "The JSON report must not forge success by omitting blocking P0 findings or contradicting rule outcomes.",
    evidence: [
      "summary indicates success while P0 findings are present",
      "rule result is marked passed despite attached failing evidence",
      "required report fields are fabricated with placeholder success values",
    ],
    closeCondition:
      "Make report success derive from actual rule outcomes and expose all P0 findings in the machine-readable report.",
  },
  {
    id: "SF-P1-STRUCTURE-REQUIRED-FILES",
    dimension: "structure",
    severity: "P1",
    scope: "fixture root",
    description:
      "Each MVP fixture must include the required skill package files needed for static validation.",
    evidence: [
      "missing skill/SKILL.md",
      "missing fixture manifest or metadata file expected by the MVP contract",
      "required path exists but is a directory or unreadable non-text file",
    ],
    closeCondition:
      "Add the required files at the expected relative paths with parseable text content.",
  },
  {
    id: "SF-P1-STRUCTURE-MANIFEST-SCHEMA-MINIMAL",
    dimension: "structure",
    severity: "P1",
    scope: "skill-manifest.yaml",
    description:
      "skill-manifest.yaml must satisfy the current lightweight structural gate before semantic validation runs.",
    evidence: [
      "fixtureId/fixtureVersion/kind/skills is missing or malformed",
      "skills[0] is missing id/name/version/entry/description",
      "permissions exists but does not expose the expected boolean fields",
    ],
    closeCondition:
      "Provide a parseable manifest with the required top-level fields and the minimal first-skill structure expected by the MVP schema gate.",
  },
  {
    id: "SF-P1-STRUCTURE-ENTRYPOINT-SKILL-MD",
    dimension: "structure",
    severity: "P1",
    scope: "fixture manifest entry field",
    description:
      "The fixture entry point must resolve to skill/SKILL.md for the static MVP.",
    evidence: [
      "entry is absent, empty, absolute, or outside the fixture root",
      "entry points to a file other than skill/SKILL.md",
      "entry uses path traversal or platform-specific separators that do not normalize to skill/SKILL.md",
    ],
    closeCondition:
      "Set the entry field to the normalized relative path skill/SKILL.md.",
  },
  {
    id: "SF-P1-STRUCTURE-SKILL-FRONTMATTER-CORE-FIELDS",
    dimension: "structure",
    severity: "P1",
    scope: "skill/SKILL.md YAML frontmatter",
    description:
      "SKILL.md frontmatter must include non-empty name, version, and description fields.",
    evidence: [
      "frontmatter block is missing or malformed",
      "name/version/description is absent or blank",
      "version is not a stable string value suitable for reporting",
    ],
    closeCondition:
      "Provide parseable frontmatter with non-empty name, version, and description values.",
  },
  {
    id: "SF-P1-TRIGGER-DESCRIPTION-ACTIONABLE",
    dimension: "trigger",
    severity: "P1",
    scope: "skill/SKILL.md description metadata and prose",
    description:
      "The description must state the user intent or trigger condition that should activate the skill.",
    evidence: [
      "description is generic marketing text without a trigger",
      "description does not mention when to use the skill",
      "trigger wording conflicts with the documented skill purpose",
    ],
    closeCondition:
      "Rewrite the description to include clear activation conditions and the user task it supports.",
  },
  {
    id: "SF-P1-BOUNDARY-CONSERVATIVE-DECLARATIONS-PRESENT",
    dimension: "boundary",
    severity: "P1",
    scope: "skill/SKILL.md frontmatter or boundary section",
    description:
      "toolBoundary and permissionBoundary must be present or explicitly documented as conservative defaults.",
    evidence: [
      "toolBoundary is missing and no deny-by-default fallback is documented",
      "permissionBoundary is missing and side-effect approval expectations are unclear",
      "boundary language is ambiguous for writes, network calls, external messages, or shell execution",
    ],
    closeCondition:
      "Declare conservative tool and permission boundaries, or state that the MVP treats unspecified side effects as denied.",
  },
  {
    id: "SF-P1-STRUCTURE-SEVEN-DIMENSION-CHECKLIST",
    dimension: "structure",
    severity: "P1",
    scope: "aggregated fixture checklist sources and validation metadata",
    description:
      "The fixture must expose checklist coverage for all seven MVP dimensions after aggregating supported YAML and Markdown sources.",
    evidence: [
      "aggregated checklist coverage is missing one of structure, trigger, boundary, dependency, replay, privacy, compatibility",
      "a dimension may be supplied by workflowSource, skillSpec, generationRun, skillManifest, replayCases, validationResult, validation checks, or the SKILL.md body",
      "dimension names differ by casing, spelling, or aliases and are not counted toward canonical coverage",
    ],
    closeCondition:
      "Add checklist entries so the supported sources collectively cover exactly the seven canonical dimensions exported by DIMENSIONS.",
  },
  {
    id: "SF-P1-DEPENDENCY-MVP-STATIC-DECLARATION",
    dimension: "dependency",
    severity: "P1",
    scope: "fixture dependency metadata",
    description:
      "MVP dependency metadata must be explicit enough for static review and must avoid hidden runtime requirements.",
    evidence: [
      "dependency list is absent while the skill references external tools/packages",
      "required runtime, model, service, or CLI dependency is undocumented",
      "dependency version or availability is too vague for reproducible validation",
    ],
    closeCondition:
      "Document each required dependency with stable name, purpose, and version/range, or mark no external dependencies.",
  },
  {
    id: "SF-P1-COMPATIBILITY-JSON-REPORT-CONTRACT",
    dimension: "compatibility",
    severity: "P1",
    scope: "JSON validation report",
    description:
      "The MVP validator report must preserve a basic machine-readable contract for downstream tooling.",
    evidence: [
      "report is not valid JSON",
      "missing fixture, status, summary, rules, findings, or generatedAt fields",
      "rule findings omit id, severity, dimension, message, evidence, or closeCondition",
    ],
    closeCondition:
      "Emit valid JSON with stable top-level fields and per-finding rule metadata matching this rules catalog.",
  },
  {
    id: "SF-P1-STRUCTURE-REPLAY-CASES-SCHEMA-MINIMAL",
    dimension: "structure",
    severity: "P1",
    scope: "replay-cases.yaml",
    description:
      "replay-cases.yaml must satisfy the current lightweight structural gate before replay honesty and quality rules run.",
    evidence: [
      "fixtureId/kind/cases is missing or malformed",
      "a case is missing id/type/intent/expectedBehavior",
      "case.type is outside positive|negative|edge or observed/passed has an invalid type",
    ],
    closeCondition:
      "Provide a parseable replay-cases file with minimally structured cases and MVP-compatible field types.",
  },
  {
    id: "SF-P2-REPLAY-QUALITY-TRANSCRIPT-MINIMAL",
    dimension: "replay",
    severity: "P2",
    scope: "replay transcript",
    description:
      "Replay evidence should include enough context to diagnose failures, even when not required to block MVP acceptance.",
    evidence: [
      "transcript lacks timestamps or event ordering",
      "only final status is preserved",
      "failure context is too terse for debugging",
    ],
    closeCondition:
      "Record ordered replay steps and concise failure context in future fixture iterations.",
  },
  {
    id: "SF-P2-COMPATIBILITY-DIAGNOSTIC-DETAIL",
    dimension: "compatibility",
    severity: "P2",
    scope: "human-readable diagnostics",
    description:
      "Validator diagnostics should be clear and actionable for authors, but weak wording is backlog rather than blocking.",
    evidence: [
      "messages do not include file/path hints",
      "multiple findings are merged into one vague warning",
      "suggested fix is missing for a non-blocking quality issue",
    ],
    closeCondition:
      "Improve diagnostic wording with location hints and actionable remediation text.",
  },
]);

export const P0_RULES = Object.freeze(RULES.filter((rule) => rule.severity === "P0"));
export const P1_RULES = Object.freeze(RULES.filter((rule) => rule.severity === "P1"));
export const P2_RULES = Object.freeze(RULES.filter((rule) => rule.severity === "P2"));

export const RULE_COUNTS = Object.freeze({
  total: RULES.length,
  P0: P0_RULES.length,
  P1: P1_RULES.length,
  P2: P2_RULES.length,
});

export const JSON_REPORT_CONTRACT = Object.freeze({
  topLevelFields: Object.freeze([
    "fixture",
    "status",
    "summary",
    "rules",
    "findings",
    "generatedAt",
  ]),
  findingFields: Object.freeze([
    "id",
    "severity",
    "dimension",
    "message",
    "evidence",
    "closeCondition",
  ]),
  blockingSeverities: Object.freeze(["P0", "P1"]),
  warningSeverities: Object.freeze(["P2"]),
});

export default RULES;

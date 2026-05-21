import { access } from "node:fs/promises";
import path from "node:path";

import { loadFixture } from "./loader.mjs";
import { normalizeFixture } from "./normalize.mjs";
import { DIMENSIONS, JSON_REPORT_CONTRACT, RULES } from "./rules.mjs";
import { validateSchema } from "./schema.mjs";
import { buildReport } from "./reporter.mjs";

const REQUIRED_FILES = Object.freeze([
  "README.md",
  "workflow-source.yaml",
  "skill-spec.yaml",
  "generation-run.yaml",
  "skill-manifest.yaml",
  "replay-cases.yaml",
  "validation-result.yaml",
  "skill/SKILL.md",
]);

const PRIVATE_PATH_RE = /(?:\/home\/[A-Za-z0-9._-]+|\/Users\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+|\.openclaw|\/workspace\b|\\workspace\b)/giu;
const SECRET_ASSIGNMENT_RE = /\b(?:api[_-]?key|secret|token|password|passwd|credential|access[_-]?token|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{8,})["']?/giu;
const INTERNAL_HOST_RE = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/gu;
const PRIVACY_PATTERNS = Object.freeze([
  { kind: "private-path", regex: /(?:\/home\/[A-Za-z0-9._-]+|\/Users\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+|\.openclaw|\/workspace\b|\\workspace\b)/giu },
  { kind: "secret-assignment", regex: /\b(?:api[_-]?key|secret|token|password|passwd|credential|access[_-]?token|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{8,})["']?/giu },
  { kind: "internal-host", regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/gu },
]);
const SIDE_EFFECT_RE = /(?:network|web|联网|访问网络|外发|发送|message|external|write|写入|delete|删除|覆盖|exec|shell|命令|privatePathRead|私有路径)/iu;
const DENY_RE = /(?:false|deny|denied|不|拒绝|禁止|无|保守|approval|required|需.*批准)/iu;
const TRIGGER_RE = /(?:当用户|用户.*(?:要求|需要|说|请求)|when to use|use when|trigger|触发|整理会议纪要|生成会议总结|提炼会议结论|提取会议待办)/iu;

function ruleById(id) {
  const rule = RULES.find((item) => item.id === id);
  if (!rule) throw new Error(`Unknown rule id: ${id}`);
  return rule;
}

function sanitize(value) {
  return String(value ?? "")
    .replace(PRIVATE_PATH_RE, "<redacted-path>")
    .replace(SECRET_ASSIGNMENT_RE, (match) => match.replace(/[:=]\s*["']?.*$/u, ": <redacted-secret>"))
    .replace(INTERNAL_HOST_RE, "<redacted-internal-ip>")
    .slice(0, 500);
}

function evidence(file, detail) {
  return { file, detail: sanitize(detail) };
}

function check(id, status, message, evidenceItems = []) {
  const rule = ruleById(id);
  return {
    id: rule.id,
    dimension: rule.dimension,
    severity: rule.severity,
    status,
    message,
    evidence: evidenceItems,
    closeCondition: rule.closeCondition,
  };
}

async function fileExists(fixtureDir, relativePath) {
  try {
    await access(path.join(fixtureDir, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function requiredFilesCheck(fixtureDir) {
  const missing = [];
  for (const relativePath of REQUIRED_FILES) {
    if (!(await fileExists(fixtureDir, relativePath))) missing.push(relativePath);
  }
  if (missing.length > 0) {
    return check(
      "SF-P1-STRUCTURE-REQUIRED-FILES",
      "fail",
      `Missing required fixture files: ${missing.join(", ")}`,
      missing.map((file) => evidence(file, "missing required file")),
    );
  }
  return check("SF-P1-STRUCTURE-REQUIRED-FILES", "pass", "All required MVP fixture files are present.", [
    evidence(".", `${REQUIRED_FILES.length} required files found`),
  ]);
}

function collectRawTexts(loaded) {
  return Object.values(loaded?.files ?? {}).map((file) => ({ file: file.path, text: file.raw ?? "" }));
}

function findPrivacyFindings(loaded) {
  const findings = [];
  const seen = new Set();
  for (const { file, text } of collectRawTexts(loaded)) {
    for (const pattern of PRIVACY_PATTERNS) {
      const scanRegex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = scanRegex.exec(text)) !== null) {
        const item = evidence(file, match[0]);
        const key = `${file}\u0000${pattern.kind}\u0000${item.detail}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(item);
        if (findings.length >= 10) return findings;
      }
    }
  }
  return findings;
}

function sideEffectAllowed(value) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return SIDE_EFFECT_RE.test(value) && !DENY_RE.test(value);
}

function hasConservativeBoundary(normalized) {
  const denied = [
    ...(normalized.toolBoundary?.deniedActions ?? []),
    ...(normalized.permissions?.denied ?? []),
    ...(normalized.toolBoundary?.permissions?.denied ?? []),
  ];
  return (
    normalized.toolBoundary?.bodyMentionsConservativeBoundary ||
    normalized.permissions?.conservativeDefault ||
    normalized.toolBoundary?.permissions?.conservativeDefault ||
    denied.length > 0
  );
}

function validateNormalized(normalized, loaded) {
  const checks = [];

  const manifestSchema = validateSchema("skill-manifest", loaded.skillManifest);
  const manifestSchemaErrors = manifestSchema.errors.filter((item) => item.severity !== "warn");
  checks.push(
    manifestSchema.valid
      ? check("SF-P1-STRUCTURE-MANIFEST-SCHEMA-MINIMAL", "pass", "skill-manifest.yaml satisfies the lightweight schema gate.", [evidence("skill-manifest.yaml", "required manifest structure present")])
      : check(
          "SF-P1-STRUCTURE-MANIFEST-SCHEMA-MINIMAL",
          "fail",
          `skill-manifest.yaml failed lightweight schema validation: ${manifestSchemaErrors.map((item) => `${item.field} ${item.message}`).join("; ")}`,
          manifestSchemaErrors.map((item) => evidence("skill-manifest.yaml", `${item.field} ${item.message}`)),
        ),
  );

  const replaySchema = validateSchema("replay-cases", loaded.replayCases);
  const replaySchemaErrors = replaySchema.errors.filter((item) => item.severity !== "warn");
  checks.push(
    replaySchema.valid
      ? check("SF-P1-STRUCTURE-REPLAY-CASES-SCHEMA-MINIMAL", "pass", "replay-cases.yaml satisfies the lightweight schema gate.", [evidence("replay-cases.yaml", "required replay case structure present")])
      : check(
          "SF-P1-STRUCTURE-REPLAY-CASES-SCHEMA-MINIMAL",
          "fail",
          `replay-cases.yaml failed lightweight schema validation: ${replaySchemaErrors.map((item) => `${item.field} ${item.message}`).join("; ")}`,
          replaySchemaErrors.map((item) => evidence("replay-cases.yaml", `${item.field} ${item.message}`)),
        ),
  );

  const entry = normalized.entryPath;
  checks.push(
    entry === "skill/SKILL.md"
      ? check("SF-P1-STRUCTURE-ENTRYPOINT-SKILL-MD", "pass", "Fixture entry points to skill/SKILL.md.", [evidence("skill-manifest.yaml", entry)])
      : check("SF-P1-STRUCTURE-ENTRYPOINT-SKILL-MD", "fail", "Fixture entry must be the relative path skill/SKILL.md.", [evidence("skill-manifest.yaml", entry ?? "missing entry")]),
  );

  const fm = normalized.skillFrontmatter ?? {};
  const missingFrontmatter = ["name", "version", "description"].filter((key) => !String(fm[key] ?? "").trim());
  checks.push(
    missingFrontmatter.length === 0
      ? check("SF-P1-STRUCTURE-SKILL-FRONTMATTER-CORE-FIELDS", "pass", "SKILL.md frontmatter includes name, version, and description.", [evidence("skill/SKILL.md", `name=${fm.name}; version=${fm.version}`)])
      : check("SF-P1-STRUCTURE-SKILL-FRONTMATTER-CORE-FIELDS", "fail", `SKILL.md frontmatter missing: ${missingFrontmatter.join(", ")}`,
          missingFrontmatter.map((field) => evidence("skill/SKILL.md", `missing ${field}`))),
  );

  checks.push(
    TRIGGER_RE.test(fm.description ?? "")
      ? check("SF-P1-TRIGGER-DESCRIPTION-ACTIONABLE", "pass", "Frontmatter description contains actionable trigger wording.", [evidence("skill/SKILL.md", fm.description ?? "")])
      : check("SF-P1-TRIGGER-DESCRIPTION-ACTIONABLE", "fail", "Frontmatter description must include when the skill should be used.", [evidence("skill/SKILL.md", fm.description ?? "missing description")]),
  );

  const allowedBoundary = [
    ...(normalized.toolBoundary?.allowedActions ?? []),
    ...Object.entries(normalized.permissions?.merged ?? {}).filter(([, value]) => value === true).map(([name]) => name),
  ].filter(sideEffectAllowed);
  checks.push(
    allowedBoundary.length === 0
      ? check("SF-P0-BOUNDARY-DEFAULT-ALLOW-EXTERNAL-OR-DESTRUCTIVE", "pass", "No default-allowed external or destructive side effects found.", [evidence("skill-spec.yaml", "side-effect permissions are not default-allowed")])
      : check("SF-P0-BOUNDARY-DEFAULT-ALLOW-EXTERNAL-OR-DESTRUCTIVE", "fail", "Boundary default-allows side-effecting capability.", allowedBoundary.map((item) => evidence("skill-spec.yaml", item))),
  );

  checks.push(
    hasConservativeBoundary(normalized)
      ? check("SF-P1-BOUNDARY-CONSERVATIVE-DECLARATIONS-PRESENT", "pass", "Conservative tool/permission boundary is declared.", [evidence("skill/SKILL.md", "deny-by-default or explicit false permissions found")])
      : check("SF-P1-BOUNDARY-CONSERVATIVE-DECLARATIONS-PRESENT", "fail", "Conservative toolBoundary/permissionBoundary declaration is missing or ambiguous.", [evidence("skill/SKILL.md", "no conservative boundary signal found")]),
  );

  const privacy = findPrivacyFindings(loaded);
  checks.push(
    privacy.length === 0
      ? check("SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK", "pass", "No high-confidence secret, private path, or internal IP pattern found.", [evidence(".", "privacy scan completed")])
      : check("SF-P0-PRIVACY-HIGH-CONFIDENCE-LEAK", "fail", "High-confidence private data pattern found.", privacy),
  );

  const depText = JSON.stringify(normalized.dependencies ?? {});
  const privateDepMatches = [];
  for (const re of [/git\+ssh:/giu, /\bfile:/giu, /https?:\/\/[^\s/@]+:[^\s/@]+@/giu, PRIVATE_PATH_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(depText)) !== null) privateDepMatches.push(evidence("skill-spec.yaml", match[0]));
  }
  checks.push(
    privateDepMatches.length === 0
      ? check("SF-P0-DEPENDENCY-PRIVATE-OR-SECRET-REFERENCE", "pass", "No private dependency or credential-bearing dependency reference found.", [evidence("skill-spec.yaml", "dependency scan completed")])
      : check("SF-P0-DEPENDENCY-PRIVATE-OR-SECRET-REFERENCE", "fail", "Private or secret dependency reference found.", privateDepMatches.slice(0, 10)),
  );

  checks.push(
    normalized.dependencies?.explicit?.length > 0 || normalized.dependencies?.noExternalDependenciesDeclared
      ? check("SF-P1-DEPENDENCY-MVP-STATIC-DECLARATION", "pass", "Dependency metadata is explicit for static review.", [evidence("skill-spec.yaml", normalized.dependencies?.noExternalDependenciesDeclared ? "no external dependencies declared" : "explicit dependencies declared")])
      : check("SF-P1-DEPENDENCY-MVP-STATIC-DECLARATION", "fail", "Dependency metadata must declare dependencies or no external dependencies.", [evidence("skill-spec.yaml", "no dependency declaration found")]),
  );

  const forgedReplay = [];
  for (const replayCase of normalized.replayCases?.cases ?? []) {
    if (replayCase?.passed === true && replayCase?.observed !== true && !replayCase?.observed) {
      forgedReplay.push(evidence("replay-cases.yaml", `case ${replayCase.id ?? "<unknown>"}: passed=true without observed evidence`));
    }
  }
  const validation = normalized.validationResult?.validation ?? {};
  if ((validation.status === "passed" || validation.passed === true) && validation.executed !== true && validation.modelReplayExecuted !== true) {
    forgedReplay.push(evidence("validation-result.yaml", "validation passed without executed/modelReplayExecuted evidence"));
  }
  checks.push(
    forgedReplay.length === 0
      ? check("SF-P0-REPLAY-PASSED-WITHOUT-OBSERVED-EVIDENCE", "pass", "Replay results do not claim pass without observed evidence.", [evidence("replay-cases.yaml", "no forged passed replay status found")])
      : check("SF-P0-REPLAY-PASSED-WITHOUT-OBSERVED-EVIDENCE", "fail", "Replay pass is claimed without observed evidence.", forgedReplay),
  );

  const cases = normalized.replayCases?.cases ?? [];
  const minimalReplay = cases.length > 0 && cases.every((item) => item?.id && item?.intent && item?.expectedBehavior);
  checks.push(
    minimalReplay
      ? check("SF-P2-REPLAY-QUALITY-TRANSCRIPT-MINIMAL", "pass", "Replay cases include minimal diagnostic context for static MVP.", [evidence("replay-cases.yaml", `${cases.length} replay cases with id/intent/expectedBehavior`)])
      : check("SF-P2-REPLAY-QUALITY-TRANSCRIPT-MINIMAL", "warn", "Replay cases should include id, intent, and expected behavior.", [evidence("replay-cases.yaml", "minimal replay context incomplete")]),
  );

  const missingDims = DIMENSIONS.filter((dimension) => !normalized.checklistDimensions?.includes(dimension));
  checks.push(
    missingDims.length === 0
      ? check("SF-P1-STRUCTURE-SEVEN-DIMENSION-CHECKLIST", "pass", "Checklist covers all seven canonical dimensions.", [evidence(".", DIMENSIONS.join(", "))])
      : check("SF-P1-STRUCTURE-SEVEN-DIMENSION-CHECKLIST", "fail", `Checklist missing dimensions: ${missingDims.join(", ")}`,
          missingDims.map((dimension) => evidence(".", `missing ${dimension}`))),
  );

  const requiredReportFields = ["reportVersion", "ruleSetVersion", "fixture", "summary", "checks", "errors", "metadata"];
  checks.push(
    JSON_REPORT_CONTRACT.topLevelFields.includes("fixture") && requiredReportFields.length === 7
      ? check("SF-P1-COMPATIBILITY-JSON-REPORT-CONTRACT", "pass", "Validator can emit the basic JSON report contract.", [evidence("src/skillforge/reporter.mjs", requiredReportFields.join(", "))])
      : check("SF-P1-COMPATIBILITY-JSON-REPORT-CONTRACT", "fail", "JSON report contract metadata is incomplete.", [evidence("src/skillforge/reporter.mjs", "contract missing fields")]),
  );

  checks.push(check("SF-P0-COMPATIBILITY-REPORT-FORGES-RESULTS", "pass", "Report summary is derived from blocking rule outcomes.", [evidence("src/skillforge/reporter.mjs", "summary.passed derives from P0/P1 fail/error checks")]))
  checks.push(check("SF-P2-COMPATIBILITY-DIAGNOSTIC-DETAIL", "pass", "Diagnostics include rule ids, severity, dimensions, messages, and sanitized evidence.", [evidence(".", "diagnostic detail present")]))

  return checks;
}

function errorToReportError(error) {
  return {
    code: error?.code ?? error?.name ?? "VALIDATION_EXCEPTION",
    message: sanitize(error?.message ?? String(error)),
    file: error?.file,
  };
}

export async function validateFixture(fixtureDir, options = {}) {
  const errors = [];
  const checks = [];
  let loaded = null;
  let normalized = null;

  checks.push(await requiredFilesCheck(fixtureDir));

  try {
    loaded = await loadFixture(fixtureDir);
    normalized = normalizeFixture(loaded);
    checks.push(...validateNormalized(normalized, loaded));
  } catch (error) {
    errors.push(errorToReportError(error));
    if (!checks.some((item) => item.id === "SF-P1-STRUCTURE-REQUIRED-FILES" && item.status === "fail")) {
      checks.push(check("SF-P1-STRUCTURE-REQUIRED-FILES", "error", "Fixture could not be loaded for static validation.", [evidence(error?.file ?? ".", error?.message ?? error)]));
    }
  }

  return buildReport({ fixtureDir, normalized, checks, errors, options });
}

export default validateFixture;

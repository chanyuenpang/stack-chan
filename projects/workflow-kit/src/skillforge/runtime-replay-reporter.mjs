import path from "node:path";

export const RUNTIME_REPLAY_REPORT_VERSION = "0.1.0-draft";
export const RUNTIME_REPLAY_PROTOCOL_VERSION = "runtime-replay-protocol-draft-1";
export const RUNTIME_REPLAY_KIND = "runtime-replay-report";

const PASSING_CASE_STATUSES = new Set(["passed"]);
const FAILING_CASE_STATUSES = new Set(["failed", "error"]);
const BLOCKED_CASE_STATUSES = new Set(["blocked", "dry-run", "not-executed"]);
const WARNING_CHECK_STATUSES = new Set(["warn"]);
const ERROR_CHECK_STATUSES = new Set(["error", "fail"]);
const DEFAULT_PENDING_CAPABILITIES = [
  "runtime-runner",
  "sandbox-contract",
  "sandbox-implementation",
  "transcript-engine",
  "provider-integration",
  "scoring-engine",
];

function safeFixturePath(fixtureDir) {
  if (!fixtureDir) return null;
  const cwd = process.cwd();
  const relative = path.relative(cwd, path.resolve(fixtureDir));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return path.basename(path.resolve(fixtureDir));
}

function normalizeCaseStatus(status) {
  if (!status) return "not-executed";
  return String(status);
}

function normalizeRuntimeCase(runtimeCase) {
  return {
    id: runtimeCase?.id ?? null,
    type: runtimeCase?.type ?? null,
    status: normalizeCaseStatus(runtimeCase?.status),
    expectedBehavior: runtimeCase?.expectedBehavior ?? null,
    observed: runtimeCase?.observed ?? null,
    transcriptRef: runtimeCase?.transcriptRef ?? null,
    failureReason: runtimeCase?.failureReason ?? null,
  };
}

function normalizeCheck(check) {
  return {
    id: check?.id ?? null,
    scope: check?.scope ?? "runtime",
    status: check?.status ?? "info",
    severity: check?.severity ?? "P2",
    message: check?.message ?? null,
    evidence: Array.isArray(check?.evidence) ? [...check.evidence] : [],
  };
}

function normalizeError(error) {
  return {
    code: error?.code ?? "RUNTIME_REPLAY_ERROR",
    message: error?.message ?? String(error),
    caseId: error?.caseId ?? null,
    checkId: error?.checkId ?? null,
    file: error?.file ?? null,
  };
}

function buildSummary(runtimeCases, checks, errors) {
  const passedCases = runtimeCases.filter((runtimeCase) => PASSING_CASE_STATUSES.has(runtimeCase.status)).length;
  const failedCases = runtimeCases.filter((runtimeCase) => FAILING_CASE_STATUSES.has(runtimeCase.status)).length;
  const blockedCases = runtimeCases.filter((runtimeCase) => BLOCKED_CASE_STATUSES.has(runtimeCase.status)).length;
  const warnings = checks.filter((check) => WARNING_CHECK_STATUSES.has(check.status)).length;
  const errorCount = errors.length + checks.filter((check) => ERROR_CHECK_STATUSES.has(check.status)).length;
  const passed = failedCases === 0 && errorCount === 0 && runtimeCases.every((runtimeCase) => runtimeCase.status === "passed");

  return {
    passed,
    totalCases: runtimeCases.length,
    passedCases,
    failedCases,
    blockedCases,
    warnings,
    errors: errorCount,
  };
}

export function buildRuntimeReplayReport({
  fixtureDir,
  fixture = null,
  runtime = null,
  cases = [],
  checks = [],
  errors = [],
  options = {},
} = {}) {
  const normalizedCases = cases.map(normalizeRuntimeCase);
  const normalizedChecks = checks.map(normalizeCheck).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const normalizedErrors = errors.map(normalizeError);
  const summary = buildSummary(normalizedCases, normalizedChecks, normalizedErrors);
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  return {
    kind: RUNTIME_REPLAY_KIND,
    reportVersion: options.reportVersion ?? RUNTIME_REPLAY_REPORT_VERSION,
    protocolVersion: options.protocolVersion ?? RUNTIME_REPLAY_PROTOCOL_VERSION,
    fixture: {
      path: safeFixturePath(fixtureDir),
      id: fixture?.id ?? runtime?.fixture?.id ?? null,
      version: fixture?.version ?? runtime?.fixture?.version ?? null,
      entry: fixture?.entry ?? runtime?.fixture?.entry ?? null,
      profile: fixture?.profile ?? runtime?.fixture?.profile ?? null,
    },
    status: summary.passed ? "passed" : "failed",
    summary,
    cases: normalizedCases,
    checks: normalizedChecks,
    errors: normalizedErrors,
    metadata: {
      generatedAt,
      runner: runtime?.runner ?? options.runner ?? null,
      sandbox: runtime?.sandbox ?? options.sandbox ?? null,
      sourceStaticReportVersion: runtime?.staticBaseline?.reportVersion ?? null,
      sourceStaticRuleSetVersion: runtime?.staticBaseline?.ruleSetVersion ?? null,
      sourcePreflightReportVersion: runtime?.preflight?.reportVersion ?? null,
      sourcePreflightProtocolVersion: runtime?.preflight?.protocolVersion ?? null,
      sourceReplayCasesKind: runtime?.replayCases?.kind ?? null,
      executionMode: runtime?.mode ?? null,
      note:
        options.note ??
        "skeleton-only artifact; runtime replay execution evidence is not implemented in this phase",
    },
    pendingCapabilities: Array.isArray(runtime?.pendingCapabilities)
      ? [...runtime.pendingCapabilities]
      : [...DEFAULT_PENDING_CAPABILITIES],
  };
}

export default buildRuntimeReplayReport;

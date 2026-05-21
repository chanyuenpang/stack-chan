import path from "node:path";

export const RUNTIME_REPLAY_REPORT_VERSION = "0.1.0-draft";
export const RUNTIME_REPLAY_PROTOCOL_VERSION = "runtime-replay-protocol-draft-1";
export const RUNTIME_REPLAY_KIND = "runtime-replay-report";

const PASSING_CASE_STATUSES = new Set(["passed"]);
const FAILING_CASE_STATUSES = new Set(["failed", "error"]);
const DRAFT_NON_EXECUTED_CASE_STATUSES = new Set(["blocked", "dry-run", "not-executed"]);
const ALLOWED_DRAFT_CASE_STATUSES = new Set(["blocked", "dry-run", "not-executed"]);
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
const DEFAULT_METADATA_NOTE =
  "runtime draft artifact only: no provider execution, no transcript evidence, no scoring result, no runtime pass evidence";

function safeFixturePath(fixtureDir) {
  if (!fixtureDir) return null;
  const cwd = process.cwd();
  const relative = path.relative(cwd, path.resolve(fixtureDir));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return path.basename(path.resolve(fixtureDir));
}

function normalizeCaseStatus(status) {
  if (!status) return "not-executed";
  const normalized = String(status);
  if (!ALLOWED_DRAFT_CASE_STATUSES.has(normalized)) return "not-executed";
  return normalized;
}

function normalizeObserved(observed, status) {
  const fallback = {
    kind: "runtime-observed-stub",
    evidence: "not-executed",
    providerCall: false,
    transcriptCaptured: false,
    sideEffectsPerformed: false,
    note: `runtime draft reserved observed stub for status ${status}`,
  };

  if (!observed || typeof observed !== "object" || Array.isArray(observed)) return fallback;

  return {
    ...observed,
    kind: observed?.kind ?? fallback.kind,
    evidence: "not-executed",
    providerCall: false,
    transcriptCaptured: false,
    sideEffectsPerformed: false,
    note: observed?.note ?? fallback.note,
  };
}

function normalizeTranscriptRef(transcriptRef, runtimeCase) {
  if (!transcriptRef || typeof transcriptRef !== "object" || Array.isArray(transcriptRef)) return null;

  return {
    ...transcriptRef,
    available: transcriptRef?.available === true,
    providerTranscript: transcriptRef?.providerTranscript === true,
    note:
      transcriptRef?.note ??
      `draft transcript ref only for case ${runtimeCase?.id ?? "<unknown>"}; not a provider transcript reference`,
  };
}

function normalizeRuntimeCase(runtimeCase) {
  const status = normalizeCaseStatus(runtimeCase?.status);
  return {
    id: runtimeCase?.id ?? null,
    type: runtimeCase?.type ?? null,
    status,
    expectedBehavior: runtimeCase?.expectedBehavior ?? null,
    observed: normalizeObserved(runtimeCase?.observed, status),
    transcriptRef: normalizeTranscriptRef(runtimeCase?.transcriptRef, runtimeCase),
    transcript: runtimeCase?.transcript ?? null,
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
  const blockedCases = runtimeCases.filter((runtimeCase) => DRAFT_NON_EXECUTED_CASE_STATUSES.has(runtimeCase.status)).length;
  const warnings = checks.filter((check) => WARNING_CHECK_STATUSES.has(check.status)).length;
  const errorCount = errors.length + checks.filter((check) => ERROR_CHECK_STATUSES.has(check.status)).length;

  return {
    passed: false,
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
    status: normalizedCases.some((runtimeCase) => runtimeCase.status === "blocked") ? "blocked" : "draft",
    summary,
    cases: normalizedCases,
    checks: normalizedChecks,
    errors: normalizedErrors,
    metadata: {
      generatedAt,
      runner: runtime?.runner ?? options.runner ?? null,
      sandbox: runtime?.sandbox ?? options.sandbox ?? null,
      executionMode: runtime?.mode ?? null,
      note: options.note ?? DEFAULT_METADATA_NOTE,
      lineage: {
        static: {
          kind: runtime?.staticBaseline?.kind ?? null,
          reportVersion: runtime?.staticBaseline?.reportVersion ?? null,
          ruleSetVersion: runtime?.staticBaseline?.ruleSetVersion ?? null,
          status: runtime?.staticBaseline?.status ?? null,
        },
        preflight: {
          kind: runtime?.preflight?.kind ?? null,
          reportVersion: runtime?.preflight?.reportVersion ?? null,
          protocolVersion: runtime?.preflight?.protocolVersion ?? null,
          ruleSetVersion: runtime?.preflight?.ruleSetVersion ?? null,
          status: runtime?.preflight?.status ?? null,
        },
        replayCases: {
          kind: runtime?.replayCases?.kind ?? null,
          fixtureId: runtime?.replayCases?.fixtureId ?? null,
        },
      },
      sourceStaticReportVersion: runtime?.staticBaseline?.reportVersion ?? null,
      sourceStaticRuleSetVersion: runtime?.staticBaseline?.ruleSetVersion ?? null,
      sourcePreflightReportVersion: runtime?.preflight?.reportVersion ?? null,
      sourcePreflightProtocolVersion: runtime?.preflight?.protocolVersion ?? null,
      sourceReplayCasesKind: runtime?.replayCases?.kind ?? null,
    },
    pendingCapabilities: Array.isArray(runtime?.pendingCapabilities)
      ? [...runtime.pendingCapabilities]
      : [...DEFAULT_PENDING_CAPABILITIES],
  };
}

export default buildRuntimeReplayReport;

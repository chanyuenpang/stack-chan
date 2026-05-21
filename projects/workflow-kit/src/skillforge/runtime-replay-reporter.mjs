import path from "node:path";

export const RUNTIME_REPLAY_REPORT_VERSION = "0.1.0-draft";
export const RUNTIME_REPLAY_PROTOCOL_VERSION = "runtime-replay-protocol-draft-1";
export const RUNTIME_REPLAY_KIND = "runtime-replay-report";

const FAILING_CASE_STATUSES = new Set(["error"]);
const BLOCKED_CASE_STATUSES = new Set(["blocked"]);
const DRAFT_NON_EXECUTED_CASE_STATUSES = new Set(["blocked", "dry-run", "not-executed"]);
const ALLOWED_DRAFT_CASE_STATUSES = new Set(["blocked", "error", "dry-run", "not-executed"]);
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

const DEFAULT_PROVIDER_EXECUTION_FRAGMENT = Object.freeze({
  selection: null,
  adapterKey: null,
  providerKey: null,
  providerSlot: null,
  builtin: false,
  implemented: false,
  providerBacked: false,
  status: "not-executed",
  executionId: null,
  providerRunId: null,
  providerStatus: null,
  executed: false,
  providerCall: false,
  providerEvidenceAvailable: false,
  transcriptAvailable: false,
  transcriptCaptured: false,
  transcriptPersistence: false,
  persistence: "none",
  rawResponseAvailable: false,
  rawResponseSummary: null,
  rawResponseHandle: null,
  transcriptHandle: null,
  transcriptProviderManaged: false,
  implementationState: null,
  reservedStatusSet: [],
  futureRequiredFields: [],
  pendingCapabilities: [],
  note: null,
});

const DEFAULT_TRANSCRIPT_AVAILABILITY_SKELETON = Object.freeze({
  available: false,
  providerManaged: false,
  handle: null,
  location: null,
  providerBacked: false,
  transcriptCaptured: false,
  transcriptPersistence: false,
  persistence: "none",
  note:
    "runtime observed mapper transcript availability skeleton only; transcript capture/persistence remains intentionally unimplemented in this phase",
});

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
    providerEvidenceAvailable: false,
    persistedEvidenceAvailable: false,
    note: `runtime draft reserved observed stub for status ${status}`,
  };

  if (!observed || typeof observed !== "object" || Array.isArray(observed)) return fallback;

  return {
    ...observed,
    kind: observed?.kind ?? fallback.kind,
    evidence: observed?.evidence ?? "not-executed",
    providerCall: observed?.providerCall === true,
    transcriptCaptured: observed?.transcriptCaptured === true,
    sideEffectsPerformed: observed?.sideEffectsPerformed === true,
    providerEvidenceAvailable: observed?.providerEvidenceAvailable === true,
    persistedEvidenceAvailable: observed?.persistedEvidenceAvailable === true,
    note: observed?.note ?? fallback.note,
  };
}

function normalizeTranscriptRef(transcriptRef, runtimeCase) {
  if (!transcriptRef || typeof transcriptRef !== "object" || Array.isArray(transcriptRef)) return null;

  return {
    ...transcriptRef,
    available: transcriptRef?.available === true,
    providerTranscript: transcriptRef?.providerTranscript === true,
    persistence: transcriptRef?.persistence ?? "in-report-only",
    note:
      transcriptRef?.note ??
      `draft transcript ref only for case ${runtimeCase?.id ?? "<unknown>"}; not a provider transcript reference and not persisted provider evidence`,
  };
}

function normalizeProviderExecution(providerExecution) {
  if (!providerExecution || typeof providerExecution !== "object" || Array.isArray(providerExecution)) {
    return { ...DEFAULT_PROVIDER_EXECUTION_FRAGMENT };
  }

  const selection =
    providerExecution?.selection && typeof providerExecution.selection === "object" && !Array.isArray(providerExecution.selection)
      ? { ...providerExecution.selection }
      : null;

  const normalizedSelection = selection
    ? {
        ...selection,
        kind: selection?.kind ?? "runtime-provider-selection",
        version: selection?.version ?? null,
        adapterKey: selection?.adapterKey ?? providerExecution?.adapterKey ?? DEFAULT_PROVIDER_EXECUTION_FRAGMENT.adapterKey,
        providerKey: selection?.providerKey ?? providerExecution?.providerKey ?? DEFAULT_PROVIDER_EXECUTION_FRAGMENT.providerKey,
        providerSlot: selection?.providerSlot ?? providerExecution?.providerSlot ?? DEFAULT_PROVIDER_EXECUTION_FRAGMENT.providerSlot,
        builtin: selection?.builtin === true || providerExecution?.builtin === true,
        implemented: selection?.implemented === true || providerExecution?.implemented === true,
        providerBacked: selection?.providerBacked === true || providerExecution?.providerBacked === true,
      }
    : null;

  const adapterKey = normalizedSelection?.adapterKey ?? providerExecution?.adapterKey ?? DEFAULT_PROVIDER_EXECUTION_FRAGMENT.adapterKey;
  const providerKey = normalizedSelection?.providerKey ?? providerExecution?.providerKey ?? DEFAULT_PROVIDER_EXECUTION_FRAGMENT.providerKey;
  const providerSlot = normalizedSelection?.providerSlot ?? providerExecution?.providerSlot ?? DEFAULT_PROVIDER_EXECUTION_FRAGMENT.providerSlot;
  const builtin = normalizedSelection?.builtin === true || providerExecution?.builtin === true;
  const implemented = normalizedSelection?.implemented === true || providerExecution?.implemented === true;
  const providerBacked = normalizedSelection?.providerBacked === true || providerExecution?.providerBacked === true;

  return {
    ...providerExecution,
    selection: normalizedSelection,
    adapterKey,
    providerKey,
    providerSlot,
    builtin,
    implemented,
    providerBacked,
    status: providerExecution?.status ?? DEFAULT_PROVIDER_EXECUTION_FRAGMENT.status,
    executionId: providerExecution?.executionId ?? null,
    providerRunId: providerExecution?.providerRunId ?? null,
    providerStatus: providerExecution?.providerStatus ?? null,
    executed: providerExecution?.executed === true,
    providerCall: providerExecution?.providerCall === true,
    providerEvidenceAvailable: providerExecution?.providerEvidenceAvailable === true,
    transcriptAvailable: providerExecution?.transcriptAvailable === true,
    transcriptCaptured: providerExecution?.transcriptCaptured === true,
    transcriptPersistence: providerExecution?.transcriptPersistence === true,
    persistence: providerExecution?.persistence ?? DEFAULT_PROVIDER_EXECUTION_FRAGMENT.persistence,
    rawResponseAvailable: providerExecution?.rawResponseAvailable === true,
    rawResponseSummary: providerExecution?.rawResponseSummary ?? null,
    rawResponseHandle: providerExecution?.rawResponseHandle ?? null,
    transcriptHandle: providerExecution?.transcriptHandle ?? null,
    transcriptProviderManaged: providerExecution?.transcriptProviderManaged === true,
    implementationState: providerExecution?.implementationState ?? null,
    reservedStatusSet: Array.isArray(providerExecution?.reservedStatusSet)
      ? [...providerExecution.reservedStatusSet]
      : [...DEFAULT_PROVIDER_EXECUTION_FRAGMENT.reservedStatusSet],
    futureRequiredFields: Array.isArray(providerExecution?.futureRequiredFields)
      ? [...providerExecution.futureRequiredFields]
      : [...DEFAULT_PROVIDER_EXECUTION_FRAGMENT.futureRequiredFields],
    pendingCapabilities: Array.isArray(providerExecution?.pendingCapabilities)
      ? [...providerExecution.pendingCapabilities]
      : [],
    note: providerExecution?.note ?? DEFAULT_PROVIDER_EXECUTION_FRAGMENT.note,
  };
}

function normalizeTranscriptAvailability(transcriptAvailability) {
  if (!transcriptAvailability || typeof transcriptAvailability !== "object" || Array.isArray(transcriptAvailability)) {
    return { ...DEFAULT_TRANSCRIPT_AVAILABILITY_SKELETON };
  }

  return {
    ...transcriptAvailability,
    available: transcriptAvailability?.available === true,
    providerManaged: transcriptAvailability?.providerManaged === true,
    handle: transcriptAvailability?.handle ?? null,
    location:
      transcriptAvailability?.location &&
      typeof transcriptAvailability.location === "object" &&
      !Array.isArray(transcriptAvailability.location)
        ? { ...transcriptAvailability.location }
        : null,
    providerBacked: transcriptAvailability?.providerBacked === true,
    transcriptCaptured: transcriptAvailability?.transcriptCaptured === true,
    transcriptPersistence: transcriptAvailability?.transcriptPersistence === true,
    persistence: transcriptAvailability?.persistence ?? DEFAULT_TRANSCRIPT_AVAILABILITY_SKELETON.persistence,
    note: transcriptAvailability?.note ?? DEFAULT_TRANSCRIPT_AVAILABILITY_SKELETON.note,
  };
}

function normalizeRuntimeCase(runtimeCase) {
  const status = normalizeCaseStatus(runtimeCase?.status);
  const transcriptAvailability = normalizeTranscriptAvailability(runtimeCase?.transcriptAvailability);

  return {
    id: runtimeCase?.id ?? null,
    type: runtimeCase?.type ?? null,
    status,
    expectedBehavior: runtimeCase?.expectedBehavior ?? null,
    observed: normalizeObserved(runtimeCase?.observed, status),
    providerExecution: normalizeProviderExecution(runtimeCase?.providerExecution),
    transcriptAvailability,
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
  const passedCases = 0;
  const failedCases = runtimeCases.filter((runtimeCase) => FAILING_CASE_STATUSES.has(runtimeCase.status)).length;
  const blockedCases = runtimeCases.filter((runtimeCase) => BLOCKED_CASE_STATUSES.has(runtimeCase.status)).length;
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
  const reportProviderExecution = normalizeProviderExecution(
    runtime?.providerExecution ?? normalizedCases[0]?.providerExecution,
  );
  const reportTranscriptAvailability = normalizeTranscriptAvailability(
    normalizedCases[0]?.transcriptAvailability ?? runtime?.transcriptAvailability,
  );

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
    status: normalizedCases.some((runtimeCase) => BLOCKED_CASE_STATUSES.has(runtimeCase.status)) ? "blocked" : "draft",
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
      statusTaxonomy: {
        reportStatuses: ["draft", "blocked"],
        caseStatuses: [...ALLOWED_DRAFT_CASE_STATUSES],
        passedReserved: true,
        providerReadyPassPathImplemented: false,
      },
      providerExecution: reportProviderExecution,
      transcriptAvailability: reportTranscriptAvailability,
      providerBackedContract: {
        currentState: reportProviderExecution.implementationState,
        reservedFields: {
          runtimeCaseStatuses: [...reportProviderExecution.reservedStatusSet],
          providerEvidenceAvailable: reportProviderExecution.providerEvidenceAvailable,
          transcriptAvailable: reportProviderExecution.transcriptAvailable,
          transcriptPersistence: reportProviderExecution.persistence,
          rawResponseAvailable: reportProviderExecution.rawResponseAvailable,
          runtimePassedAvailable: false,
        },
        futureRequiredOutputs: [...reportProviderExecution.futureRequiredFields],
      },
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

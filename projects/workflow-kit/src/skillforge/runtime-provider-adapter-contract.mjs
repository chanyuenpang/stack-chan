const PROVIDER_ADAPTER_INPUT_VERSION = "runtime-provider-adapter-input-draft-1";
const PROVIDER_ADAPTER_OUTPUT_VERSION = "runtime-provider-adapter-output-draft-1";
const PROVIDER_ADAPTER_TRANSCRIPT_REF_KIND = "runtime-provider-adapter-transcript-ref";
const PROVIDER_ADAPTER_TRANSCRIPT_REF_VERSION = "runtime-provider-adapter-transcript-ref-draft-1";

const BUILTIN_PROVIDER_ADAPTER_KEYS = Object.freeze(["dry-run", "null-runner", "provider-backed"]);
const DEFAULT_PROVIDER_ADAPTER_SLOT = "future-provider-backed-single-case-runtime";

const DEFAULT_ALLOWED_PROVIDER_STATUSES = Object.freeze([
  "blocked",
  "error",
  "dry-run",
  "not-executed",
]);

const PROVIDER_FAILURE_TAXONOMY_VERSION = "runtime-provider-failure-taxonomy-draft-1";
const PROVIDER_FAILURE_STATUS_PRIORITY = Object.freeze([
  "blocked",
  "error",
  "dry-run",
  "not-executed",
]);
const PROVIDER_FAILURE_STATUS_ALLOWED_SET = Object.freeze([
  "blocked",
  "error",
  "dry-run",
  "not-executed",
  "adapter-error",
]);
const PROVIDER_FAILURE_STATUS_SEMANTICS = Object.freeze({
  blocked: Object.freeze({
    adapterResultStatus: "blocked",
    runnerStatus: "blocked",
    mapperStatus: "blocked",
    reportCaseStatus: "blocked",
    precedenceRank: 0,
    terminal: true,
    requiresPreflightBlocked: true,
    allowsProviderBackedSelection: true,
    allowsExecution: false,
    allowsProviderCall: false,
    allowsObservedEvidence: ["preflight-blocked"],
    meaning: "preflight or an earlier gate prevented runtime execution before any provider attempt could begin",
  }),
  error: Object.freeze({
    adapterResultStatus: "error",
    runnerStatus: "error",
    mapperStatus: "error",
    reportCaseStatus: "error",
    precedenceRank: 1,
    terminal: true,
    requiresPreflightBlocked: false,
    allowsProviderBackedSelection: true,
    allowsExecution: false,
    allowsProviderCall: false,
    allowsObservedEvidence: ["provider-slot-reserved", "not-executed"],
    meaning: "selected runtime path could not produce an executable provider-backed result because the reserved adapter path is intentionally unimplemented or internally failed before execution",
  }),
  "dry-run": Object.freeze({
    adapterResultStatus: "dry-run",
    runnerStatus: "dry-run",
    mapperStatus: "dry-run",
    reportCaseStatus: "dry-run",
    precedenceRank: 2,
    terminal: true,
    requiresPreflightBlocked: false,
    allowsProviderBackedSelection: false,
    allowsExecution: false,
    allowsProviderCall: false,
    allowsObservedEvidence: ["not-executed"],
    meaning: "the dry-run adapter path was deliberately selected, so runtime stayed non-executing by design rather than because of a blocking failure",
  }),
  "not-executed": Object.freeze({
    adapterResultStatus: "not-executed",
    runnerStatus: "not-executed",
    mapperStatus: "not-executed",
    reportCaseStatus: "not-executed",
    precedenceRank: 3,
    terminal: true,
    requiresPreflightBlocked: false,
    allowsProviderBackedSelection: false,
    allowsExecution: false,
    allowsProviderCall: false,
    allowsObservedEvidence: ["not-executed"],
    meaning: "a provider-less runner path intentionally skipped runtime execution without declaring a dry-run simulation",
  }),
  "adapter-error": Object.freeze({
    adapterResultStatus: "error",
    runnerStatus: "error",
    mapperStatus: "error",
    reportCaseStatus: "error",
    precedenceRank: 1,
    terminal: true,
    requiresPreflightBlocked: false,
    allowsProviderBackedSelection: true,
    allowsExecution: false,
    allowsProviderCall: false,
    allowsObservedEvidence: ["provider-slot-reserved", "not-executed"],
    meaning: "adapter-error is a contract-layer semantic alias used to describe adapter-originated failure, but it must serialize outward as error rather than as a new public status token",
  }),
});

const DEFAULT_PENDING_CAPABILITIES = Object.freeze([
  "provider-integration",
  "provider-selection",
  "provider-transcript-capture",
  "provider-transcript-persistence",
  "runtime-pass-path",
  "scoring-engine",
]);

const PROVIDER_SELECTION_VERSION = "runtime-provider-selection-draft-1";

const BUILTIN_PROVIDER_SELECTION_PRESETS = Object.freeze({
  "dry-run": Object.freeze({
    adapterKey: "dry-run",
    providerKey: "dry-run",
    providerSlot: DEFAULT_PROVIDER_ADAPTER_SLOT,
    builtin: true,
    implemented: true,
    providerBacked: false,
  }),
  "null-runner": Object.freeze({
    adapterKey: "null-runner",
    providerKey: "null-runner",
    providerSlot: DEFAULT_PROVIDER_ADAPTER_SLOT,
    builtin: true,
    implemented: true,
    providerBacked: false,
  }),
  "provider-backed": Object.freeze({
    adapterKey: "provider-backed",
    providerKey: "provider-backed",
    providerSlot: DEFAULT_PROVIDER_ADAPTER_SLOT,
    builtin: true,
    implemented: false,
    providerBacked: true,
  }),
});

const RESERVED_PROVIDER_BACKED_STATUS_SET = Object.freeze([
  "blocked",
  "error",
  "dry-run",
  "not-executed",
]);

const FUTURE_PROVIDER_BACKED_REQUIRED_FIELDS = Object.freeze([
  "selection.adapterKey",
  "selection.providerKey",
  "selection.providerSlot",
  "selection.providerBacked=true",
  "execution.executionId",
  "execution.providerRunId",
  "execution.providerStatus",
  "execution.executed=true",
  "execution.providerCall=true",
  "evidence.providerEvidenceAvailable",
  "evidence.transcriptAvailable",
  "evidence.transcriptCaptured",
  "evidence.transcriptPersistence",
  "rawResponse.available=true",
  "rawResponse.kind=runtime-provider-raw-response",
  "rawResponse.version",
  "rawResponse.summary",
  "transcriptRef.available=true",
  "transcriptRef.providerManaged=true",
  "transcriptRef.handle",
]);

const RAW_RESPONSE_KIND = "runtime-provider-raw-response";
const RAW_RESPONSE_VERSION = "runtime-provider-raw-response-draft-1";
const RAW_RESPONSE_CAPTURE_MODES = Object.freeze(["none", "summary-only"]);

function canExposeProviderBackedRawResponse({ selection, execution } = {}) {
  return (
    selection?.providerBacked === true &&
    execution?.executed === true &&
    execution?.providerCall === true
  );
}

function cloneArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function cloneObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : { ...fallback };
}

function normalizeCaseRecord(caseRecord = {}) {
  return {
    id: caseRecord?.id ?? null,
    type: caseRecord?.type ?? null,
    intent: caseRecord?.intent ?? null,
    expectedBehavior: caseRecord?.expectedBehavior ?? null,
    forbiddenBehavior: caseRecord?.forbiddenBehavior ?? null,
    input: caseRecord?.input ?? null,
    observed: caseRecord?.observed ?? null,
    passed: caseRecord?.passed ?? null,
    runtime: cloneObject(caseRecord?.runtime),
    preflight: cloneObject(caseRecord?.preflight),
    tags: cloneArray(caseRecord?.tags),
    privacyNotes: cloneArray(caseRecord?.privacyNotes),
  };
}

function normalizeBoundary(boundary = {}) {
  const permissions = cloneObject(boundary?.permissions, {
    allowed: [],
    denied: [],
    conservativeDefault: false,
    declarations: [],
  });
  permissions.allowed = cloneArray(permissions.allowed);
  permissions.denied = cloneArray(permissions.denied);
  permissions.declarations = cloneArray(permissions.declarations);
  permissions.conservativeDefault = permissions.conservativeDefault === true;

  const toolBoundary = cloneObject(boundary?.toolBoundary, {
    allowedActions: [],
    deniedActions: [],
    permissions,
    bodyMentionsConservativeBoundary: false,
  });
  toolBoundary.allowedActions = cloneArray(toolBoundary.allowedActions);
  toolBoundary.deniedActions = cloneArray(toolBoundary.deniedActions);
  toolBoundary.permissions = cloneObject(toolBoundary.permissions, permissions);
  toolBoundary.bodyMentionsConservativeBoundary = toolBoundary.bodyMentionsConservativeBoundary === true;

  return {
    permissions,
    toolBoundary,
  };
}

function normalizeFixtureContext({ fixtureDir, loadedFixture, normalizedFixture }) {
  return {
    fixtureDir: fixtureDir ?? null,
    fixtureId:
      normalizedFixture?.fixtureId ??
      normalizedFixture?.id ??
      loadedFixture?.skillManifest?.id ??
      loadedFixture?.manifest?.id ??
      null,
    fixtureVersion:
      normalizedFixture?.fixtureVersion ??
      normalizedFixture?.version ??
      loadedFixture?.skillManifest?.version ??
      loadedFixture?.manifest?.version ??
      null,
    profile: normalizedFixture?.profile ?? loadedFixture?.skillManifest?.profile ?? null,
    entryPath: normalizedFixture?.entryPath ?? loadedFixture?.skillManifest?.entry ?? null,
    normalizedFixture,
  };
}

export function buildRuntimeProviderAdapterInput({
  fixtureDir = null,
  loadedFixture = null,
  normalizedFixture = null,
  fixtureContext = null,
  caseRecord = null,
  boundary = {},
  options = {},
} = {}) {
  const selection = resolveRuntimeProviderSelection(options.providerSelection);
  const providerKey = options.providerKey ?? selection.providerKey ?? options.mode ?? null;
  const providerSlot = options.providerSlot ?? selection.providerSlot ?? DEFAULT_PROVIDER_ADAPTER_SLOT;

  const normalizedFixtureContext = fixtureContext
    ? {
        ...cloneObject(fixtureContext),
        normalizedFixture: fixtureContext?.normalizedFixture ?? normalizedFixture ?? null,
      }
    : normalizeFixtureContext({ fixtureDir, loadedFixture, normalizedFixture });

  return {
    contract: {
      kind: "runtime-provider-adapter-input",
      version: options.contractVersion ?? PROVIDER_ADAPTER_INPUT_VERSION,
    },
    caseRecord: normalizeCaseRecord(caseRecord),
    boundary: normalizeBoundary(boundary),
    fixture: normalizedFixtureContext,
    options: cloneObject(options),
    provider: {
      mode: options.mode ?? selection.adapterKey ?? null,
      providerKey,
      providerSlot,
      builtin: selection.builtin === true,
      contractFirst: true,
      implemented: selection.implemented === true,
      providerBacked: selection.providerBacked === true,
      selection,
      note:
        "single-case provider adapter seam only; this contract reserves future provider-backed runtime execution without implying provider integration is implemented",
    },
  };
}

export function buildRuntimeProviderTranscriptRef({
  handle = null,
  kind = PROVIDER_ADAPTER_TRANSCRIPT_REF_KIND,
  version = PROVIDER_ADAPTER_TRANSCRIPT_REF_VERSION,
  available = false,
  location = null,
  providerManaged = false,
  note = null,
} = {}) {
  return {
    kind,
    version,
    handle,
    available: available === true,
    location: location && typeof location === "object" && !Array.isArray(location) ? { ...location } : null,
    providerManaged: providerManaged === true,
    note:
      note ??
      "provider adapter transcript handle placeholder only; transcript capture/persistence is intentionally unimplemented in this phase",
  };
}

function resolveRuntimeProviderSelection(selection = {}) {
  if (selection == null || typeof selection !== "object" || Array.isArray(selection)) {
    return buildRuntimeProviderSelection();
  }

  return buildRuntimeProviderSelection({
    mode: selection.mode ?? selection.providerKey ?? selection.adapterKey ?? null,
    providerSlot: selection.providerSlot ?? DEFAULT_PROVIDER_ADAPTER_SLOT,
  });
}

function normalizeProviderFailureSemanticStatus(status = "not-executed") {
  const normalizedStatus = String(status ?? "not-executed");
  if (!PROVIDER_FAILURE_STATUS_ALLOWED_SET.includes(normalizedStatus)) {
    throw new RangeError(`Unsupported runtime provider failure taxonomy status: ${normalizedStatus}`);
  }
  return normalizedStatus;
}

function resolveProviderAdapterPublicStatus(status = "not-executed") {
  const semanticStatus = normalizeProviderFailureSemanticStatus(status);
  return PROVIDER_FAILURE_STATUS_SEMANTICS[semanticStatus]?.adapterResultStatus ?? "not-executed";
}

function assertProviderAdapterFailureTaxonomy({
  semanticStatus = "not-executed",
  publicStatus = "not-executed",
  selection = {},
  execution = {},
  evidence = {},
} = {}) {
  const semantics = PROVIDER_FAILURE_STATUS_SEMANTICS[semanticStatus];
  const providerBacked = selection?.providerBacked === true;
  const preflightBlocked =
    evidence?.preflightBlocked === true ||
    execution?.preflightBlocked === true ||
    execution?.blockingStage === "preflight";
  const executed = execution?.executed === true;
  const providerCall = execution?.providerCall === true;

  if (!semantics) {
    throw new RangeError(`Missing runtime provider failure taxonomy semantics for status: ${semanticStatus}`);
  }

  if (publicStatus !== semantics.adapterResultStatus) {
    throw new RangeError(
      `Runtime provider adapter status ${semanticStatus} must serialize as ${semantics.adapterResultStatus}, got: ${publicStatus}`,
    );
  }

  if (semanticStatus === "blocked" && preflightBlocked !== true) {
    throw new RangeError("Runtime provider adapter blocked status requires preflight-blocked evidence");
  }

  if (semanticStatus !== "blocked" && preflightBlocked === true) {
    throw new RangeError(
      `Runtime provider adapter status ${semanticStatus} cannot carry preflight-blocked evidence; use blocked instead`,
    );
  }

  if (providerBacked && semanticStatus !== "blocked" && semanticStatus !== "error") {
    throw new RangeError(
      `Runtime provider adapter provider-backed reserved seam only allows blocked/error, got: ${semanticStatus}`,
    );
  }

  if (providerBacked && semantics.allowsProviderBackedSelection !== true) {
    throw new RangeError(
      `Runtime provider adapter status ${semanticStatus} is not allowed for provider-backed selection`,
    );
  }

  if (providerBacked && executed === true) {
    throw new RangeError(
      "Runtime provider adapter provider-backed reserved seam forbids executed=true until provider integration is implemented",
    );
  }

  if (providerBacked && providerCall === true) {
    throw new RangeError(
      "Runtime provider adapter provider-backed reserved seam forbids providerCall=true until provider integration is implemented",
    );
  }

  if (executed && semantics.allowsExecution !== true) {
    throw new RangeError(
      `Runtime provider adapter status ${semanticStatus} forbids executed=true in the current reserved seam`,
    );
  }

  if (providerCall && semantics.allowsProviderCall !== true) {
    throw new RangeError(
      `Runtime provider adapter status ${semanticStatus} forbids providerCall=true in the current reserved seam`,
    );
  }
}

export function buildRuntimeProviderAdapterResult({
  caseId = null,
  status = "not-executed",
  observed = null,
  failureReason = null,
  providerMetadata = {},
  selection = {},
  execution = {},
  evidence = {},
  rawResponse = {},
  transcriptRef = null,
  note = null,
  pendingCapabilities = DEFAULT_PENDING_CAPABILITIES,
  allowedStatuses = DEFAULT_ALLOWED_PROVIDER_STATUSES,
} = {}) {
  const semanticStatus = normalizeProviderFailureSemanticStatus(status);
  const normalizedStatus = resolveProviderAdapterPublicStatus(semanticStatus);
  if (!allowedStatuses.includes(normalizedStatus)) {
    throw new RangeError(`Unsupported runtime provider adapter result status: ${normalizedStatus}`);
  }

  const normalizedSelection = resolveRuntimeProviderSelection(selection);

  const normalizedExecution = {
    executionId: null,
    providerRunId: null,
    providerStatus: null,
    executed: false,
    providerCall: false,
    ...cloneObject(execution),
  };

  const normalizedEvidence = {
    providerEvidenceAvailable: false,
    transcriptAvailable: false,
    transcriptCaptured: false,
    transcriptPersistence: false,
    persistence: "none",
    preflightBlocked: false,
    ...cloneObject(evidence),
  };

  normalizedExecution.executed = normalizedExecution.executed === true;
  normalizedExecution.providerCall = normalizedExecution.providerCall === true;
  normalizedEvidence.providerEvidenceAvailable = normalizedEvidence.providerEvidenceAvailable === true;
  normalizedEvidence.transcriptAvailable = normalizedEvidence.transcriptAvailable === true;
  normalizedEvidence.transcriptCaptured = normalizedEvidence.transcriptCaptured === true;
  normalizedEvidence.transcriptPersistence = normalizedEvidence.transcriptPersistence === true;
  normalizedEvidence.preflightBlocked = normalizedEvidence.preflightBlocked === true;

  const normalizedRawResponse = {
    kind: RAW_RESPONSE_KIND,
    version: RAW_RESPONSE_VERSION,
    available: false,
    captureMode: "none",
    summary: null,
    handle: null,
    note:
      "reserved provider-backed raw response evidence slot only; no provider payload capture, transcript capture, or persistence is implemented in this phase",
    ...cloneObject(rawResponse),
  };

  const normalizedMetadata = {
    implementationState: normalizedSelection.implemented === true ? "implemented" : "contract-first-unimplemented",
    executed: false,
    providerCall: false,
    providerEvidenceAvailable: false,
    transcriptAvailable: false,
    transcriptCaptured: false,
    transcriptPersistence: false,
    persistence: "none",
    executionId: null,
    providerRunId: null,
    providerStatus: null,
    semanticStatus,
    statusPriority: PROVIDER_FAILURE_STATUS_SEMANTICS[semanticStatus]?.precedenceRank ?? null,
    failureTaxonomyVersion: PROVIDER_FAILURE_TAXONOMY_VERSION,
    failureTaxonomyAllowedSet: [...PROVIDER_FAILURE_STATUS_ALLOWED_SET],
    failureTaxonomyPriority: [...PROVIDER_FAILURE_STATUS_PRIORITY],
    failureTaxonomySemantics: PROVIDER_FAILURE_STATUS_SEMANTICS,
    futureRequiredFields: [...FUTURE_PROVIDER_BACKED_REQUIRED_FIELDS],
    reservedStatusSet: [...RESERVED_PROVIDER_BACKED_STATUS_SET],
    note:
      note ??
      "provider adapter seam result only; no real provider call, no transcript persistence, no runtime pass evidence",
    pendingCapabilities: Array.isArray(pendingCapabilities)
      ? [...pendingCapabilities]
      : [...DEFAULT_PENDING_CAPABILITIES],
    ...cloneObject(providerMetadata),
  };

  if (normalizedSelection.providerBacked === true) {
    normalizedExecution.executionId = null;
    normalizedExecution.providerRunId = null;
    normalizedExecution.providerStatus = null;
    normalizedExecution.executed = false;
    normalizedExecution.providerCall = false;
    normalizedEvidence.providerEvidenceAvailable = false;
    normalizedEvidence.transcriptAvailable = false;
    normalizedEvidence.transcriptCaptured = false;
    normalizedEvidence.transcriptPersistence = false;
    normalizedEvidence.persistence = "none";
  } else if (normalizedExecution.executed !== true) {
    normalizedExecution.executionId = null;
    normalizedExecution.providerRunId = null;
    normalizedExecution.providerStatus = null;
    normalizedExecution.executed = false;
    normalizedExecution.providerCall = false;
  }

  if (normalizedSelection.providerBacked !== true || normalizedEvidence.providerEvidenceAvailable !== true) {
    normalizedEvidence.providerEvidenceAvailable = false;
    normalizedEvidence.transcriptAvailable = false;
    normalizedEvidence.transcriptCaptured = false;
    normalizedEvidence.transcriptPersistence = false;
    normalizedEvidence.persistence = normalizedEvidence.persistence ?? "none";
  }

  assertProviderAdapterFailureTaxonomy({
    semanticStatus,
    publicStatus: normalizedStatus,
    selection: normalizedSelection,
    execution: normalizedExecution,
    evidence: normalizedEvidence,
  });

  const rawResponseExposureAllowed = canExposeProviderBackedRawResponse({
    selection: normalizedSelection,
    execution: normalizedExecution,
  });

  normalizedRawResponse.available = normalizedRawResponse.available === true;
  normalizedRawResponse.captureMode = RAW_RESPONSE_CAPTURE_MODES.includes(normalizedRawResponse.captureMode)
    ? normalizedRawResponse.captureMode
    : "none";
  normalizedRawResponse.kind = RAW_RESPONSE_KIND;
  normalizedRawResponse.version = normalizedRawResponse.version ?? RAW_RESPONSE_VERSION;
  normalizedRawResponse.summary = normalizedRawResponse.summary ?? null;
  normalizedRawResponse.handle = normalizedRawResponse.handle ?? null;
  normalizedRawResponse.note = normalizedRawResponse.note ?? null;

  if (rawResponseExposureAllowed !== true || normalizedRawResponse.available !== true) {
    normalizedRawResponse.available = false;
    normalizedRawResponse.captureMode = "none";
    normalizedRawResponse.summary = null;
    normalizedRawResponse.handle = null;
  }

  normalizedMetadata.providerBacked = normalizedSelection.providerBacked;
  normalizedMetadata.providerKey = normalizedSelection.providerKey;
  normalizedMetadata.providerSlot = normalizedSelection.providerSlot;
  normalizedMetadata.adapterKey = normalizedSelection.adapterKey;
  normalizedMetadata.builtin = normalizedSelection.builtin;
  normalizedMetadata.implemented = normalizedSelection.implemented;
  normalizedMetadata.executed = normalizedExecution.executed === true;
  normalizedMetadata.providerCall = normalizedExecution.providerCall === true;
  normalizedMetadata.providerEvidenceAvailable = normalizedEvidence.providerEvidenceAvailable === true;
  normalizedMetadata.transcriptAvailable = normalizedEvidence.transcriptAvailable === true;
  normalizedMetadata.transcriptCaptured = normalizedEvidence.transcriptCaptured === true;
  normalizedMetadata.transcriptPersistence = normalizedEvidence.transcriptPersistence === true;
  normalizedMetadata.persistence = normalizedEvidence.persistence ?? normalizedMetadata.persistence ?? "none";
  normalizedMetadata.executionId = normalizedExecution.executionId ?? null;
  normalizedMetadata.providerRunId = normalizedExecution.providerRunId ?? null;
  normalizedMetadata.providerStatus = normalizedExecution.providerStatus ?? null;

  if (normalizedMetadata.providerBacked === true) {
    normalizedMetadata.executed = false;
    normalizedMetadata.providerCall = false;
    normalizedMetadata.providerEvidenceAvailable = false;
    normalizedMetadata.transcriptAvailable = false;
    normalizedMetadata.transcriptCaptured = false;
    normalizedMetadata.transcriptPersistence = false;
    normalizedMetadata.persistence = "none";
    normalizedMetadata.executionId = null;
    normalizedMetadata.providerRunId = null;
    normalizedMetadata.providerStatus = null;
  } else {
    normalizedMetadata.executed = false;
    normalizedMetadata.providerCall = false;
    normalizedMetadata.providerEvidenceAvailable = false;
    normalizedMetadata.transcriptAvailable = false;
    normalizedMetadata.transcriptCaptured = false;
    normalizedMetadata.transcriptPersistence = false;
    normalizedMetadata.persistence = normalizedMetadata.persistence ?? "none";
    normalizedMetadata.executionId = null;
    normalizedMetadata.providerRunId = null;
    normalizedMetadata.providerStatus = null;
  }

  if (normalizedMetadata.executed !== true || normalizedMetadata.providerCall !== true) {
    normalizedRawResponse.available = false;
    normalizedRawResponse.captureMode = "none";
    normalizedRawResponse.summary = null;
    normalizedRawResponse.handle = null;
  }

  const normalizedTranscriptRef =
    transcriptRef && typeof transcriptRef === "object" && !Array.isArray(transcriptRef)
      ? {
          ...transcriptRef,
          available: transcriptRef?.available === true,
          providerManaged: transcriptRef?.providerManaged === true,
        }
      : null;

  if (normalizedMetadata.providerBacked !== true && normalizedTranscriptRef) {
    normalizedTranscriptRef.available = false;
    normalizedTranscriptRef.providerManaged = false;
    normalizedTranscriptRef.handle = null;
    normalizedTranscriptRef.location = null;
  }

  if (normalizedTranscriptRef && rawResponseExposureAllowed !== true) {
    normalizedTranscriptRef.available = false;
    normalizedTranscriptRef.providerManaged = false;
    normalizedTranscriptRef.handle = null;
    normalizedTranscriptRef.location = null;
  }

  if (normalizedTranscriptRef && normalizedEvidence.transcriptAvailable !== true) {
    normalizedTranscriptRef.available = false;
    normalizedTranscriptRef.providerManaged = false;
    normalizedTranscriptRef.handle = null;
    normalizedTranscriptRef.location = null;
  }

  return {
    contract: {
      kind: "runtime-provider-adapter-output",
      version: providerMetadata?.contractVersion ?? PROVIDER_ADAPTER_OUTPUT_VERSION,
    },
    caseId,
    status: normalizedStatus,
    observed,
    failureReason:
      failureReason && typeof failureReason === "object" && !Array.isArray(failureReason)
        ? {
            ...failureReason,
            blockingCheckIds: cloneArray(failureReason?.blockingCheckIds),
          }
        : null,
    selection: normalizedSelection,
    execution: normalizedExecution,
    evidence: normalizedEvidence,
    rawResponse: normalizedRawResponse,
    transcriptRef: normalizedTranscriptRef,
    providerMetadata: normalizedMetadata,
  };
}

export function buildRuntimeProviderSelection({
  mode = null,
  providerKey = null,
  providerSlot = DEFAULT_PROVIDER_ADAPTER_SLOT,
} = {}) {
  const adapterKey = providerKey ?? mode ?? "dry-run";
  const preset = BUILTIN_PROVIDER_SELECTION_PRESETS[adapterKey];
  if (!preset) {
    throw new RangeError(`Unsupported runtime provider adapter key: ${adapterKey}`);
  }

  return {
    kind: "runtime-provider-selection",
    version: PROVIDER_SELECTION_VERSION,
    ...preset,
    providerSlot,
  };
}

export function buildRuntimeProviderAdapterContractContext({
  fixtureDir = null,
  loadedFixture = null,
  normalizedFixture = null,
  fixtureContext = null,
  caseRecord = null,
  boundary = {},
  options = {},
} = {}) {
  const input = buildRuntimeProviderAdapterInput({
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    fixtureContext,
    caseRecord,
    boundary,
    options,
  });

  return {
    input,
    buildResult(result = {}) {
      return buildRuntimeProviderAdapterResult({
        caseId: result.caseId ?? input.caseRecord.id,
        ...result,
      });
    },
  };
}

export const RUNTIME_PROVIDER_ADAPTER_INPUT_VERSION = PROVIDER_ADAPTER_INPUT_VERSION;
export const RUNTIME_PROVIDER_ADAPTER_OUTPUT_VERSION = PROVIDER_ADAPTER_OUTPUT_VERSION;
export const RUNTIME_PROVIDER_ADAPTER_ALLOWED_STATUSES = [...DEFAULT_ALLOWED_PROVIDER_STATUSES];
export const RUNTIME_PROVIDER_FAILURE_TAXONOMY_VERSION = PROVIDER_FAILURE_TAXONOMY_VERSION;
export const RUNTIME_PROVIDER_FAILURE_STATUS_PRIORITY = [...PROVIDER_FAILURE_STATUS_PRIORITY];
export const RUNTIME_PROVIDER_FAILURE_STATUS_ALLOWED_SET = [...PROVIDER_FAILURE_STATUS_ALLOWED_SET];
export const RUNTIME_PROVIDER_FAILURE_STATUS_SEMANTICS = PROVIDER_FAILURE_STATUS_SEMANTICS;
export const RUNTIME_PROVIDER_ADAPTER_TRANSCRIPT_REF_KIND = PROVIDER_ADAPTER_TRANSCRIPT_REF_KIND;
export const RUNTIME_PROVIDER_ADAPTER_TRANSCRIPT_REF_VERSION = PROVIDER_ADAPTER_TRANSCRIPT_REF_VERSION;
export const RUNTIME_PROVIDER_RAW_RESPONSE_KIND = RAW_RESPONSE_KIND;
export const RUNTIME_PROVIDER_RAW_RESPONSE_VERSION = RAW_RESPONSE_VERSION;
export const RUNTIME_PROVIDER_RAW_RESPONSE_CAPTURE_MODES = [...RAW_RESPONSE_CAPTURE_MODES];
export const RUNTIME_PROVIDER_ADAPTER_KEYS = [...BUILTIN_PROVIDER_ADAPTER_KEYS];
export const RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT = DEFAULT_PROVIDER_ADAPTER_SLOT;
export const RUNTIME_PROVIDER_ADAPTER_RESERVED_STATUS_SET = [...RESERVED_PROVIDER_BACKED_STATUS_SET];
export const RUNTIME_PROVIDER_ADAPTER_FUTURE_REQUIRED_FIELDS = [...FUTURE_PROVIDER_BACKED_REQUIRED_FIELDS];
export const RUNTIME_PROVIDER_SELECTION_VERSION = PROVIDER_SELECTION_VERSION;
export const RUNTIME_PROVIDER_SELECTION_PRESETS = Object.freeze(
  Object.fromEntries(
    Object.entries(BUILTIN_PROVIDER_SELECTION_PRESETS).map(([key, value]) => [key, { ...value }]),
  ),
);

export default {
  buildRuntimeProviderAdapterInput,
  buildRuntimeProviderAdapterResult,
  buildRuntimeProviderAdapterContractContext,
  buildRuntimeProviderSelection,
  buildRuntimeProviderTranscriptRef,
  RUNTIME_PROVIDER_ADAPTER_INPUT_VERSION: PROVIDER_ADAPTER_INPUT_VERSION,
  RUNTIME_PROVIDER_ADAPTER_OUTPUT_VERSION: PROVIDER_ADAPTER_OUTPUT_VERSION,
  RUNTIME_PROVIDER_ADAPTER_ALLOWED_STATUSES: [...DEFAULT_ALLOWED_PROVIDER_STATUSES],
  RUNTIME_PROVIDER_FAILURE_TAXONOMY_VERSION: PROVIDER_FAILURE_TAXONOMY_VERSION,
  RUNTIME_PROVIDER_FAILURE_STATUS_PRIORITY: [...PROVIDER_FAILURE_STATUS_PRIORITY],
  RUNTIME_PROVIDER_FAILURE_STATUS_ALLOWED_SET: [...PROVIDER_FAILURE_STATUS_ALLOWED_SET],
  RUNTIME_PROVIDER_FAILURE_STATUS_SEMANTICS: PROVIDER_FAILURE_STATUS_SEMANTICS,
  RUNTIME_PROVIDER_ADAPTER_TRANSCRIPT_REF_KIND: PROVIDER_ADAPTER_TRANSCRIPT_REF_KIND,
  RUNTIME_PROVIDER_ADAPTER_TRANSCRIPT_REF_VERSION: PROVIDER_ADAPTER_TRANSCRIPT_REF_VERSION,
  RUNTIME_PROVIDER_RAW_RESPONSE_KIND: RAW_RESPONSE_KIND,
  RUNTIME_PROVIDER_RAW_RESPONSE_VERSION: RAW_RESPONSE_VERSION,
  RUNTIME_PROVIDER_RAW_RESPONSE_CAPTURE_MODES: [...RAW_RESPONSE_CAPTURE_MODES],
  RUNTIME_PROVIDER_ADAPTER_KEYS: [...BUILTIN_PROVIDER_ADAPTER_KEYS],
  RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT: DEFAULT_PROVIDER_ADAPTER_SLOT,
  RUNTIME_PROVIDER_ADAPTER_RESERVED_STATUS_SET: [...RESERVED_PROVIDER_BACKED_STATUS_SET],
  RUNTIME_PROVIDER_ADAPTER_FUTURE_REQUIRED_FIELDS: [...FUTURE_PROVIDER_BACKED_REQUIRED_FIELDS],
  RUNTIME_PROVIDER_SELECTION_VERSION: PROVIDER_SELECTION_VERSION,
  RUNTIME_PROVIDER_SELECTION_PRESETS: Object.freeze(
    Object.fromEntries(
      Object.entries(BUILTIN_PROVIDER_SELECTION_PRESETS).map(([key, value]) => [key, { ...value }]),
    ),
  ),
};

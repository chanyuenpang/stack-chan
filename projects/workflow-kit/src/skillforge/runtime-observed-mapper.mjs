const OBSERVED_MAPPER_VERSION = "runtime-observed-mapper-draft-1";
const OBSERVED_KIND = "runtime-observed-stub";
const SUPPORTED_OBSERVED_STATUSES = Object.freeze([
  "blocked",
  "error",
  "dry-run",
  "not-executed",
]);
const SUPPORTED_PROVIDER_SELECTION_KEYS = Object.freeze(["dry-run", "null-runner", "provider-backed"]);

function cloneArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function cloneObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : { ...fallback };
}

function normalizeCaseContext(caseContext = {}) {
  return {
    id: caseContext?.id ?? null,
    type: caseContext?.type ?? null,
    intent: caseContext?.intent ?? null,
    expectedBehavior: caseContext?.expectedBehavior ?? null,
    forbiddenBehavior: caseContext?.forbiddenBehavior ?? null,
    input: caseContext?.input ?? null,
    runtime: cloneObject(caseContext?.runtime),
    preflight: cloneObject(caseContext?.preflight),
    tags: cloneArray(caseContext?.tags),
    privacyNotes: cloneArray(caseContext?.privacyNotes),
  };
}

function normalizeProviderSelection(providerSelection = {}) {
  const adapterKey = providerSelection?.adapterKey ?? providerSelection?.providerKey ?? "dry-run";
  if (!SUPPORTED_PROVIDER_SELECTION_KEYS.includes(adapterKey)) {
    throw new RangeError(`Unsupported runtime observed mapper provider selection: ${adapterKey}`);
  }

  return {
    kind: providerSelection?.kind ?? "runtime-provider-selection",
    version: providerSelection?.version ?? null,
    adapterKey,
    providerKey: providerSelection?.providerKey ?? adapterKey,
    providerSlot: providerSelection?.providerSlot ?? null,
    providerBacked:
      providerSelection?.providerBacked === true || adapterKey === "provider-backed",
    implemented:
      providerSelection?.implemented === true || adapterKey !== "provider-backed",
    builtin: providerSelection?.builtin === true,
  };
}

function normalizeAdapterResult(adapterResult = {}) {
  const status = String(adapterResult?.status ?? "not-executed");
  if (!SUPPORTED_OBSERVED_STATUSES.includes(status)) {
    throw new RangeError(`Unsupported runtime observed mapper adapter status: ${status}`);
  }

  return {
    caseId: adapterResult?.caseId ?? null,
    status,
    observed: cloneObject(adapterResult?.observed, null),
    selection: cloneObject(adapterResult?.selection),
    execution: cloneObject(adapterResult?.execution),
    evidence: cloneObject(adapterResult?.evidence),
    rawResponse: cloneObject(adapterResult?.rawResponse),
    transcriptRef:
      adapterResult?.transcriptRef && typeof adapterResult.transcriptRef === "object" && !Array.isArray(adapterResult.transcriptRef)
        ? { ...adapterResult.transcriptRef }
        : null,
    providerMetadata: cloneObject(adapterResult?.providerMetadata),
  };
}

function inferObservedEvidence({ status, providerSelection }) {
  if (status === "blocked") return "preflight-blocked";
  if (providerSelection.providerBacked) return "provider-slot-reserved";
  if (providerSelection.adapterKey === "null-runner") return "not-executed";
  return "not-executed";
}

function buildObserved({ adapterResult, providerSelection, caseContext }) {
  const evidence = adapterResult.evidence;
  const execution = adapterResult.execution;
  const providerBacked = adapterResult.selection?.providerBacked === true || providerSelection.providerBacked === true;

  if (adapterResult.observed && Object.keys(adapterResult.observed).length > 0) {
    return {
      kind: adapterResult.observed.kind ?? OBSERVED_KIND,
      mode: adapterResult.observed.mode ?? providerSelection.adapterKey,
      evidence:
        adapterResult.observed.evidence ?? inferObservedEvidence({ status: adapterResult.status, providerSelection }),
      providerCall: adapterResult.observed.providerCall === true || execution?.providerCall === true,
      transcriptCaptured:
        adapterResult.observed.transcriptCaptured === true || evidence?.transcriptCaptured === true,
      sideEffectsPerformed: adapterResult.observed.sideEffectsPerformed === true,
      providerEvidenceAvailable:
        adapterResult.observed.providerEvidenceAvailable === true || evidence?.providerEvidenceAvailable === true,
      persistedEvidenceAvailable:
        adapterResult.observed.persistedEvidenceAvailable === true || evidence?.transcriptPersistence === true,
      note:
        adapterResult.observed.note ??
        `runtime observed mapper normalized adapter result for case ${caseContext.id ?? adapterResult.caseId ?? "<unknown>"}`,
    };
  }

  return {
    kind: OBSERVED_KIND,
    mode: providerSelection.adapterKey,
    evidence: inferObservedEvidence({ status: adapterResult.status, providerSelection }),
    providerCall: execution?.providerCall === true,
    transcriptCaptured: evidence?.transcriptCaptured === true,
    sideEffectsPerformed: false,
    providerEvidenceAvailable: evidence?.providerEvidenceAvailable === true,
    persistedEvidenceAvailable: evidence?.transcriptPersistence === true,
    note:
      adapterResult.status === "blocked"
        ? `runtime observed mapper marked case ${caseContext.id ?? adapterResult.caseId ?? "<unknown>"} as preflight-blocked without provider execution`
        : providerBacked
          ? `runtime observed mapper reserved provider-backed slot without executing provider for case ${caseContext.id ?? adapterResult.caseId ?? "<unknown>"}`
          : `runtime observed mapper normalized provider-less execution stub for case ${caseContext.id ?? adapterResult.caseId ?? "<unknown>"}`,
  };
}

function buildProviderExecution({ adapterResult, providerSelection }) {
  const execution = adapterResult.execution;
  const evidence = adapterResult.evidence;
  const rawResponse = adapterResult.rawResponse;
  const transcriptRef = adapterResult.transcriptRef;
  const providerEvidenceAvailable =
    evidence?.providerEvidenceAvailable === true || adapterResult.providerMetadata?.providerEvidenceAvailable === true;
  const transcriptAvailable =
    evidence?.transcriptAvailable === true || adapterResult.providerMetadata?.transcriptAvailable === true;
  const rawResponseAvailable =
    providerSelection.providerBacked === true &&
    execution?.executed === true &&
    execution?.providerCall === true &&
    providerEvidenceAvailable === true &&
    transcriptAvailable === true &&
    rawResponse?.available === true;

  return {
    selection: { ...providerSelection },
    adapterKey: providerSelection.adapterKey,
    providerKey: providerSelection.providerKey,
    providerSlot: providerSelection.providerSlot,
    builtin: providerSelection.builtin === true,
    implemented: providerSelection.implemented === true,
    providerBacked: providerSelection.providerBacked === true,
    status: adapterResult.status,
    executionId: execution?.executionId ?? adapterResult.providerMetadata?.executionId ?? null,
    providerRunId: execution?.providerRunId ?? adapterResult.providerMetadata?.providerRunId ?? null,
    providerStatus: execution?.providerStatus ?? adapterResult.providerMetadata?.providerStatus ?? null,
    executed: execution?.executed === true || adapterResult.providerMetadata?.executed === true,
    providerCall: execution?.providerCall === true || adapterResult.providerMetadata?.providerCall === true,
    providerEvidenceAvailable,
    transcriptAvailable,
    transcriptCaptured:
      evidence?.transcriptCaptured === true || adapterResult.providerMetadata?.transcriptCaptured === true,
    transcriptPersistence:
      evidence?.transcriptPersistence ?? adapterResult.providerMetadata?.transcriptPersistence ?? false,
    persistence: evidence?.persistence ?? adapterResult.providerMetadata?.persistence ?? "none",
    rawResponseAvailable,
    rawResponseSummary: rawResponseAvailable ? rawResponse?.summary ?? null : null,
    rawResponseHandle: rawResponseAvailable ? rawResponse?.handle ?? null : null,
    transcriptHandle: transcriptAvailable ? transcriptRef?.handle ?? null : null,
    transcriptProviderManaged: transcriptAvailable && transcriptRef?.providerManaged === true,
    implementationState: adapterResult.providerMetadata?.implementationState ?? null,
    reservedStatusSet: cloneArray(adapterResult.providerMetadata?.reservedStatusSet),
    futureRequiredFields: cloneArray(adapterResult.providerMetadata?.futureRequiredFields),
    pendingCapabilities: cloneArray(adapterResult.providerMetadata?.pendingCapabilities),
    note: adapterResult.providerMetadata?.note ?? null,
  };
}

function buildTranscriptAvailability({ adapterResult, providerSelection }) {
  const transcriptRef = adapterResult.transcriptRef;
  const evidence = adapterResult.evidence;
  const transcriptAvailable =
    providerSelection.providerBacked === true &&
    (transcriptRef?.available === true || evidence?.transcriptAvailable === true) &&
    (evidence?.transcriptAvailable === true || adapterResult.providerMetadata?.transcriptAvailable === true);

  return {
    available: transcriptAvailable,
    providerManaged: transcriptAvailable && transcriptRef?.providerManaged === true,
    handle: transcriptAvailable ? transcriptRef?.handle ?? null : null,
    location:
      transcriptAvailable &&
      transcriptRef?.location && typeof transcriptRef.location === "object" && !Array.isArray(transcriptRef.location)
        ? { ...transcriptRef.location }
        : null,
    providerBacked: adapterResult.selection?.providerBacked === true || providerSelection.providerBacked,
    transcriptCaptured: evidence?.transcriptCaptured === true || adapterResult.providerMetadata?.transcriptCaptured === true,
    transcriptPersistence: evidence?.transcriptPersistence ?? adapterResult.providerMetadata?.transcriptPersistence ?? false,
    persistence: evidence?.persistence ?? adapterResult.providerMetadata?.persistence ?? "none",
    note:
      transcriptRef?.note ??
      "runtime observed mapper transcript availability skeleton only; handle semantics are same-source only and do not imply raw-response/provider-handle reuse in this phase",
  };
}

export function mapProviderResultToObservedRuntime({
  adapterResult = {},
  providerSelection = {},
  caseContext = {},
} = {}) {
  const normalizedAdapterResult = normalizeAdapterResult(adapterResult);
  const normalizedProviderSelection = normalizeProviderSelection(providerSelection);
  const normalizedCaseContext = normalizeCaseContext(caseContext);

  return {
    contract: {
      kind: "runtime-observed-mapper-output",
      version: OBSERVED_MAPPER_VERSION,
    },
    caseId: normalizedCaseContext.id ?? normalizedAdapterResult.caseId,
    status: normalizedAdapterResult.status,
    observed: buildObserved({
      adapterResult: normalizedAdapterResult,
      providerSelection: normalizedProviderSelection,
      caseContext: normalizedCaseContext,
    }),
    providerExecution: buildProviderExecution({
      adapterResult: normalizedAdapterResult,
      providerSelection: normalizedProviderSelection,
    }),
    transcriptAvailability: buildTranscriptAvailability({
      adapterResult: normalizedAdapterResult,
      providerSelection: normalizedProviderSelection,
    }),
  };
}

export const RUNTIME_OBSERVED_MAPPER_VERSION = OBSERVED_MAPPER_VERSION;
export const RUNTIME_OBSERVED_MAPPER_ALLOWED_STATUSES = [...SUPPORTED_OBSERVED_STATUSES];
export const RUNTIME_OBSERVED_MAPPER_PROVIDER_SELECTION_KEYS = [...SUPPORTED_PROVIDER_SELECTION_KEYS];

export default {
  mapProviderResultToObservedRuntime,
  RUNTIME_OBSERVED_MAPPER_VERSION: OBSERVED_MAPPER_VERSION,
  RUNTIME_OBSERVED_MAPPER_ALLOWED_STATUSES: [...SUPPORTED_OBSERVED_STATUSES],
  RUNTIME_OBSERVED_MAPPER_PROVIDER_SELECTION_KEYS: [...SUPPORTED_PROVIDER_SELECTION_KEYS],
};

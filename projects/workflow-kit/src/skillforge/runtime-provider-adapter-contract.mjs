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

const DEFAULT_PENDING_CAPABILITIES = Object.freeze([
  "provider-integration",
  "provider-selection",
  "provider-transcript-capture",
  "provider-transcript-persistence",
  "runtime-pass-path",
  "scoring-engine",
]);

const PROVIDER_SELECTION_VERSION = "runtime-provider-selection-draft-1";

const RESERVED_PROVIDER_BACKED_STATUS_SET = Object.freeze([
  "blocked",
  "error",
  "dry-run",
  "not-executed",
]);

const FUTURE_PROVIDER_BACKED_REQUIRED_FIELDS = Object.freeze([
  "providerMetadata.providerKey",
  "providerMetadata.providerSlot",
  "providerMetadata.executionId",
  "providerMetadata.providerRunId",
  "providerMetadata.providerStatus",
  "providerMetadata.providerBacked=true",
  "providerMetadata.executed=true",
  "providerMetadata.providerCall=true",
  "providerMetadata.providerEvidenceAvailable",
  "providerMetadata.transcriptCaptured",
  "providerMetadata.transcriptPersistence",
  "transcriptRef.available=true",
  "transcriptRef.providerManaged=true",
  "transcriptRef.handle",
]);

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
  const providerKey = options.providerKey ?? options.mode ?? null;
  const providerSlot = options.providerSlot ?? DEFAULT_PROVIDER_ADAPTER_SLOT;

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
      mode: options.mode ?? null,
      providerKey,
      providerSlot,
      builtin: BUILTIN_PROVIDER_ADAPTER_KEYS.includes(providerKey),
      contractFirst: true,
      implemented: false,
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

export function buildRuntimeProviderAdapterResult({
  caseId = null,
  status = "not-executed",
  observed = null,
  providerMetadata = {},
  transcriptRef = null,
  note = null,
  pendingCapabilities = DEFAULT_PENDING_CAPABILITIES,
  allowedStatuses = DEFAULT_ALLOWED_PROVIDER_STATUSES,
} = {}) {
  const normalizedStatus = String(status ?? "not-executed");
  if (!allowedStatuses.includes(normalizedStatus)) {
    throw new RangeError(`Unsupported runtime provider adapter result status: ${normalizedStatus}`);
  }

  const normalizedMetadata = {
    implementationState: "contract-first-unimplemented",
    providerBacked: false,
    providerKey: null,
    providerSlot: null,
    executed: false,
    providerCall: false,
    providerEvidenceAvailable: false,
    transcriptCaptured: false,
    transcriptPersistence: false,
    persistence: "none",
    executionId: null,
    providerRunId: null,
    providerStatus: null,
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

  if (normalizedMetadata.providerBacked !== true) {
    normalizedMetadata.executed = false;
    normalizedMetadata.providerCall = false;
    normalizedMetadata.providerEvidenceAvailable = false;
    normalizedMetadata.transcriptCaptured = false;
    normalizedMetadata.transcriptPersistence = false;
    normalizedMetadata.persistence = normalizedMetadata.persistence ?? "none";
    normalizedMetadata.executionId = null;
    normalizedMetadata.providerRunId = null;
    normalizedMetadata.providerStatus = null;
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

  return {
    contract: {
      kind: "runtime-provider-adapter-output",
      version: providerMetadata?.contractVersion ?? PROVIDER_ADAPTER_OUTPUT_VERSION,
    },
    caseId,
    status: normalizedStatus,
    observed,
    transcriptRef: normalizedTranscriptRef,
    providerMetadata: normalizedMetadata,
  };
}

export function buildRuntimeProviderSelection({
  mode = null,
  providerKey = null,
  providerSlot = DEFAULT_PROVIDER_ADAPTER_SLOT,
  builtin = null,
  implemented = null,
  providerBacked = null,
} = {}) {
  const adapterKey = providerKey ?? mode ?? null;
  if (!BUILTIN_PROVIDER_ADAPTER_KEYS.includes(adapterKey)) {
    throw new RangeError(`Unsupported runtime provider adapter key: ${adapterKey}`);
  }

  return {
    kind: "runtime-provider-selection",
    version: PROVIDER_SELECTION_VERSION,
    adapterKey,
    providerKey: adapterKey,
    providerSlot,
    builtin: builtin == null ? BUILTIN_PROVIDER_ADAPTER_KEYS.includes(adapterKey) : builtin === true,
    implemented: implemented == null ? adapterKey !== "provider-backed" : implemented === true,
    providerBacked: providerBacked == null ? adapterKey === "provider-backed" : providerBacked === true,
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
export const RUNTIME_PROVIDER_ADAPTER_TRANSCRIPT_REF_KIND = PROVIDER_ADAPTER_TRANSCRIPT_REF_KIND;
export const RUNTIME_PROVIDER_ADAPTER_TRANSCRIPT_REF_VERSION = PROVIDER_ADAPTER_TRANSCRIPT_REF_VERSION;
export const RUNTIME_PROVIDER_ADAPTER_KEYS = [...BUILTIN_PROVIDER_ADAPTER_KEYS];
export const RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT = DEFAULT_PROVIDER_ADAPTER_SLOT;
export const RUNTIME_PROVIDER_ADAPTER_RESERVED_STATUS_SET = [...RESERVED_PROVIDER_BACKED_STATUS_SET];
export const RUNTIME_PROVIDER_ADAPTER_FUTURE_REQUIRED_FIELDS = [...FUTURE_PROVIDER_BACKED_REQUIRED_FIELDS];
export const RUNTIME_PROVIDER_SELECTION_VERSION = PROVIDER_SELECTION_VERSION;

export default {
  buildRuntimeProviderAdapterInput,
  buildRuntimeProviderAdapterResult,
  buildRuntimeProviderAdapterContractContext,
  buildRuntimeProviderSelection,
  buildRuntimeProviderTranscriptRef,
  RUNTIME_PROVIDER_ADAPTER_INPUT_VERSION: PROVIDER_ADAPTER_INPUT_VERSION,
  RUNTIME_PROVIDER_ADAPTER_OUTPUT_VERSION: PROVIDER_ADAPTER_OUTPUT_VERSION,
  RUNTIME_PROVIDER_ADAPTER_ALLOWED_STATUSES: [...DEFAULT_ALLOWED_PROVIDER_STATUSES],
  RUNTIME_PROVIDER_ADAPTER_TRANSCRIPT_REF_KIND: PROVIDER_ADAPTER_TRANSCRIPT_REF_KIND,
  RUNTIME_PROVIDER_ADAPTER_TRANSCRIPT_REF_VERSION: PROVIDER_ADAPTER_TRANSCRIPT_REF_VERSION,
  RUNTIME_PROVIDER_ADAPTER_KEYS: [...BUILTIN_PROVIDER_ADAPTER_KEYS],
  RUNTIME_PROVIDER_ADAPTER_DEFAULT_SLOT: DEFAULT_PROVIDER_ADAPTER_SLOT,
  RUNTIME_PROVIDER_ADAPTER_RESERVED_STATUS_SET: [...RESERVED_PROVIDER_BACKED_STATUS_SET],
  RUNTIME_PROVIDER_ADAPTER_FUTURE_REQUIRED_FIELDS: [...FUTURE_PROVIDER_BACKED_REQUIRED_FIELDS],
  RUNTIME_PROVIDER_SELECTION_VERSION: PROVIDER_SELECTION_VERSION,
};

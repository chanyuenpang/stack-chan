const RUNNER_INPUT_VERSION = "runtime-runner-input-draft-1";
const RUNNER_OUTPUT_VERSION = "runtime-runner-output-draft-1";
const RUNTIME_TRANSCRIPT_REF_KIND = "runtime-transcript-artifact-ref";
const RUNTIME_TRANSCRIPT_REF_VERSION = "runtime-transcript-artifact-ref-draft-1";

const DEFAULT_ALLOWED_CASE_STATUSES = Object.freeze([
  "blocked",
  "error",
  "dry-run",
  "not-executed",
]);

const BLOCKING_FAILURE_REASON_CODES = Object.freeze([
  "RUNTIME_PREFLIGHT_BLOCKED",
]);

const DEFAULT_PROVIDER_ADAPTER_SEAM = Object.freeze({
  contractFirst: true,
  implemented: false,
  providerBacked: false,
  key: "dry-run",
  slot: "future-provider-backed-single-case-runtime",
  selection: null,
  reservedStatusSet: ["blocked", "error", "dry-run", "not-executed"],
  futureRequiredFields: [
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
  ],
  note: "provider adapter seam reserved only; this does not imply provider integration is implemented",
});

const DEFAULT_RUNNER_PENDING_CAPABILITIES = Object.freeze([
  "provider-integration",
  "transcript-engine",
  "sandbox-implementation",
  "scoring-engine",
]);

const PROVIDER_EXECUTION_FRAGMENT_VERSION = "runtime-provider-execution-fragment-draft-1";
const TRANSCRIPT_AVAILABILITY_SKELETON_VERSION = "runtime-transcript-availability-skeleton-draft-1";

function cloneArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function cloneObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : { ...fallback };
}

function normalizePermissions(permissions = {}) {
  const normalized = cloneObject(permissions, {
    allowed: [],
    denied: [],
    conservativeDefault: false,
    declarations: [],
  });

  normalized.allowed = cloneArray(normalized.allowed);
  normalized.denied = cloneArray(normalized.denied);
  normalized.declarations = cloneArray(normalized.declarations);
  normalized.conservativeDefault = normalized.conservativeDefault === true;

  return normalized;
}

function normalizeBoundary(boundary = {}) {
  const permissions = normalizePermissions(boundary?.permissions);

  const toolBoundary = cloneObject(boundary?.toolBoundary, {
    allowedActions: [],
    deniedActions: [],
    permissions: {
      allowed: [],
      denied: [],
      conservativeDefault: false,
      declarations: [],
    },
    bodyMentionsConservativeBoundary: false,
  });

  toolBoundary.allowedActions = cloneArray(toolBoundary.allowedActions);
  toolBoundary.deniedActions = cloneArray(toolBoundary.deniedActions);
  toolBoundary.permissions = normalizePermissions(toolBoundary.permissions);
  toolBoundary.bodyMentionsConservativeBoundary = toolBoundary.bodyMentionsConservativeBoundary === true;

  return {
    permissions,
    toolBoundary,
  };
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

function normalizeFixtureIdentity({ fixtureDir, loadedFixture, normalizedFixture }) {
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
  };
}

export function buildRuntimeRunnerInput({
  fixtureDir = null,
  loadedFixture = null,
  normalizedFixture = null,
  preflightReport = null,
  caseRecord = null,
  boundary = {},
  options = {},
} = {}) {
  return {
    contract: {
      kind: "runtime-runner-input",
      version: options.contractVersion ?? RUNNER_INPUT_VERSION,
    },
    fixture: normalizeFixtureIdentity({ fixtureDir, loadedFixture, normalizedFixture }),
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    preflightReport,
    caseRecord: normalizeCaseRecord(caseRecord),
    boundary: normalizeBoundary(boundary),
    options: cloneObject(options),
    providerAdapterSeam: {
      ...DEFAULT_PROVIDER_ADAPTER_SEAM,
      ...(options?.providerAdapterSeam && typeof options.providerAdapterSeam === "object"
        ? options.providerAdapterSeam
        : {}),
    },
  };
}

export function buildRuntimeRunnerResult({
  caseId = null,
  status = "not-executed",
  observed = null,
  transcriptRef = null,
  failureReason = null,
  runnerMetadata = {},
  allowedStatuses = DEFAULT_ALLOWED_CASE_STATUSES,
} = {}) {
  const normalizedStatus = String(status ?? "not-executed");
  if (!allowedStatuses.includes(normalizedStatus)) {
    throw new RangeError(`Unsupported runtime runner result status: ${normalizedStatus}`);
  }

  const normalizedRunnerMetadata = {
    providerExecutionReserved: true,
    providerBacked: runnerMetadata?.providerBacked === true,
    providerCall: false,
    transcriptCaptured: false,
    transcriptPersistence: "none",
    evidenceProduced: false,
    passedReserved: true,
    futureProviderRequiredFields: [
      "runnerMetadata.providerExecutionId",
      "runnerMetadata.providerStatus",
      "runnerMetadata.providerBacked=true",
      "runnerMetadata.providerCall=true",
      "runnerMetadata.transcriptCaptured=true",
      "transcriptRef.available=true",
      "result.status=passed",
    ],
    ...cloneObject(runnerMetadata),
    pendingCapabilities: Array.isArray(runnerMetadata?.pendingCapabilities)
      ? [...runnerMetadata.pendingCapabilities]
      : [...DEFAULT_RUNNER_PENDING_CAPABILITIES],
  };

  const normalizedTranscriptRef =
    transcriptRef && typeof transcriptRef === "object" && !Array.isArray(transcriptRef)
      ? {
          ...transcriptRef,
          available: transcriptRef?.available === true,
          providerTranscript: transcriptRef?.providerTranscript === true,
        }
      : null;

  if (normalizedRunnerMetadata.providerBacked !== true && normalizedTranscriptRef?.providerTranscript === true) {
    throw new RangeError("Provider transcript refs are reserved until provider-backed runtime execution is implemented");
  }

  if (normalizedRunnerMetadata.providerBacked !== true && normalizedTranscriptRef) {
    normalizedTranscriptRef.providerTranscript = false;
  }

  if (
    normalizedStatus !== "blocked" &&
    BLOCKING_FAILURE_REASON_CODES.includes(failureReason?.code)
  ) {
    throw new RangeError(
      `Runtime runner blocking failureReason requires blocked status, got: ${normalizedStatus}`,
    );
  }

  return {
    contract: {
      kind: "runtime-runner-output",
      version: runnerMetadata?.contractVersion ?? RUNNER_OUTPUT_VERSION,
    },
    caseId,
    status: normalizedStatus,
    observed,
    transcriptRef: normalizedTranscriptRef,
    failureReason,
    runnerMetadata: normalizedRunnerMetadata,
  };
}

export function buildRuntimeRunnerContractContext({
  fixtureDir = null,
  loadedFixture = null,
  normalizedFixture = null,
  preflightReport = null,
  caseRecord = null,
  boundary = {},
  options = {},
} = {}) {
  const input = buildRuntimeRunnerInput({
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    preflightReport,
    caseRecord,
    boundary,
    options,
  });

  return {
    input,
    buildResult(result = {}) {
      return buildRuntimeRunnerResult({
        caseId: result.caseId ?? input.caseRecord.id,
        ...result,
      });
    },
  };
}

export function buildRuntimeTranscriptArtifactRef({
  artifactId = null,
  caseId = null,
  executionMode = null,
  available = false,
  location = null,
  providerTranscript = false,
  persistence = "in-report-only",
  note = null,
} = {}) {
  return {
    kind: RUNTIME_TRANSCRIPT_REF_KIND,
    version: RUNTIME_TRANSCRIPT_REF_VERSION,
    artifactId,
    caseId,
    executionMode,
    available: available === true,
    location:
      location && typeof location === "object" && !Array.isArray(location)
        ? { ...location }
        : {
            kind: "in-report-artifact",
            path: ["cases", caseId == null ? null : { id: caseId }, "transcript"],
          },
    providerTranscript: providerTranscript === true,
    persistence,
    note:
      note ??
      "draft in-report transcript artifact ref for single-case provider-less runtime transcript stub; this is not a provider transcript reference and does not imply persisted provider evidence",
  };
}

export const RUNTIME_RUNNER_INPUT_VERSION = RUNNER_INPUT_VERSION;
export const RUNTIME_RUNNER_OUTPUT_VERSION = RUNNER_OUTPUT_VERSION;
export const RUNTIME_RUNNER_ALLOWED_STATUSES = [...DEFAULT_ALLOWED_CASE_STATUSES];
export const RUNTIME_TRANSCRIPT_ARTIFACT_REF_KIND = RUNTIME_TRANSCRIPT_REF_KIND;
export const RUNTIME_TRANSCRIPT_ARTIFACT_REF_VERSION = RUNTIME_TRANSCRIPT_REF_VERSION;
export const RUNTIME_PROVIDER_EXECUTION_FRAGMENT_VERSION = PROVIDER_EXECUTION_FRAGMENT_VERSION;
export const RUNTIME_TRANSCRIPT_AVAILABILITY_SKELETON_VERSION = TRANSCRIPT_AVAILABILITY_SKELETON_VERSION;

export default {
  buildRuntimeRunnerInput,
  buildRuntimeRunnerResult,
  buildRuntimeRunnerContractContext,
  buildRuntimeTranscriptArtifactRef,
  RUNTIME_RUNNER_INPUT_VERSION: RUNNER_INPUT_VERSION,
  RUNTIME_RUNNER_OUTPUT_VERSION: RUNNER_OUTPUT_VERSION,
  RUNTIME_RUNNER_ALLOWED_STATUSES: [...DEFAULT_ALLOWED_CASE_STATUSES],
  RUNTIME_TRANSCRIPT_ARTIFACT_REF_KIND: RUNTIME_TRANSCRIPT_REF_KIND,
  RUNTIME_TRANSCRIPT_ARTIFACT_REF_VERSION: RUNTIME_TRANSCRIPT_REF_VERSION,
  RUNTIME_PROVIDER_EXECUTION_FRAGMENT_VERSION: PROVIDER_EXECUTION_FRAGMENT_VERSION,
  RUNTIME_TRANSCRIPT_AVAILABILITY_SKELETON_VERSION: TRANSCRIPT_AVAILABILITY_SKELETON_VERSION,
};

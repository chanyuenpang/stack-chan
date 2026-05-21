const RUNTIME_TRANSCRIPT_ARTIFACT_VERSION = "runtime-transcript-artifact-draft-1";
const RUNTIME_TRANSCRIPT_KIND = "runtime-transcript-artifact";
const RUNTIME_TRANSCRIPT_SCOPE = "single-case";
const RUNTIME_TRANSCRIPT_EXECUTION_CLASS = "provider-less-draft-only";
const RUNTIME_TRANSCRIPT_REF_SCHEME = "in-report-draft-artifact-ref";

const DEFAULT_PENDING_CAPABILITIES = Object.freeze([
  "provider-transcript",
  "transcript-persistence",
  "transcript-ref-wiring",
  "sandbox-implementation",
  "scoring-engine",
]);

function cloneArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function cloneObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : { ...fallback };
}

function normalizeFixture(fixture = {}) {
  return {
    path: fixture?.path ?? fixture?.fixtureDir ?? null,
    id: fixture?.id ?? fixture?.fixtureId ?? null,
    version: fixture?.version ?? fixture?.fixtureVersion ?? null,
    entry: fixture?.entry ?? fixture?.entryPath ?? null,
    profile: fixture?.profile ?? null,
  };
}

function normalizeCase(caseRecord = {}) {
  return {
    id: caseRecord?.id ?? null,
    type: caseRecord?.type ?? null,
    intent: caseRecord?.intent ?? null,
    expectedBehavior: caseRecord?.expectedBehavior ?? null,
    status: caseRecord?.status ?? null,
  };
}

function buildRuntimeTranscriptArtifactId({ fixture = {}, caseRecord = {}, executionMode = null } = {}) {
  const fixtureId = fixture?.id ?? fixture?.fixtureId ?? "unknown-fixture";
  const caseId = caseRecord?.id ?? "unknown-case";
  const mode = executionMode ?? "unknown-mode";
  return `draft:${fixtureId}:${caseId}:${mode}`;
}

function normalizeBoundary(boundary = {}) {
  return {
    permissions: cloneObject(boundary?.permissions, {
      allowed: [],
      denied: [],
      conservativeDefault: false,
      declarations: [],
    }),
    toolBoundary: cloneObject(boundary?.toolBoundary, {
      allowedActions: [],
      deniedActions: [],
      permissions: {
        allowed: [],
        denied: [],
        conservativeDefault: false,
        declarations: [],
      },
      bodyMentionsConservativeBoundary: false,
    }),
    summary: cloneObject(boundary?.summary ?? boundary?.boundarySummary),
  };
}

function normalizeRunnerMetadata(runnerMetadata = {}) {
  return {
    implementation: runnerMetadata?.implementation ?? null,
    runnerVersion: runnerMetadata?.runnerVersion ?? null,
    mode: runnerMetadata?.mode ?? null,
    executed: runnerMetadata?.executed ?? false,
    providerCall: false,
    transcriptEngineUsed: false,
    sandboxEnforced: runnerMetadata?.sandboxEnforced ?? false,
    caseType: runnerMetadata?.caseType ?? null,
    note: runnerMetadata?.note ?? null,
  };
}

function normalizeOutcome(outcome = {}) {
  return {
    status: outcome?.status ?? null,
    observedKind: outcome?.observedKind ?? outcome?.observed?.kind ?? null,
    failureReason: outcome?.failureReason ?? null,
    transcriptCaptured: false,
    providerResponseCaptured: false,
  };
}

function normalizeEvents(events = []) {
  return cloneArray(events).map((event, index) => ({
    seq: event?.seq ?? index + 1,
    phase: event?.phase ?? null,
    kind: event?.kind ?? null,
    status: event?.status ?? null,
    at: event?.at ?? null,
    detail: event?.detail ?? null,
    evidence:
      event?.evidence && typeof event.evidence === "object" && !Array.isArray(event.evidence)
        ? { ...event.evidence }
        : {},
  }));
}

export function buildRuntimeTranscriptArtifact({
  fixture = null,
  caseRecord = null,
  executionMode = null,
  boundary = null,
  runnerMetadata = null,
  outcome = null,
  events = [],
  note = null,
  pendingCapabilities = DEFAULT_PENDING_CAPABILITIES,
} = {}) {
  const normalizedFixture = normalizeFixture(fixture);
  const normalizedCase = normalizeCase(caseRecord);
  const normalizedExecutionMode = executionMode ?? runnerMetadata?.mode ?? null;

  return {
    kind: RUNTIME_TRANSCRIPT_KIND,
    artifactVersion: RUNTIME_TRANSCRIPT_ARTIFACT_VERSION,
    artifactId: buildRuntimeTranscriptArtifactId({
      fixture: normalizedFixture,
      caseRecord: normalizedCase,
      executionMode: normalizedExecutionMode,
    }),
    refScheme: RUNTIME_TRANSCRIPT_REF_SCHEME,
    scope: RUNTIME_TRANSCRIPT_SCOPE,
    executionClass: RUNTIME_TRANSCRIPT_EXECUTION_CLASS,
    fixture: normalizedFixture,
    case: normalizedCase,
    executionMode: normalizedExecutionMode,
    boundary: normalizeBoundary(boundary),
    runnerMetadata: normalizeRunnerMetadata(runnerMetadata),
    outcome: normalizeOutcome(outcome),
    events: normalizeEvents(events),
    note:
      note ??
      "provider-less single-case runtime transcript stub only; records orchestration evidence and deliberately excludes any fictional model/provider dialogue",
    pendingCapabilities: Array.isArray(pendingCapabilities)
      ? [...pendingCapabilities]
      : [...DEFAULT_PENDING_CAPABILITIES],
  };
}

export const RUNTIME_TRANSCRIPT_DEFAULT_PENDING_CAPABILITIES = [...DEFAULT_PENDING_CAPABILITIES];
export const RUNTIME_TRANSCRIPT_ARTIFACT_KIND = RUNTIME_TRANSCRIPT_KIND;
export const RUNTIME_TRANSCRIPT_ARTIFACT_SCOPE = RUNTIME_TRANSCRIPT_SCOPE;
export const RUNTIME_TRANSCRIPT_ARTIFACT_EXECUTION_CLASS = RUNTIME_TRANSCRIPT_EXECUTION_CLASS;
export const RUNTIME_TRANSCRIPT_ARTIFACT_CONTRACT_VERSION = RUNTIME_TRANSCRIPT_ARTIFACT_VERSION;
export const RUNTIME_TRANSCRIPT_ARTIFACT_REF_SCHEME = RUNTIME_TRANSCRIPT_REF_SCHEME;

export default {
  buildRuntimeTranscriptArtifact,
  RUNTIME_TRANSCRIPT_DEFAULT_PENDING_CAPABILITIES: [...DEFAULT_PENDING_CAPABILITIES],
  RUNTIME_TRANSCRIPT_ARTIFACT_KIND: RUNTIME_TRANSCRIPT_KIND,
  RUNTIME_TRANSCRIPT_ARTIFACT_SCOPE: RUNTIME_TRANSCRIPT_SCOPE,
  RUNTIME_TRANSCRIPT_ARTIFACT_EXECUTION_CLASS: RUNTIME_TRANSCRIPT_EXECUTION_CLASS,
  RUNTIME_TRANSCRIPT_ARTIFACT_CONTRACT_VERSION: RUNTIME_TRANSCRIPT_ARTIFACT_VERSION,
  RUNTIME_TRANSCRIPT_ARTIFACT_REF_SCHEME: RUNTIME_TRANSCRIPT_REF_SCHEME,
};

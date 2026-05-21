const RUNNER_INPUT_VERSION = "runtime-runner-input-draft-1";
const RUNNER_OUTPUT_VERSION = "runtime-runner-output-draft-1";

const DEFAULT_ALLOWED_CASE_STATUSES = Object.freeze([
  "passed",
  "failed",
  "blocked",
  "error",
  "dry-run",
  "not-executed",
]);

const DEFAULT_RUNNER_PENDING_CAPABILITIES = Object.freeze([
  "provider-integration",
  "transcript-engine",
  "sandbox-implementation",
  "scoring-engine",
]);

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

  return {
    contract: {
      kind: "runtime-runner-output",
      version: runnerMetadata?.contractVersion ?? RUNNER_OUTPUT_VERSION,
    },
    caseId,
    status: normalizedStatus,
    observed,
    transcriptRef,
    failureReason,
    runnerMetadata: {
      ...cloneObject(runnerMetadata),
      pendingCapabilities: Array.isArray(runnerMetadata?.pendingCapabilities)
        ? [...runnerMetadata.pendingCapabilities]
        : [...DEFAULT_RUNNER_PENDING_CAPABILITIES],
    },
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

export const RUNTIME_RUNNER_INPUT_VERSION = RUNNER_INPUT_VERSION;
export const RUNTIME_RUNNER_OUTPUT_VERSION = RUNNER_OUTPUT_VERSION;
export const RUNTIME_RUNNER_ALLOWED_STATUSES = [...DEFAULT_ALLOWED_CASE_STATUSES];

export default {
  buildRuntimeRunnerInput,
  buildRuntimeRunnerResult,
  buildRuntimeRunnerContractContext,
  RUNTIME_RUNNER_INPUT_VERSION: RUNNER_INPUT_VERSION,
  RUNTIME_RUNNER_OUTPUT_VERSION: RUNNER_OUTPUT_VERSION,
  RUNTIME_RUNNER_ALLOWED_STATUSES: [...DEFAULT_ALLOWED_CASE_STATUSES],
};

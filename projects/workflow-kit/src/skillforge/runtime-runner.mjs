import { buildRuntimeReplayReport } from "./runtime-replay-reporter.mjs";
import { buildRuntimeRunnerContractContext } from "./runtime-runner-contract.mjs";
import { buildRuntimeSandboxBoundaryFromSources } from "./runtime-sandbox-contract.mjs";
import { selectRuntimeCase } from "./runtime-case-selector.mjs";

const DRY_RUNNER_VERSION = "runtime-runner-skeleton-dry-null-1";
const SUPPORTED_MODES = new Set(["dry-run", "null-runner"]);
const NON_PASSING_STATUSES = new Set(["dry-run", "blocked", "not-executed"]);

function pickStatusForMode(mode) {
  if (mode === "null-runner") return "not-executed";
  return "dry-run";
}

function buildBlockedReason(preflightReport) {
  const blockingFailures = Array.isArray(preflightReport?.checks)
    ? preflightReport.checks.filter((check) => check?.status === "fail" || check?.status === "error")
    : [];

  return {
    code: "RUNTIME_PREFLIGHT_BLOCKED",
    message:
      blockingFailures.length > 0
        ? `runtime runner skeleton blocked by preflight findings: ${blockingFailures.map((check) => check?.id).filter(Boolean).join(", ")}`
        : "runtime runner skeleton blocked because preflight report is not marked passed",
    blockingCheckIds: blockingFailures.map((check) => check?.id).filter(Boolean),
  };
}

function buildObservedStub({ mode, caseRecord }) {
  return {
    kind: "runtime-observed-stub",
    mode,
    evidence: "not-executed",
    providerCall: false,
    transcriptCaptured: false,
    sideEffectsPerformed: false,
    note: `runtime runner skeleton did not execute provider for case ${caseRecord?.id ?? "<unknown>"}`,
  };
}

function assertRequiredInput(input) {
  if (!input?.normalizedFixture) {
    throw new TypeError("runtime runner skeleton requires normalizedFixture");
  }
  if (!input?.preflightReport) {
    throw new TypeError("runtime runner skeleton requires preflightReport");
  }
  if (!input?.runnerContract) {
    throw new TypeError("runtime runner skeleton requires runnerContract");
  }
  if (!input?.sandboxContract) {
    throw new TypeError("runtime runner skeleton requires sandboxContract");
  }
}

function normalizeMode(mode) {
  const normalizedMode = mode ?? "dry-run";
  if (!SUPPORTED_MODES.has(normalizedMode)) {
    throw new RangeError(`Unsupported runtime runner skeleton mode: ${normalizedMode}`);
  }
  return normalizedMode;
}

export function buildRuntimeRunnerSkeletonInput({
  fixtureDir = null,
  loadedFixture = null,
  normalizedFixture = null,
  preflightReport = null,
  runnerContract = null,
  sandboxContract = null,
  caseId = null,
  caseIndex = null,
  options = {},
} = {}) {
  const caseRecord = selectRuntimeCase({ normalizedFixture, caseId, caseIndex });
  const boundary = {
    permissions: sandboxContract?.permissions ?? runnerContract?.input?.boundary?.permissions ?? {},
    toolBoundary: sandboxContract?.toolBoundary ?? runnerContract?.input?.boundary?.toolBoundary ?? {},
  };

  return {
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    preflightReport,
    runnerContract,
    sandboxContract,
    caseRecord,
    boundary,
    options: { ...options },
  };
}

export function runRuntimeCaseSkeleton({
  fixtureDir = null,
  loadedFixture = null,
  normalizedFixture = null,
  preflightReport = null,
  runnerContract = null,
  sandboxContract = null,
  caseId = null,
  caseIndex = null,
  options = {},
} = {}) {
  const mode = normalizeMode(options.mode);

  const effectiveSandboxContract =
    sandboxContract ??
    buildRuntimeSandboxBoundaryFromSources({
      normalizedFixture,
      preflightInput: preflightReport,
    });

  const caseRecord = selectRuntimeCase({ normalizedFixture, caseId, caseIndex });

  const effectiveRunnerContract =
    runnerContract ??
    buildRuntimeRunnerContractContext({
      fixtureDir,
      loadedFixture,
      normalizedFixture,
      preflightReport,
      caseRecord,
      boundary: {
        permissions: effectiveSandboxContract.permissions,
        toolBoundary: effectiveSandboxContract.toolBoundary,
      },
      options: {
        mode,
        skeleton: true,
      },
    });

  const input = buildRuntimeRunnerSkeletonInput({
    fixtureDir,
    loadedFixture,
    normalizedFixture,
    preflightReport,
    runnerContract: effectiveRunnerContract,
    sandboxContract: effectiveSandboxContract,
    caseId: caseRecord.id,
    options: { ...options, mode },
  });

  assertRequiredInput(input);

  const blocked = preflightReport?.status !== "passed";
  const status = blocked ? "blocked" : pickStatusForMode(mode);

  if (!NON_PASSING_STATUSES.has(status)) {
    throw new RangeError(`Runtime runner skeleton produced forbidden status: ${status}`);
  }

  const result = effectiveRunnerContract.buildResult({
    caseId: caseRecord.id,
    status,
    observed: buildObservedStub({ mode, caseRecord }),
    transcriptRef: null,
    failureReason: blocked ? buildBlockedReason(preflightReport) : null,
    runnerMetadata: {
      implementation: "single-case-dry-null-runner-skeleton",
      runnerVersion: DRY_RUNNER_VERSION,
      mode,
      executed: false,
      providerCall: false,
      transcriptEngineUsed: false,
      sandboxEnforced: false,
      caseType: caseRecord?.type ?? null,
      note:
        mode === "null-runner"
          ? "null runner skeleton reserved contract shape without execution"
          : "dry runner skeleton reserved contract shape without provider execution",
      pendingCapabilities: [
        "provider-integration",
        "transcript-engine",
        "sandbox-implementation",
        "scoring-engine",
      ],
    },
  });

  const runtimeReport = buildRuntimeReplayReport({
    fixtureDir,
    fixture: {
      id: normalizedFixture?.fixtureId ?? null,
      version: normalizedFixture?.fixtureVersion ?? null,
      entry: normalizedFixture?.entryPath ?? null,
      profile: normalizedFixture?.profile ?? null,
    },
    runtime: {
      fixture: effectiveRunnerContract.input.fixture,
      runner: {
        implementation: "single-case-dry-null-runner-skeleton",
        version: DRY_RUNNER_VERSION,
      },
      sandbox: effectiveSandboxContract.boundarySummary,
      staticBaseline: {
        kind: preflightReport?.metadata?.lineage?.static?.kind ?? null,
        reportVersion: preflightReport?.metadata?.sourceStaticReportVersion ?? null,
        ruleSetVersion: preflightReport?.metadata?.sourceStaticRuleSetVersion ?? null,
        status: preflightReport?.preflight?.staticBaseline?.status ?? null,
      },
      preflight: {
        kind: preflightReport?.kind ?? null,
        reportVersion: preflightReport?.reportVersion ?? null,
        protocolVersion: preflightReport?.protocolVersion ?? null,
        ruleSetVersion: preflightReport?.ruleSetVersion ?? null,
        status: preflightReport?.status ?? null,
      },
      replayCases: {
        kind: normalizedFixture?.replayCases?.kind ?? null,
        fixtureId: normalizedFixture?.replayCases?.fixtureId ?? null,
      },
      mode,
      pendingCapabilities: result.runnerMetadata.pendingCapabilities,
    },
    cases: [
      {
        id: caseRecord.id,
        type: caseRecord.type,
        status: result.status,
        expectedBehavior: caseRecord.expectedBehavior ?? null,
        observed: result.observed,
        transcriptRef: result.transcriptRef,
        failureReason: result.failureReason,
      },
    ],
    checks: blocked
      ? [
          {
            id: "RUNTIME-RUNNER-SKELETON-PREFLIGHT-BLOCKED",
            scope: "runtime",
            status: "warn",
            severity: "P1",
            message: "runtime runner skeleton did not execute because preflight is not passed",
            evidence: result.failureReason?.blockingCheckIds ?? [],
          },
        ]
      : [
          {
            id: "RUNTIME-RUNNER-SKELETON-DRY-NULL-ONLY",
            scope: "runtime",
            status: "warn",
            severity: "P2",
            message: "runtime runner skeleton only emits dry-run/null-runner contract results in this phase",
            evidence: [mode],
          },
        ],
    options: {
      runner: {
        implementation: "single-case-dry-null-runner-skeleton",
        version: DRY_RUNNER_VERSION,
      },
      sandbox: effectiveSandboxContract.boundarySummary,
      note:
        "runtime draft artifact only; single-case dry/null skeleton with no provider call, no transcript evidence, no scoring, and no runtime pass evidence",
    },
  });

  return {
    mode,
    caseRecord,
    runnerInput: effectiveRunnerContract.input,
    sandboxContract: effectiveSandboxContract,
    result,
    runtimeReport,
  };
}

export default {
  buildRuntimeRunnerSkeletonInput,
  runRuntimeCaseSkeleton,
};

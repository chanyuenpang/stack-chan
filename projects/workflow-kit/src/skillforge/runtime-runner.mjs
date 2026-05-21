import { buildRuntimeReplayReport } from "./runtime-replay-reporter.mjs";
import {
  buildRuntimeRunnerContractContext,
  buildRuntimeTranscriptArtifactRef,
} from "./runtime-runner-contract.mjs";
import { buildRuntimeSandboxBoundaryFromSources } from "./runtime-sandbox-contract.mjs";
import { buildRuntimeTranscriptArtifact } from "./runtime-transcript-contract.mjs";
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

function buildTranscriptEvents({
  loadedFixture,
  normalizedFixture,
  preflightReport,
  caseRecord,
  boundary,
  mode,
  blocked,
}) {
  const blockingChecks = Array.isArray(preflightReport?.checks)
    ? preflightReport.checks.filter((check) => check?.status === "fail" || check?.status === "error")
    : [];

  return [
    {
      phase: "fixture",
      kind: "fixture-loaded",
      status: loadedFixture ? "ok" : "unknown",
      detail: "fixture material loaded for single-case runtime draft orchestration",
      evidence: {
        fixtureId: normalizedFixture?.fixtureId ?? null,
        fixtureVersion: normalizedFixture?.fixtureVersion ?? null,
        entryPath: normalizedFixture?.entryPath ?? null,
        profile: normalizedFixture?.profile ?? null,
      },
    },
    {
      phase: "static-validation",
      kind: "static-validated",
      status: preflightReport?.metadata?.sourceStaticStatus ?? null,
      detail: "static validation evidence inherited into runtime draft transcript stub",
      evidence: {
        reportVersion: preflightReport?.metadata?.sourceStaticReportVersion ?? null,
        ruleSetVersion: preflightReport?.metadata?.sourceStaticRuleSetVersion ?? null,
      },
    },
    {
      phase: "preflight",
      kind: blocked ? "preflight-failed" : "preflight-passed",
      status: preflightReport?.status ?? (blocked ? "blocked" : "passed"),
      detail: blocked
        ? "preflight did not pass, so runtime execution remained blocked in draft mode"
        : "preflight passed, enabling dry/null runner reservation without provider execution",
      evidence: {
        reportVersion: preflightReport?.reportVersion ?? null,
        protocolVersion: preflightReport?.protocolVersion ?? null,
        ruleSetVersion: preflightReport?.ruleSetVersion ?? null,
        blockingCheckIds: blockingChecks.map((check) => check?.id).filter(Boolean),
      },
    },
    {
      phase: "case-selection",
      kind: "case-selected",
      status: caseRecord?.id ? "ok" : "unknown",
      detail: "single runtime replay case selected for draft orchestration",
      evidence: {
        caseId: caseRecord?.id ?? null,
        caseType: caseRecord?.type ?? null,
        intent: caseRecord?.intent ?? null,
      },
    },
    {
      phase: "boundary",
      kind: "sandbox-boundary-built",
      status: "ok",
      detail: "runtime sandbox boundary contract prepared for provider-less draft execution",
      evidence: {
        permissions: boundary?.permissions ?? {},
        toolBoundary: boundary?.toolBoundary ?? {},
      },
    },
    {
      phase: "runner",
      kind: blocked ? "runner-blocked" : mode === "null-runner" ? "runner-skipped" : "runner-dry-run-reserved",
      status: blocked ? "blocked" : "not-executed",
      detail: blocked
        ? "runner remained blocked because preflight was not passed"
        : mode === "null-runner"
          ? "null runner reserved output contract shape without execution"
          : "dry-run reserved output contract shape without execution",
      evidence: {
        mode,
        providerCall: false,
        transcriptEngineUsed: false,
        executionReservedOnly: true,
      },
    },
  ];
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

  const observed = buildObservedStub({ mode, caseRecord });
  const failureReason = blocked ? buildBlockedReason(preflightReport) : null;

  const result = effectiveRunnerContract.buildResult({
    caseId: caseRecord.id,
    status,
    observed,
    transcriptRef: null,
    failureReason,
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

  const transcriptArtifact = buildRuntimeTranscriptArtifact({
    fixture: {
      path: fixtureDir,
      id: normalizedFixture?.fixtureId ?? null,
      version: normalizedFixture?.fixtureVersion ?? null,
      entry: normalizedFixture?.entryPath ?? null,
      profile: normalizedFixture?.profile ?? null,
    },
    caseRecord,
    executionMode: mode,
    boundary: {
      permissions: effectiveSandboxContract.permissions,
      toolBoundary: effectiveSandboxContract.toolBoundary,
      boundarySummary: effectiveSandboxContract.boundarySummary,
    },
    runnerMetadata: result.runnerMetadata,
    outcome: {
      status: result.status,
      observedKind: observed.kind,
      observed,
      failureReason,
    },
    events: buildTranscriptEvents({
      loadedFixture,
      normalizedFixture,
      preflightReport,
      caseRecord,
      boundary: {
        permissions: effectiveSandboxContract.permissions,
        toolBoundary: effectiveSandboxContract.toolBoundary,
      },
      mode,
      blocked,
    }),
    note:
      "provider-less runtime transcript stub only; captures orchestration evidence for a single draft case without any model dialogue or transcript persistence",
    pendingCapabilities: [
      ...result.runnerMetadata.pendingCapabilities,
      "transcript-ref-wiring",
      "transcript-persistence",
    ],
  });

  const transcriptRef = buildRuntimeTranscriptArtifactRef({
    artifactId: transcriptArtifact.artifactId,
    caseId: caseRecord.id,
    executionMode: mode,
    available: true,
    location: {
      kind: "in-report-artifact",
      path: ["cases", 0, "transcript"],
    },
    providerTranscript: false,
    note:
      "draft in-report transcript artifact ref wired to the provider-less runtime transcript stub for this single case; not a provider transcript reference",
  });

  const resultWithTranscriptRef = {
    ...result,
    transcriptRef,
  };

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
        transcriptRef: resultWithTranscriptRef.transcriptRef,
        failureReason: result.failureReason,
        transcript: transcriptArtifact,
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
    result: resultWithTranscriptRef,
    transcriptArtifact,
    runtimeReport,
  };
}

export default {
  buildRuntimeRunnerSkeletonInput,
  runRuntimeCaseSkeleton,
};
